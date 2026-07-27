/**
 * mp-capture — On-demand pre-authorization lifecycle (capture / cancel-auth / sweep)
 *
 * Companion to mp-payment's `authorizeOnly` flow (SECCIÓN C1): a consultation
 * paid with `authorizeOnly: true` reserves the amount on the patient's credit
 * card (`payments.status = 'authorized'`) without charging it. This function
 * resolves that reservation one of two ways:
 *   - `capture`     — the consultation happened → charge the reserved amount.
 *   - `cancel-auth` — the consultation was abandoned/timed out → release the
 *                     reservation, nothing is charged.
 *
 * POST /mp-capture  { action, ...params }
 *
 * action: "capture"     body: { consultationId }
 *   Caller = the professional who owns the consultation, or admin/super_admin.
 *   Finds the consultation's `authorized` (or already `approved`, for
 *   idempotency) payment → PUT /v1/payments/{mp_payment_id} { capture: true }
 *   using the seller's own OAuth token (ensureFreshMpToken) + an
 *   X-Idempotency-Key → payments.status='approved' + captured_at,
 *   consultations.payment_status='paid' + paid_at. Already approved → 200
 *   with `alreadyCaptured: true`, no MP call.
 *
 * action: "cancel-auth" body: { consultationId }
 *   Caller = the patient or professional who owns the consultation, or
 *   admin/super_admin. Same idea but PUT { status: "cancelled" } →
 *   payments.status='cancelled' + auth_cancelled_at, consultations.status=
 *   'cancelled' + payment_status='pending_payment'. Already cancelled → 200
 *   with `alreadyCancelled: true`, no MP call.
 *
 * action: "sweep" (no body)
 *   Internal-only — header `x-cron-secret` === MP_CRON_SECRET or
 *   MP_WEBHOOK_SECRET, or `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`
 *   (same auth pattern as mp-refresh-tokens). Scans every `authorized`
 *   payment and:
 *     (a) cancels stuck authorizations — the consultation is_on_demand,
 *         created more than 10 minutes ago, and never reached
 *         in_progress/completed (the professional never connected or the
 *         patient never entered the call);
 *     (b) captures orphaned authorizations — the consultation reached
 *         completed but nothing (or a failed client-side call) ever
 *         triggered `capture` — this is the backstop for D2.
 *   Meant to run on a 5-minute pg_cron schedule (registered by the
 *   orchestrator, not this function — see repo precedent in
 *   mp-refresh-tokens for why the cron.schedule() call itself isn't
 *   committed in a migration).
 */

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ensureFreshMpToken, PAYMENT_REFRESH_MARGIN_MS, type MpAccountRow } from "../_shared/mpRefresh.ts";

const MP_API_BASE = "https://api.mercadopago.com/v1";

// On-demand timeout — must match D1's patient-facing countdown (10:00).
const AUTH_TIMEOUT_MS = 10 * 60 * 1000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const MP_WEBHOOK_SECRET = Deno.env.get("MP_WEBHOOK_SECRET")!;
const MP_CRON_SECRET = Deno.env.get("MP_CRON_SECRET");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

interface PaymentRow {
  id: string;
  mp_payment_id: string | null;
  professional_id: string;
  patient_id: string;
  status: string;
}

interface ConsultationRow {
  id: string;
  patient_id: string;
  professional_id: string;
  status: string;
  payment_status: string;
  is_on_demand: boolean;
}

/** Loads the seller's (professional's) fresh MP access token, or an error string. */
async function getSellerAccessToken(
  supabase: SupabaseClient,
  professionalId: string
): Promise<{ accessToken: string; error: null } | { accessToken: null; error: string }> {
  const { data: mpAccount, error: mpAccErr } = await supabase
    .from("mp_accounts")
    .select("professional_id, access_token, refresh_token, expires_at, active")
    .eq("professional_id", professionalId)
    .eq("active", true)
    .single();

  if (mpAccErr || !mpAccount) {
    return { accessToken: null, error: "Professional's MercadoPago account not found or inactive" };
  }

  const refreshResult = await ensureFreshMpToken(supabase, mpAccount as MpAccountRow, PAYMENT_REFRESH_MARGIN_MS);
  if (refreshResult.invalidGrant) {
    return { accessToken: null, error: "MercadoPago connection expired — professional must reconnect" };
  }
  return { accessToken: refreshResult.accessToken, error: null };
}

/** Captures an authorized pre-auth payment (charges the reserved amount). Idempotent. */
async function captureAuthorizedPayment(
  supabase: SupabaseClient,
  payment: PaymentRow,
  consultationId: string
): Promise<{ status: number; data: unknown; error: string | null }> {
  if (payment.status === "approved") {
    return { status: 200, data: { captured: true, alreadyCaptured: true }, error: null };
  }
  if (payment.status !== "authorized") {
    return { status: 409, data: null, error: `Payment is not authorized (status=${payment.status})` };
  }
  if (!payment.mp_payment_id) {
    return { status: 422, data: null, error: "Payment has no mp_payment_id" };
  }

  const { accessToken, error: tokenError } = await getSellerAccessToken(supabase, payment.professional_id);
  if (!accessToken) return { status: 422, data: null, error: tokenError };

  const idempotencyKey = await sha256Hex(`capture:${payment.id}:${payment.mp_payment_id}`);

  const mpRes = await fetch(`${MP_API_BASE}/payments/${payment.mp_payment_id}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({ capture: true }),
  });

  const mpData = await mpRes.json().catch(() => ({} as Record<string, unknown>));

  if (!mpRes.ok) {
    console.error("mp-capture: MP capture error:", JSON.stringify(mpData));
    return {
      status: 502,
      data: null,
      error: (mpData as { message?: string })?.message ?? "MercadoPago capture failed",
    };
  }

  const now = new Date().toISOString();

  const { error: paymentUpdateErr } = await supabase
    .from("payments")
    .update({ status: "approved", captured_at: now })
    .eq("id", payment.id);
  if (paymentUpdateErr) console.error("mp-capture: payments update error:", paymentUpdateErr.message);

  const { error: consUpdateErr } = await supabase
    .from("consultations")
    .update({ payment_status: "paid", paid_at: now })
    .eq("id", consultationId);
  if (consUpdateErr) console.error("mp-capture: consultations update error:", consUpdateErr.message);

  return { status: 200, data: { captured: true }, error: null };
}

/** Cancels (releases) an authorized pre-auth payment. Idempotent. */
async function cancelAuthorizedPayment(
  supabase: SupabaseClient,
  payment: PaymentRow,
  consultationId: string
): Promise<{ status: number; data: unknown; error: string | null }> {
  if (payment.status === "cancelled") {
    return { status: 200, data: { cancelled: true, alreadyCancelled: true }, error: null };
  }
  if (payment.status !== "authorized") {
    return { status: 409, data: null, error: `Payment is not authorized (status=${payment.status})` };
  }
  if (!payment.mp_payment_id) {
    return { status: 422, data: null, error: "Payment has no mp_payment_id" };
  }

  const { accessToken, error: tokenError } = await getSellerAccessToken(supabase, payment.professional_id);
  if (!accessToken) return { status: 422, data: null, error: tokenError };

  const idempotencyKey = await sha256Hex(`cancel-auth:${payment.id}:${payment.mp_payment_id}`);

  const mpRes = await fetch(`${MP_API_BASE}/payments/${payment.mp_payment_id}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({ status: "cancelled" }),
  });

  const mpData = await mpRes.json().catch(() => ({} as Record<string, unknown>));

  if (!mpRes.ok) {
    console.error("mp-capture: MP cancel-auth error:", JSON.stringify(mpData));
    return {
      status: 502,
      data: null,
      error: (mpData as { message?: string })?.message ?? "MercadoPago authorization cancel failed",
    };
  }

  const now = new Date().toISOString();

  const { error: paymentUpdateErr } = await supabase
    .from("payments")
    .update({ status: "cancelled", auth_cancelled_at: now })
    .eq("id", payment.id);
  if (paymentUpdateErr) console.error("mp-capture: payments update error:", paymentUpdateErr.message);

  const { error: consUpdateErr } = await supabase
    .from("consultations")
    .update({ status: "cancelled", payment_status: "pending_payment" })
    .eq("id", consultationId);
  if (consUpdateErr) console.error("mp-capture: consultations update error:", consUpdateErr.message);

  return { status: 200, data: { cancelled: true }, error: null };
}

interface SweepConsultationJoin {
  id: string;
  status: string;
  is_on_demand: boolean;
  created_at: string;
}

interface SweepPaymentRow extends PaymentRow {
  consultation_id: string;
  consultation: SweepConsultationJoin | SweepConsultationJoin[] | null;
}

function joinedConsultation(row: SweepPaymentRow): SweepConsultationJoin | null {
  if (!row.consultation) return null;
  return Array.isArray(row.consultation) ? row.consultation[0] ?? null : row.consultation;
}

async function runSweep(supabase: SupabaseClient) {
  const cutoffIso = new Date(Date.now() - AUTH_TIMEOUT_MS).toISOString();

  const { data: authorizedPayments, error: fetchErr } = await supabase
    .from("payments")
    .select(
      "id, mp_payment_id, professional_id, patient_id, status, consultation_id, consultation:consultations!consultation_id(id, status, is_on_demand, created_at)"
    )
    .eq("status", "authorized");

  if (fetchErr) {
    console.error("mp-capture: sweep failed to fetch authorized payments:", fetchErr.message);
    return jsonResponse({ data: null, error: "Failed to fetch authorized payments" }, 500);
  }

  const rows = (authorizedPayments ?? []) as SweepPaymentRow[];

  const results = {
    scanned: rows.length,
    cancelled: 0,
    cancelFailed: 0,
    captured: 0,
    captureFailed: 0,
    skipped: 0,
  };

  for (const row of rows) {
    const consultation = joinedConsultation(row);
    if (!consultation) {
      results.skipped++;
      continue;
    }

    const payment: PaymentRow = {
      id: row.id,
      mp_payment_id: row.mp_payment_id,
      professional_id: row.professional_id,
      patient_id: row.patient_id,
      status: row.status,
    };

    // (a) Stuck on-demand authorizations — timed out without ever starting the call.
    const isStuck =
      consultation.is_on_demand &&
      consultation.created_at < cutoffIso &&
      !["in_progress", "completed"].includes(consultation.status);

    // (b) Orphaned authorizations whose consultation already completed —
    //     backstop for a client-side capture call that never fired (D2).
    const isOrphanedComplete = consultation.status === "completed";

    if (isStuck) {
      try {
        const result = await cancelAuthorizedPayment(supabase, payment, consultation.id);
        if (result.error) {
          results.cancelFailed++;
          console.error(`mp-capture: sweep cancel-auth failed for payment ${payment.id}:`, result.error);
        } else {
          results.cancelled++;
        }
      } catch (err) {
        results.cancelFailed++;
        console.error(`mp-capture: sweep cancel-auth threw for payment ${payment.id}:`, err);
      }
      continue;
    }

    if (isOrphanedComplete) {
      try {
        const result = await captureAuthorizedPayment(supabase, payment, consultation.id);
        if (result.error) {
          results.captureFailed++;
          console.error(`mp-capture: sweep capture failed for payment ${payment.id}:`, result.error);
        } else {
          results.captured++;
        }
      } catch (err) {
        results.captureFailed++;
        console.error(`mp-capture: sweep capture threw for payment ${payment.id}:`, err);
      }
      continue;
    }

    results.skipped++;
  }

  console.log("mp-capture: sweep complete", JSON.stringify(results));
  return jsonResponse({ data: results, error: null });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ data: null, error: "Method not allowed" }, 405);
  }

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const action = (body as { action?: string }).action;

    const serviceSupabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      SUPABASE_SERVICE_ROLE_KEY
    );

    // ────────────────────────────────────────────────────────────────────────
    // action: sweep — internal-only, no user JWT
    // ────────────────────────────────────────────────────────────────────────
    if (action === "sweep") {
      const cronSecret = req.headers.get("x-cron-secret");
      const authHeader = req.headers.get("Authorization");
      const isWebhookSecretValid = Boolean(MP_WEBHOOK_SECRET) && cronSecret === MP_WEBHOOK_SECRET;
      const isCronSecretValid = Boolean(MP_CRON_SECRET) && cronSecret === MP_CRON_SECRET;
      const isServiceRoleAuth = authHeader === `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`;

      if (!isWebhookSecretValid && !isCronSecretValid && !isServiceRoleAuth) {
        return jsonResponse({ data: null, error: "Unauthorized" }, 401);
      }

      return await runSweep(serviceSupabase);
    }

    // ────────────────────────────────────────────────────────────────────────
    // All other actions require an authenticated Supabase user.
    // ────────────────────────────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ data: null, error: "Unauthorized" }, 401);

    const authedSupabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authErr } = await authedSupabase.auth.getUser();
    if (authErr || !user) return jsonResponse({ data: null, error: "Unauthorized" }, 401);

    const { data: callerProfile } = await serviceSupabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    const callerRole = callerProfile?.role ?? "patient";
    const isAdmin = callerRole === "admin" || callerRole === "super_admin";

    // ────────────────────────────────────────────────────────────────────────
    // action: capture — professional owner, or admin/super_admin
    // ────────────────────────────────────────────────────────────────────────
    if (action === "capture") {
      const { consultationId } = body as { consultationId?: string };
      if (!consultationId) return jsonResponse({ data: null, error: "Missing consultationId" }, 400);

      const { data: consultation, error: consErr } = await serviceSupabase
        .from("consultations")
        .select("id, patient_id, professional_id, status, payment_status, is_on_demand")
        .eq("id", consultationId)
        .single();
      if (consErr || !consultation) return jsonResponse({ data: null, error: "Consultation not found" }, 404);

      const c = consultation as ConsultationRow;
      // El paciente dueño también puede disparar la captura: finalize() se
      // ejecuta desde ambos lados de la videollamada, y que el paciente
      // confirme el cobro de su propia consulta completada es seguro.
      const isCaptureOwner = c.professional_id === user.id || c.patient_id === user.id;
      if (!isCaptureOwner && !isAdmin) {
        return jsonResponse({ data: null, error: "Forbidden" }, 403);
      }

      const { data: payment, error: paymentErr } = await serviceSupabase
        .from("payments")
        .select("id, mp_payment_id, professional_id, patient_id, status")
        .eq("consultation_id", consultationId)
        .in("status", ["authorized", "approved"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (paymentErr || !payment) {
        return jsonResponse({ data: null, error: "No authorized payment found for this consultation" }, 422);
      }

      const result = await captureAuthorizedPayment(serviceSupabase, payment as PaymentRow, consultationId);
      return jsonResponse({ data: result.data, error: result.error }, result.status);
    }

    // ────────────────────────────────────────────────────────────────────────
    // action: cancel-auth — patient or professional owner, or admin/super_admin
    // ────────────────────────────────────────────────────────────────────────
    if (action === "cancel-auth") {
      const { consultationId } = body as { consultationId?: string };
      if (!consultationId) return jsonResponse({ data: null, error: "Missing consultationId" }, 400);

      const { data: consultation, error: consErr } = await serviceSupabase
        .from("consultations")
        .select("id, patient_id, professional_id, status, payment_status, is_on_demand")
        .eq("id", consultationId)
        .single();
      if (consErr || !consultation) return jsonResponse({ data: null, error: "Consultation not found" }, 404);

      const c = consultation as ConsultationRow;
      const isOwner = c.patient_id === user.id || c.professional_id === user.id;
      if (!isOwner && !isAdmin) {
        return jsonResponse({ data: null, error: "Forbidden" }, 403);
      }

      const { data: payment, error: paymentErr } = await serviceSupabase
        .from("payments")
        .select("id, mp_payment_id, professional_id, patient_id, status")
        .eq("consultation_id", consultationId)
        .in("status", ["authorized", "cancelled"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (paymentErr || !payment) {
        return jsonResponse({ data: null, error: "No authorized payment found for this consultation" }, 422);
      }

      const result = await cancelAuthorizedPayment(serviceSupabase, payment as PaymentRow, consultationId);
      return jsonResponse({ data: result.data, error: result.error }, result.status);
    }

    return jsonResponse({ data: null, error: `Unknown action: ${action ?? "(none)"}` }, 400);
  } catch (err) {
    console.error("mp-capture error:", err);
    return jsonResponse({ data: null, error: err instanceof Error ? err.message : "Internal error" }, 500);
  }
});
