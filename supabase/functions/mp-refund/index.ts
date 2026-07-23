/**
 * mp-refund — Cancellation refunds as Healthy Credits + MP conversion workflow
 *
 * POST /mp-refund  { action, ...params }   (all actions require an authenticated caller)
 *
 * action: "cancel-refund"        body: { consultationId }           (patient owner, or admin/super_admin)
 *   Financial side of a cancellation — the appointment-status cancellation itself
 *   already exists elsewhere in the flow; the frontend calls both. Refund-eligible
 *   only if >= platform_settings.refund_window_business_hours business hours
 *   (Mon–Fri, America/Argentina/Buenos_Aires) separate now() from scheduled_at.
 *   Eligible → issues Healthy Credits (ledger + payments.status='refunded',
 *   refund_type='credit') — no MP call. Not eligible → 422, no refund.
 *
 * action: "request-mp-conversion" body: { consultationId? , paymentId? }  (patient owner)
 *   Patient asks to convert a credit-refund into a real MP refund. Requires the
 *   credit hasn't been spent yet (balance >= the refunded amount).
 *
 * action: "approve-mp-conversion" body: { paymentId }               (super_admin only)
 *   Calls MP's real refund API using the seller's OAuth token. If the payment
 *   was 100% credits (no mp_payment_id), there is nothing to refund via MP.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isRefundEligible } from "../_shared/businessHours.ts";
import { ensureFreshMpToken, PAYMENT_REFRESH_MARGIN_MS, type MpAccountRow } from "../_shared/mpRefresh.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ data: null, error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ data: null, error: "Unauthorized" }, 401);

    const authedSupabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authErr } = await authedSupabase.auth.getUser();
    if (authErr || !user) return jsonResponse({ data: null, error: "Unauthorized" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: callerProfile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    const callerRole = callerProfile?.role ?? "patient";
    const isAdmin = callerRole === "admin" || callerRole === "super_admin";

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const action = (body as { action?: string }).action;

    // ────────────────────────────────────────────────────────────────────────
    // action: cancel-refund
    // ────────────────────────────────────────────────────────────────────────
    if (action === "cancel-refund") {
      const consultationId = (body as { consultationId?: string }).consultationId;
      if (!consultationId) return jsonResponse({ data: null, error: "Missing consultationId" }, 400);

      const { data: consultation, error: consErr } = await supabase
        .from("consultations")
        .select("id, patient_id, professional_id, payment_status, scheduled_at")
        .eq("id", consultationId)
        .single();

      if (consErr || !consultation) return jsonResponse({ data: null, error: "Consultation not found" }, 404);

      if (consultation.patient_id !== user.id && !isAdmin) {
        return jsonResponse({ data: null, error: "Forbidden" }, 403);
      }

      if (consultation.payment_status !== "paid") {
        return jsonResponse(
          { data: null, error: `Consultation is not in a refundable state (payment_status=${consultation.payment_status})` },
          409
        );
      }

      if (!consultation.scheduled_at) {
        return jsonResponse({ data: null, error: "Consultation has no scheduled_at" }, 422);
      }

      const { data: settings } = await supabase
        .from("platform_settings")
        .select("refund_window_business_hours")
        .eq("id", 1)
        .single();
      const windowHours = settings?.refund_window_business_hours ?? 48;

      const eligible = isRefundEligible(consultation.scheduled_at, windowHours);

      if (!eligible) {
        return jsonResponse(
          {
            data: null,
            error: `Cancelación sin reintegro: quedan menos de ${windowHours}hs hábiles para el turno`,
          },
          422
        );
      }

      const { data: payment, error: paymentErr } = await supabase
        .from("payments")
        .select("id, gross_amount")
        .eq("consultation_id", consultationId)
        .eq("status", "approved")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (paymentErr || !payment) {
        console.error("mp-refund: no approved payment found for consultation", consultationId, paymentErr?.message);
        return jsonResponse({ data: null, error: "No approved payment found for this consultation" }, 422);
      }

      const { error: ledgerErr } = await supabase.from("patient_credits").insert({
        patient_id: consultation.patient_id,
        amount: payment.gross_amount,
        reason: "refund",
        consultation_id: consultationId,
        payment_id: payment.id,
        note: `Reembolso por cancelación ≥${windowHours}hs hábiles de anticipación`,
        created_by: user.id,
      });
      if (ledgerErr) {
        console.error("mp-refund: ledger insert error:", ledgerErr.message);
        return jsonResponse({ data: null, error: "Failed to issue Healthy Credits" }, 500);
      }

      const { error: paymentUpdateErr } = await supabase
        .from("payments")
        .update({ status: "refunded", refund_type: "credit", refunded_at: new Date().toISOString() })
        .eq("id", payment.id);
      if (paymentUpdateErr) console.error("mp-refund: payments update error:", paymentUpdateErr.message);

      const { error: consUpdateErr } = await supabase
        .from("consultations")
        .update({ payment_status: "refunded", refund_pending: false })
        .eq("id", consultationId);
      if (consUpdateErr) console.error("mp-refund: consultations update error:", consUpdateErr.message);

      return jsonResponse({ data: { refunded: true, creditsIssued: payment.gross_amount }, error: null });
    }

    // ────────────────────────────────────────────────────────────────────────
    // action: request-mp-conversion
    // ────────────────────────────────────────────────────────────────────────
    if (action === "request-mp-conversion") {
      const { consultationId, paymentId } = body as { consultationId?: string; paymentId?: string };
      if (!consultationId && !paymentId) {
        return jsonResponse({ data: null, error: "Missing consultationId or paymentId" }, 400);
      }

      let query = supabase
        .from("payments")
        .select("id, patient_id, gross_amount, status, refund_type, refund_conversion_requested_at, refund_conversion_resolved_at");
      query = paymentId ? query.eq("id", paymentId) : query.eq("consultation_id", consultationId!).eq("status", "refunded");

      const { data: payment, error: paymentErr } = await query
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (paymentErr || !payment) return jsonResponse({ data: null, error: "Refunded payment not found" }, 404);

      if (payment.patient_id !== user.id && !isAdmin) {
        return jsonResponse({ data: null, error: "Forbidden" }, 403);
      }
      if (payment.status !== "refunded" || payment.refund_type !== "credit") {
        return jsonResponse({ data: null, error: "This payment is not a pending credit refund" }, 409);
      }
      if (payment.refund_conversion_requested_at) {
        return jsonResponse({ data: null, error: "MP conversion already requested for this payment" }, 409);
      }

      const { data: balance, error: balErr } = await supabase.rpc("get_credit_balance", { p_patient: payment.patient_id });
      if (balErr) {
        console.error("mp-refund: get_credit_balance error:", balErr.message);
        return jsonResponse({ data: null, error: "Failed to check credit balance" }, 500);
      }
      if (Number(balance) < Number(payment.gross_amount)) {
        return jsonResponse(
          { data: null, error: "Insufficient credit balance — parte de este crédito ya fue utilizado" },
          422
        );
      }

      const { error: updateErr } = await supabase
        .from("payments")
        .update({ refund_conversion_requested_at: new Date().toISOString() })
        .eq("id", payment.id);
      if (updateErr) {
        console.error("mp-refund: request-mp-conversion update error:", updateErr.message);
        return jsonResponse({ data: null, error: "Failed to request MP conversion" }, 500);
      }

      return jsonResponse({ data: { requested: true, paymentId: payment.id }, error: null });
    }

    // ────────────────────────────────────────────────────────────────────────
    // action: approve-mp-conversion (super_admin only)
    // ────────────────────────────────────────────────────────────────────────
    if (action === "approve-mp-conversion") {
      if (callerRole !== "super_admin") return jsonResponse({ data: null, error: "Forbidden" }, 403);

      const { paymentId } = body as { paymentId?: string };
      if (!paymentId) return jsonResponse({ data: null, error: "Missing paymentId" }, 400);

      const { data: payment, error: paymentErr } = await supabase
        .from("payments")
        .select("id, patient_id, professional_id, consultation_id, mp_payment_id, charged_amount, gross_amount, refund_type, refund_conversion_requested_at, refund_conversion_resolved_at")
        .eq("id", paymentId)
        .single();

      if (paymentErr || !payment) return jsonResponse({ data: null, error: "Payment not found" }, 404);

      if (!payment.refund_conversion_requested_at || payment.refund_conversion_resolved_at) {
        return jsonResponse({ data: null, error: "No pending MP conversion request for this payment" }, 409);
      }

      if (!payment.mp_payment_id) {
        return jsonResponse(
          { data: null, error: "Pago 100% créditos — no hay nada que devolver por Mercado Pago" },
          422
        );
      }

      const { data: mpAccount, error: mpAccErr } = await supabase
        .from("mp_accounts")
        .select("professional_id, access_token, refresh_token, expires_at, active")
        .eq("professional_id", payment.professional_id)
        .eq("active", true)
        .single();

      if (mpAccErr || !mpAccount) {
        return jsonResponse({ data: null, error: "Professional's MercadoPago account not found or inactive" }, 422);
      }

      const refreshResult = await ensureFreshMpToken(supabase, mpAccount as MpAccountRow, PAYMENT_REFRESH_MARGIN_MS);
      if (refreshResult.invalidGrant) {
        return jsonResponse({ data: null, error: "Professional's MercadoPago connection is invalid — cannot process refund" }, 422);
      }

      const idempotencyKey = await sha256Hex(`refund:${payment.id}:${payment.mp_payment_id}`);

      const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${payment.mp_payment_id}/refunds`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${refreshResult.accessToken}`,
          "Content-Type": "application/json",
          "X-Idempotency-Key": idempotencyKey,
        },
        // Empty body = full refund of the charged_amount.
        body: JSON.stringify({}),
      });

      const mpData = await mpRes.json().catch(() => ({} as Record<string, unknown>));

      if (!mpRes.ok) {
        console.error("mp-refund: MP refund API error:", JSON.stringify(mpData));
        return jsonResponse(
          { data: null, error: (mpData as { message?: string })?.message ?? "MercadoPago refund failed" },
          502
        );
      }

      const mpRefundId = String((mpData as { id?: string | number })?.id ?? "");

      const { error: ledgerErr } = await supabase.from("patient_credits").insert({
        patient_id: payment.patient_id,
        amount: -payment.gross_amount,
        reason: "mp_refund_conversion",
        consultation_id: payment.consultation_id,
        payment_id: payment.id,
        note: "Conversión de crédito a reembolso real por Mercado Pago (aprobado por super admin)",
        created_by: user.id,
      });
      if (ledgerErr) console.error("mp-refund: mp_refund_conversion ledger insert error:", ledgerErr.message);

      const { error: paymentUpdateErr } = await supabase
        .from("payments")
        .update({
          refund_type: "mp",
          mp_refund_id: mpRefundId,
          refund_conversion_resolved_at: new Date().toISOString(),
        })
        .eq("id", payment.id);
      if (paymentUpdateErr) console.error("mp-refund: approve-mp-conversion payments update error:", paymentUpdateErr.message);

      return jsonResponse({ data: { approved: true, mpRefundId }, error: null });
    }

    return jsonResponse({ data: null, error: `Unknown action: ${action ?? "(none)"}` }, 400);
  } catch (err) {
    console.error("mp-refund error:", err);
    return jsonResponse({ data: null, error: err instanceof Error ? err.message : "Internal error" }, 500);
  }
});
