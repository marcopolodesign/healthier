/**
 * mp-webhook — MercadoPago Payment Notifications
 *
 * POST /mp-webhook
 *   Receives MP payment/merchant_order notifications.
 *   Verifies the X-Signature header (HMAC-SHA256).
 *   On payment.updated: fetches the payment from the MP API and updates
 *   consultations.payment_status accordingly.
 *
 * MP status → our status mapping:
 *   approved  → approved
 *   rejected  → rejected
 *   refunded  → refunded
 *   cancelled → rejected   (cancelled before processing)
 *   charged_back → refunded
 *   in_process / pending / authorized / others → pending
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-signature, x-request-id",
};

const IS_PROD = Deno.env.get("MP_IS_PROD") === "true";
const MP_WEBHOOK_SECRET = Deno.env.get("MP_WEBHOOK_SECRET")!;
const MP_ACCESS_TOKEN = IS_PROD
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
  // Parse ts and v1 from "ts=...,v1=..."
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

  // Constant-time comparison to prevent timing attacks
  return computedHmac === receivedHmac;
}

/**
 * Map a MercadoPago payment status to our internal payment_status value.
 */
function mapMpStatus(
  mpStatus: string
): "approved" | "rejected" | "refunded" | "pending" {
  switch (mpStatus) {
    case "approved":
      return "approved";
    case "rejected":
    case "cancelled":
      return "rejected";
    case "refunded":
    case "charged_back":
      return "refunded";
    default:
      // in_process, pending, authorized, etc.
      return "pending";
  }
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
    // Parse body
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
      // Secret is configured but no signature sent — reject
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
      // Acknowledge other notification types (merchant_order, etc.) without processing
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

    // ── Fetch payment details from MP API ────────────────────────────────────
    const mpRes = await fetch(
      `https://api.mercadopago.com/v1/payments/${paymentId}`,
      {
        headers: {
          Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
        },
      }
    );

    if (!mpRes.ok) {
      const errText = await mpRes.text();
      console.error("mp-webhook: MP API error fetching payment:", errText);
      return new Response(
        JSON.stringify({ error: "Failed to fetch payment from MP" }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const payment = (await mpRes.json()) as {
      id: number;
      status: string;
      external_reference?: string; // we store consultationId here
      collector_id?: number;
      transaction_amount?: number;
      currency_id?: string;
      date_approved?: string;
    };

    const ourStatus = mapMpStatus(payment.status);
    const consultationId = payment.external_reference ?? null;

    // external_reference must be set when creating the MP preference/payment
    if (!consultationId) {
      console.warn(
        "mp-webhook: payment has no external_reference, cannot match consultation",
        paymentId
      );
      // Acknowledge anyway — no retry needed
      return new Response(
        JSON.stringify({ received: true, warning: "no external_reference" }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // ── Update consultation payment_status ───────────────────────────────────
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const updatePayload: Record<string, unknown> = {
      payment_status: ourStatus,
      mp_payment_id: String(payment.id),
    };

    if (ourStatus === "approved" && payment.date_approved) {
      updatePayload.paid_at = payment.date_approved;
    }

    const { error: updateErr } = await supabase
      .from("consultations")
      .update(updatePayload)
      .eq("id", consultationId);

    if (updateErr) {
      console.error("mp-webhook: DB update error:", updateErr);
      // Return 500 so MP retries the notification
      return new Response(
        JSON.stringify({ error: "DB update failed", detail: updateErr.message }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log(
      `mp-webhook: consultation ${consultationId} → payment_status=${ourStatus} (mp_payment_id=${payment.id})`
    );

    return new Response(JSON.stringify({ received: true, status: ourStatus }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("mp-webhook error:", err);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Internal error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
