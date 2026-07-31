/**
 * mp-refund — Manual refund-approval queue (Healthy Credits) + MP conversion workflow
 *
 * POST /mp-refund  { action, ...params }   (all actions require an authenticated caller)
 *
 * Product rule (Mateo, 2026-07-24): refunds are NEVER automatic. A cancellation
 * only ever creates a *request* — a super_admin must explicitly approve it
 * before any Healthy Credits are issued or any payments/consultations status
 * changes.
 *
 * action: "cancel-refund"        body: { consultationId }           (patient owner, or admin/super_admin)
 *   Financial side of a cancellation — the appointment-status cancellation itself
 *   already exists elsewhere in the flow; the frontend calls both. Refund-eligible
 *   only if >= platform_settings.refund_window_business_hours business hours
 *   (Mon–Fri, America/Argentina/Buenos_Aires) separate now() from scheduled_at.
 *   Eligible → marks the payment as a pending refund request
 *   (refund_request_status='pending', refund_requested_at=now()) — does NOT
 *   touch patient_credits, payments.status, or consultations.payment_status.
 *   A super_admin reviews it via approve-refund / reject-refund. Not eligible →
 *   422, no request created. Already pending → 409.
 *
 * action: "approve-refund"       body: { paymentId }                (super_admin only)
 *   Approves a pending refund request: issues Healthy Credits (ledger insert),
 *   sets payments.status='refunded' / refund_type='credit', and
 *   consultations.payment_status='refunded'.
 *
 * action: "reject-refund"        body: { paymentId, reason? }       (super_admin only)
 *   Rejects a pending refund request. No credits issued, no other state changes.
 *
 * action: "request-mp-conversion" body: { consultationId? , paymentId? }  (patient owner)
 *   Patient asks to convert an already-approved credit-refund into a real MP
 *   refund. Requires the credit hasn't been spent yet (balance >= the refunded
 *   amount).
 *
 * action: "force-refund"         body: { paymentId, reason, tipo }  (super_admin only)
 *   Devolución directa, fuera del flujo de cancelación del paciente. `tipo` es
 *   'mp' (devuelve la plata) o 'credito' (acredita Healthy Credits). Motivo
 *   obligatorio; queda asentado en consultation_events.
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
        .select("id, gross_amount, refund_request_status")
        .eq("consultation_id", consultationId)
        .eq("status", "approved")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (paymentErr || !payment) {
        console.error("mp-refund: no approved payment found for consultation", consultationId, paymentErr?.message);
        return jsonResponse({ data: null, error: "No approved payment found for this consultation" }, 422);
      }

      if (payment.refund_request_status === "pending") {
        return jsonResponse(
          { data: null, error: "Ya existe una solicitud de devolución pendiente de revisión para este pago" },
          409
        );
      }

      // Never automatic — this only records the request. A super_admin must
      // approve it (action=approve-refund) before any credits are issued or
      // any payments/consultations status changes.
      const { error: requestErr } = await supabase
        .from("payments")
        .update({
          refund_requested_at: new Date().toISOString(),
          refund_request_status: "pending",
        })
        .eq("id", payment.id);
      if (requestErr) {
        console.error("mp-refund: refund request update error:", requestErr.message);
        return jsonResponse({ data: null, error: "Failed to request refund" }, 500);
      }

      return jsonResponse({ data: { requested: true, pendingReview: true }, error: null });
    }

    // ────────────────────────────────────────────────────────────────────────
    // action: approve-refund (super_admin only)
    // ────────────────────────────────────────────────────────────────────────
    if (action === "approve-refund") {
      if (callerRole !== "super_admin") return jsonResponse({ data: null, error: "Forbidden" }, 403);

      const { paymentId } = body as { paymentId?: string };
      if (!paymentId) return jsonResponse({ data: null, error: "Missing paymentId" }, 400);

      const { data: payment, error: paymentErr } = await supabase
        .from("payments")
        .select("id, patient_id, consultation_id, gross_amount, refund_request_status")
        .eq("id", paymentId)
        .single();

      if (paymentErr || !payment) return jsonResponse({ data: null, error: "Payment not found" }, 404);

      if (payment.refund_request_status !== "pending") {
        return jsonResponse({ data: null, error: "No hay una solicitud de devolución pendiente para este pago" }, 409);
      }

      const { error: ledgerErr } = await supabase.from("patient_credits").insert({
        patient_id: payment.patient_id,
        amount: payment.gross_amount,
        reason: "refund",
        consultation_id: payment.consultation_id,
        payment_id: payment.id,
        note: "Reembolso por cancelación aprobado manualmente por super admin",
        created_by: user.id,
      });
      if (ledgerErr) {
        console.error("mp-refund: ledger insert error:", ledgerErr.message);
        return jsonResponse({ data: null, error: "Failed to issue Healthy Credits" }, 500);
      }

      const { error: paymentUpdateErr } = await supabase
        .from("payments")
        .update({
          status: "refunded",
          refund_type: "credit",
          refunded_at: new Date().toISOString(),
          refund_request_status: "approved",
          refund_reviewed_by: user.id,
          refund_reviewed_at: new Date().toISOString(),
        })
        .eq("id", payment.id);
      if (paymentUpdateErr) console.error("mp-refund: approve-refund payments update error:", paymentUpdateErr.message);

      const { error: consUpdateErr } = await supabase
        .from("consultations")
        .update({ payment_status: "refunded", refund_pending: false })
        .eq("id", payment.consultation_id);
      if (consUpdateErr) console.error("mp-refund: approve-refund consultations update error:", consUpdateErr.message);

      return jsonResponse({ data: { approved: true, creditsIssued: payment.gross_amount }, error: null });
    }

    // ────────────────────────────────────────────────────────────────────────
    // action: reject-refund (super_admin only)
    // ────────────────────────────────────────────────────────────────────────
    if (action === "reject-refund") {
      if (callerRole !== "super_admin") return jsonResponse({ data: null, error: "Forbidden" }, 403);

      const { paymentId, reason } = body as { paymentId?: string; reason?: string };
      if (!paymentId) return jsonResponse({ data: null, error: "Missing paymentId" }, 400);

      const { data: payment, error: paymentErr } = await supabase
        .from("payments")
        .select("id, refund_request_status")
        .eq("id", paymentId)
        .single();

      if (paymentErr || !payment) return jsonResponse({ data: null, error: "Payment not found" }, 404);

      if (payment.refund_request_status !== "pending") {
        return jsonResponse({ data: null, error: "No hay una solicitud de devolución pendiente para este pago" }, 409);
      }

      const { error: updateErr } = await supabase
        .from("payments")
        .update({
          refund_request_status: "rejected",
          refund_reviewed_by: user.id,
          refund_reviewed_at: new Date().toISOString(),
          refund_reject_reason: reason ?? null,
        })
        .eq("id", payment.id);
      if (updateErr) {
        console.error("mp-refund: reject-refund update error:", updateErr.message);
        return jsonResponse({ data: null, error: "Failed to reject refund" }, 500);
      }

      return jsonResponse({ data: { rejected: true }, error: null });
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

    // ────────────────────────────────────────────────────────────────────────
    // action: force-refund (super_admin only) — devolución directa, con motivo
    //
    // El resto de este archivo modela la devolución como consecuencia de una
    // CANCELACIÓN del paciente, con 48 h hábiles de anticipación a un turno que
    // todavía no pasó. Eso deja sin salida a los casos que en la práctica son los
    // que más se devuelven: el profesional no apareció, la llamada se cayó, el
    // paciente reclama después. Verificado el 2026-07-31: de los 3 pagos
    // aprobados que existían, ninguno era elegible por ese camino.
    //
    // Esto NO afloja la regla anterior: es otra puerta, más angosta y con nombre
    // propio. Sólo super admin, motivo escrito obligatorio, y queda asentada en
    // `consultation_events` además de en la fila del pago.
    // ────────────────────────────────────────────────────────────────────────
    if (action === "force-refund") {
      if (callerRole !== "super_admin") return jsonResponse({ data: null, error: "Forbidden" }, 403);

      const { paymentId, reason, tipo } = body as { paymentId?: string; reason?: string; tipo?: string };
      // 'mp' devuelve la plata; 'credito' acredita Healthy Credits. Es una
      // decisión del super admin caso por caso: devolver por MP cuesta la
      // comisión, un crédito queda adentro de la plataforma. Cuál corresponde
      // depende de por qué se está devolviendo.
      const modo = tipo === "credito" ? "credito" : "mp";
      if (!paymentId) return jsonResponse({ data: null, error: "Missing paymentId" }, 400);
      // El motivo no es opcional: una devolución sin motivo es indistinguible de
      // un error operativo tres meses después.
      if (!reason || reason.trim().length < 5) {
        return jsonResponse({ data: null, error: "Escribí el motivo de la devolución" }, 400);
      }

      const { data: payment, error: paymentErr } = await supabase
        .from("payments")
        .select("id, patient_id, professional_id, consultation_id, mp_payment_id, gross_amount, status")
        .eq("id", paymentId)
        .single();

      if (paymentErr || !payment) return jsonResponse({ data: null, error: "Payment not found" }, 404);
      if (payment.status === "refunded") {
        return jsonResponse({ data: null, error: "Este pago ya fue devuelto" }, 409);
      }
      if (payment.status !== "approved") {
        return jsonResponse({ data: null, error: `Sólo se puede devolver un pago aprobado (está en ${payment.status})` }, 409);
      }
      // ── Devolución en Healthy Credits: no toca Mercado Pago ────────────────
      if (modo === "credito") {
        const nowC = new Date().toISOString();
        const { error: ledgerErr } = await supabase.from("patient_credits").insert({
          patient_id: payment.patient_id,
          amount: payment.gross_amount,
          reason: "refund",
          consultation_id: payment.consultation_id,
          payment_id: payment.id,
          note: `Devolución en créditos hecha por super admin: ${reason.trim()}`,
          created_by: user.id,
        });
        if (ledgerErr) {
          console.error("mp-refund: force-refund credito ledger error:", ledgerErr.message);
          return jsonResponse({ data: null, error: "No se pudieron acreditar los créditos" }, 500);
        }

        await supabase.from("payments").update({
          status: "refunded",
          refund_type: "credit",
          refunded_at: nowC,
          refund_reason: reason.trim(),
          refund_forced_by: user.id,
          refund_reviewed_by: user.id,
          refund_reviewed_at: nowC,
        }).eq("id", payment.id);

        if (payment.consultation_id) {
          await supabase.from("consultations")
            .update({ payment_status: "refunded" })
            .eq("id", payment.consultation_id);
          await supabase.from("consultation_events").insert({
            consultation_id: payment.consultation_id,
            actor_id: user.id,
            actor_role: "super_admin",
            event: "refund_forzado",
            detail: { reason: reason.trim(), tipo: "credito", amount: payment.gross_amount },
          }).then(({ error }) => { if (error) console.error("mp-refund: event insert error:", error.message) });
        }

        return jsonResponse({ data: { refunded: true, tipo: "credito", amount: payment.gross_amount }, error: null });
      }

      if (!payment.mp_payment_id) {
        return jsonResponse({ data: null, error: "Pago 100% créditos — no hay nada que devolver por Mercado Pago" }, 422);
      }

      const { data: mpAccount, error: mpAccErr } = await supabase
        .from("mp_accounts")
        .select("professional_id, access_token, refresh_token, expires_at, active")
        .eq("professional_id", payment.professional_id)
        .eq("active", true)
        .single();
      if (mpAccErr || !mpAccount) {
        return jsonResponse({ data: null, error: "La cuenta de Mercado Pago del profesional no está activa" }, 422);
      }

      const refresh = await ensureFreshMpToken(supabase, mpAccount as MpAccountRow, PAYMENT_REFRESH_MARGIN_MS);
      if (refresh.invalidGrant) {
        return jsonResponse({ data: null, error: "La conexión de Mercado Pago del profesional es inválida" }, 422);
      }

      const idemKey = await sha256Hex(`force-refund:${payment.id}:${payment.mp_payment_id}`);
      const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${payment.mp_payment_id}/refunds`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${refresh.accessToken}`,
          "Content-Type": "application/json",
          "X-Idempotency-Key": idemKey,
        },
        body: JSON.stringify({}), // vacío = devolución total
      });
      const mpData = await mpRes.json().catch(() => ({} as Record<string, unknown>));

      if (!mpRes.ok) {
        console.error("mp-refund: force-refund MP error:", JSON.stringify(mpData));
        return jsonResponse(
          { data: null, error: (mpData as { message?: string })?.message ?? "Mercado Pago rechazó la devolución" },
          502,
        );
      }

      const mpRefundId = String((mpData as { id?: string | number })?.id ?? "");
      const now = new Date().toISOString();

      const { error: updErr } = await supabase
        .from("payments")
        .update({
          status: "refunded",
          refund_type: "mp",
          mp_refund_id: mpRefundId,
          refunded_at: now,
          refund_reason: reason.trim(),
          refund_forced_by: user.id,
          refund_reviewed_by: user.id,
          refund_reviewed_at: now,
        })
        .eq("id", payment.id);
      if (updErr) console.error("mp-refund: force-refund payments update error:", updErr.message);

      if (payment.consultation_id) {
        await supabase.from("consultations")
          .update({ payment_status: "refunded" })
          .eq("id", payment.consultation_id);

        // Asiento en la bitácora de la consulta: quién devolvió, por qué y cuánto.
        await supabase.from("consultation_events").insert({
          consultation_id: payment.consultation_id,
          actor_id: user.id,
          actor_role: "super_admin",
          event: "refund_forzado",
          detail: { reason: reason.trim(), tipo: "mp", mp_refund_id: mpRefundId, amount: payment.gross_amount },
        }).then(({ error }) => { if (error) console.error("mp-refund: event insert error:", error.message) });
      }

      return jsonResponse({ data: { refunded: true, mpRefundId }, error: null });
    }

    return jsonResponse({ data: null, error: `Unknown action: ${action ?? "(none)"}` }, 400);
  } catch (err) {
    console.error("mp-refund error:", err);
    return jsonResponse({ data: null, error: err instanceof Error ? err.message : "Internal error" }, 500);
  }
});
