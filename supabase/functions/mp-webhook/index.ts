/**
 * mp-webhook — MercadoPago Payment Notifications
 *
 * POST /mp-webhook
 *   Receives MP payment/merchant_order notifications.
 *   Verifies the X-Signature header (HMAC-SHA256) — unchanged infra, still the
 *   platform application's own webhook secret even though payments are now
 *   created with the seller's OAuth token (SECCIÓN A.7).
 *   On payment.updated: fetches the payment from the MP API and updates both
 *   `consultations.payment_status` and the matching `payments` row.
 *
 * MP status → our status mapping:
 *   consultations.payment_status : payments.status
 *   approved            → paid      : approved
 *   rejected / cancelled → rejected  : rejected
 *   refunded / charged_back → refunded : refunded
 *   in_process / pending / authorized / others → in_process : pending
 *
 * Fetching the payment: payments created with a seller's OAuth token may not
 * be fetchable with the platform's own access_token (SECCIÓN A.8-d, empirical
 * verification pending in sandbox). We look up our own `payments` row by
 * mp_payment_id first — if found, fetch using that professional's (refreshed)
 * seller token; otherwise fall back to the platform token. Whichever succeeds
 * first wins.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ensureFreshMpToken, PAYMENT_REFRESH_MARGIN_MS } from "../_shared/mpRefresh.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-signature, x-request-id",
};

const IS_PROD = Deno.env.get("MP_IS_PROD") === "true";
const MP_WEBHOOK_SECRET = Deno.env.get("MP_WEBHOOK_SECRET")!;
const MP_PLATFORM_ACCESS_TOKEN = IS_PROD
  ? Deno.env.get("MP_ACCESS_TOKEN_PROD")!
  : Deno.env.get("MP_ACCESS_TOKEN_SANDBOX")!;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Verify MercadoPago's X-Signature header.
 * Format: "ts=<timestamp>,v1=<hex-hmac>"
 * Signed string: "id:<notificationId>;request-id:<x-request-id>;ts:<timestamp>;"
 *
 * Docs: https://www.mercadopago.com.ar/developers/en/docs/your-integrations/notifications/webhooks
 */
async function verifySignature(
  req: Request,
  xSignature: string,
  notificationId: string
): Promise<boolean> {
  const parts = Object.fromEntries(
    xSignature.split(",").map((p) => p.trim().split("=") as [string, string])
  );
  const ts = parts["ts"];
  const receivedHmac = parts["v1"];

  if (!ts || !receivedHmac) return false;

  const xRequestId = req.headers.get("x-request-id") ?? "";
  const signedString = `id:${notificationId};request-id:${xRequestId};ts:${ts};`;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(MP_WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signedString)
  );

  const computedHmac = Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return computedHmac === receivedHmac;
}

/** Maps an MP payment status to our internal vocabularies. */
function mapMpStatus(mpStatus: string): {
  consultationStatus: "paid" | "rejected" | "refunded" | "in_process";
  paymentsStatus: "approved" | "rejected" | "refunded" | "pending";
} {
  switch (mpStatus) {
    case "approved":
      return { consultationStatus: "paid", paymentsStatus: "approved" };
    case "rejected":
    case "cancelled":
      return { consultationStatus: "rejected", paymentsStatus: "rejected" };
    case "refunded":
    case "charged_back":
      return { consultationStatus: "refunded", paymentsStatus: "refunded" };
    default:
      // in_process, pending, authorized, in_mediation, etc.
      return { consultationStatus: "in_process", paymentsStatus: "pending" };
  }
}

interface MpFeeDetail {
  type?: string;
  amount?: number;
}

interface MpPayment {
  id: number;
  status: string;
  status_detail?: string;
  external_reference?: string; // consultationId
  collector_id?: number;
  transaction_amount?: number;
  currency_id?: string;
  date_approved?: string;
  fee_details?: MpFeeDetail[];
  charges_details?: MpFeeDetail[];
}

function extractMpFeeActual(payment: MpPayment): number | null {
  const fromFeeDetails = payment.fee_details?.find((f) => f.type === "mercadopago_fee")?.amount;
  if (typeof fromFeeDetails === "number") return fromFeeDetails;

  const fromCharges = payment.charges_details?.find(
    (f) => f.type?.toLowerCase().includes("mercadopago_fee")
  )?.amount;
  if (typeof fromCharges === "number") return fromCharges;

  return null;
}

// ─── Handler ─────────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = (await req.json()) as {
      type?: string;
      action?: string;
      data?: { id?: string | number };
      id?: string | number;
    };

    const notificationType = body.type ?? body.action ?? "";
    const notificationId = String(body.id ?? body.data?.id ?? "");

    // ── Signature verification ───────────────────────────────────────────────
    const xSignature = req.headers.get("x-signature");

    if (MP_WEBHOOK_SECRET && xSignature) {
      const valid = await verifySignature(req, xSignature, notificationId);
      if (!valid) {
        console.warn("mp-webhook: invalid signature");
        return new Response(JSON.stringify({ error: "Invalid signature" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else if (MP_WEBHOOK_SECRET && !xSignature) {
      console.warn("mp-webhook: missing X-Signature header");
      return new Response(JSON.stringify({ error: "Missing signature" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // If MP_WEBHOOK_SECRET is not set (dev/test), skip verification

    // ── Only handle payment notifications ───────────────────────────────────
    if (
      notificationType !== "payment" &&
      notificationType !== "payment.updated" &&
      notificationType !== "payment.created"
    ) {
      return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const paymentId = String(body.data?.id ?? notificationId);
    if (!paymentId) {
      return new Response(JSON.stringify({ error: "Missing payment id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ── Look up our own payments row first — lets us fetch with the seller's
    //    own OAuth token, which is very likely required for a payment created
    //    under that seller's account (SECCIÓN A.8-d — unverified in sandbox yet).
    const { data: existingPaymentRow } = await supabase
      .from("payments")
      .select("id, consultation_id, professional_id")
      .eq("mp_payment_id", paymentId)
      .maybeSingle();

    let sellerAccessToken: string | null = null;
    if (existingPaymentRow?.professional_id) {
      const { data: mpAccount } = await supabase
        .from("mp_accounts")
        .select("professional_id, access_token, refresh_token, expires_at, active")
        .eq("professional_id", existingPaymentRow.professional_id)
        .eq("active", true)
        .maybeSingle();

      if (mpAccount) {
        const refreshResult = await ensureFreshMpToken(supabase, mpAccount, PAYMENT_REFRESH_MARGIN_MS);
        sellerAccessToken = refreshResult.accessToken;
      }
    }

    // ── Fetch payment details from MP — try seller token first, then platform token.
    let payment: MpPayment | null = null;
    for (const token of [sellerAccessToken, MP_PLATFORM_ACCESS_TOKEN].filter(Boolean) as string[]) {
      const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (mpRes.ok) {
        payment = (await mpRes.json()) as MpPayment;
        break;
      }
      console.warn(`mp-webhook: fetch with ${token === sellerAccessToken ? "seller" : "platform"} token failed (${mpRes.status})`);
    }

    if (!payment) {
      console.error("mp-webhook: could not fetch payment from MP with any available token");
      return new Response(
        JSON.stringify({ error: "Failed to fetch payment from MP" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { consultationStatus, paymentsStatus } = mapMpStatus(payment.status);
    const consultationId = payment.external_reference ?? existingPaymentRow?.consultation_id ?? null;

    if (!consultationId) {
      console.warn("mp-webhook: payment has no external_reference and no matching payments row", paymentId);
      return new Response(
        JSON.stringify({ received: true, warning: "no external_reference" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const mpFeeActual = extractMpFeeActual(payment);

    // ── Update consultations ─────────────────────────────────────────────────
    const consUpdate: Record<string, unknown> = {
      payment_status: consultationStatus,
      mp_payment_id: String(payment.id),
    };
    if (consultationStatus === "paid" && payment.date_approved) {
      consUpdate.paid_at = payment.date_approved;
    }

    const { error: consUpdateErr } = await supabase
      .from("consultations")
      .update(consUpdate)
      .eq("id", consultationId);

    if (consUpdateErr) {
      console.error("mp-webhook: consultations update error:", consUpdateErr);
      return new Response(
        JSON.stringify({ error: "DB update failed", detail: consUpdateErr.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Update the matching payments row ─────────────────────────────────────
    const paymentUpdate: Record<string, unknown> = {
      status: paymentsStatus,
      status_detail: payment.status_detail ?? null,
      mp_payment_id: String(payment.id),
    };
    if (mpFeeActual !== null) paymentUpdate.mp_fee_actual = mpFeeActual;
    if (payment.collector_id) paymentUpdate.collector_id = String(payment.collector_id);

    let paymentUpdateErr = null as { message: string } | null;

    if (existingPaymentRow) {
      const { error } = await supabase.from("payments").update(paymentUpdate).eq("id", existingPaymentRow.id);
      paymentUpdateErr = error;
    } else {
      // Fallback: match by consultation_id on the most recent pending/rejected row
      // still missing mp_payment_id (webhook arrived before mp-payment's own write).
      const { data: fallbackRow } = await supabase
        .from("payments")
        .select("id")
        .eq("consultation_id", consultationId)
        .is("mp_payment_id", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (fallbackRow) {
        const { error } = await supabase.from("payments").update(paymentUpdate).eq("id", fallbackRow.id);
        paymentUpdateErr = error;
      } else {
        console.warn(`mp-webhook: no payments row found to reconcile for consultation ${consultationId}`);
      }
    }

    if (paymentUpdateErr) {
      console.error("mp-webhook: payments update error:", paymentUpdateErr);
      return new Response(
        JSON.stringify({ error: "DB update failed", detail: paymentUpdateErr.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Informational only: the professional's contractual net (net_to_professional,
    // committed as 78% of gross) is never overwritten with the actual-fee-adjusted
    // figure — Healthier absorbs the delta between estimated and actual MP fee. We
    // just log it for visibility/reconciliation.
    if (mpFeeActual !== null) {
      console.log(
        `mp-webhook: consultation ${consultationId} reconciled mp_fee_actual=${mpFeeActual} (payment ${payment.id})`
      );
    }

    console.log(
      `mp-webhook: consultation ${consultationId} → payment_status=${consultationStatus} (mp_payment_id=${payment.id})`
    );

    return new Response(
      JSON.stringify({ received: true, status: consultationStatus }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("mp-webhook error:", err);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Internal error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
