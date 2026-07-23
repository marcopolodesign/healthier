/**
 * mp-connect — MercadoPago Marketplace OAuth Connect
 *
 * GET /mp-connect?action=authorize&professionalId=UUID   (also accepts professional_id)
 *   Redirects the professional to the MP OAuth consent page. The `state` param
 *   is CSRF-hardened: `${professionalId}.${hmac16}` where hmac16 is the first
 *   16 hex chars of HMAC-SHA256(professionalId, MP_WEBHOOK_SECRET).
 *
 * GET /mp-connect?action=callback&code=XXX&state=PROFESSIONAL_ID.HMAC
 *   Verifies the state HMAC, exchanges the auth code for tokens, persists them
 *   (incl. expires_at/live_mode) in mp_accounts, and sets
 *   professional_profiles.mp_connected = true. Redirects to
 *   /profesional/dashboard?mp_connected=1 on success.
 *
 * POST /mp-connect  { action: "disconnect" }  (authenticated — the owning professional)
 *   Marks mp_accounts.active = false and professional_profiles.mp_connected = false
 *   for the caller.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const IS_PROD = Deno.env.get("MP_IS_PROD") === "true";
const MP_CLIENT_ID = IS_PROD
  ? Deno.env.get("MP_CLIENT_ID_PROD")!
  : Deno.env.get("MP_CLIENT_ID_SANDBOX")!;
const MP_CLIENT_SECRET = IS_PROD
  ? Deno.env.get("MP_CLIENT_SECRET_PROD")!
  : Deno.env.get("MP_CLIENT_SECRET_SANDBOX")!;
const REDIRECT_URI = Deno.env.get("MP_REDIRECT_URI")!; // e.g. https://aixjejdoofervrkggbkd.supabase.co/functions/v1/mp-connect?action=callback
const APP_URL = Deno.env.get("APP_URL") ?? "https://healthier.com.ar"; // fallback
const MP_WEBHOOK_SECRET = Deno.env.get("MP_WEBHOOK_SECRET")!; // reused pragmatically as the state-signing secret

// ─── CSRF-hardened state helpers ───────────────────────────────────────────

async function hmacHex(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function buildState(professionalId: string): Promise<string> {
  const sig = (await hmacHex(professionalId, MP_WEBHOOK_SECRET)).slice(0, 16);
  return `${professionalId}.${sig}`;
}

/** Returns the professionalId if the state's HMAC checks out, otherwise null. */
async function verifyState(state: string): Promise<string | null> {
  const dotIdx = state.indexOf(".");
  if (dotIdx === -1) return null;

  const professionalId = state.slice(0, dotIdx);
  const receivedSig = state.slice(dotIdx + 1);
  const expectedSig = (await hmacHex(professionalId, MP_WEBHOOK_SECRET)).slice(0, 16);

  return receivedSig === expectedSig ? professionalId : null;
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    // ─── POST: disconnect (authenticated, owning professional only) ─────────
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({} as Record<string, unknown>));
      const postAction = (body as { action?: string }).action ?? action;

      if (postAction !== "disconnect") {
        return new Response(
          JSON.stringify({ error: `Unknown POST action: ${postAction ?? "(none)"}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const authHeader = req.headers.get("Authorization");
      if (!authHeader) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const authedSupabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } }
      );

      const { data: { user }, error: authErr } = await authedSupabase.auth.getUser();
      if (authErr || !user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const serviceSupabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );

      const { error: mpErr } = await serviceSupabase
        .from("mp_accounts")
        .update({ active: false })
        .eq("professional_id", user.id);

      const { error: profErr } = await serviceSupabase
        .from("professional_profiles")
        .update({ mp_connected: false })
        .eq("user_id", user.id);

      if (mpErr || profErr) {
        console.error("mp-connect disconnect error:", mpErr?.message, profErr?.message);
        return new Response(
          JSON.stringify({ data: null, error: "Failed to disconnect MercadoPago account" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ data: { disconnected: true }, error: null }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ─── 1. Authorize ────────────────────────────────────────────────────────
    if (action === "authorize") {
      const professionalId =
        url.searchParams.get("professionalId") ?? url.searchParams.get("professional_id");
      if (!professionalId) {
        return new Response(
          JSON.stringify({ error: "Missing professionalId" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const state = await buildState(professionalId);

      const authUrl = new URL("https://auth.mercadopago.com/authorization");
      authUrl.searchParams.set("client_id", MP_CLIENT_ID);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("platform_id", "mp");
      authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
      authUrl.searchParams.set("state", state); // carried back in callback, HMAC-verified there

      return Response.redirect(authUrl.toString(), 302);
    }

    // ─── 2. Callback ─────────────────────────────────────────────────────────
    if (action === "callback") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");

      if (!code || !state) {
        return new Response(
          JSON.stringify({ error: "Missing code or state" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const professionalId = await verifyState(state);
      if (!professionalId) {
        console.warn("mp-connect callback: invalid state HMAC");
        return Response.redirect(
          `${APP_URL}/profesional/dashboard?mp_error=invalid_state`,
          302
        );
      }

      // Exchange authorization code for tokens
      const tokenRes = await fetch(
        "https://api.mercadopago.com/oauth/token",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: MP_CLIENT_ID,
            client_secret: MP_CLIENT_SECRET,
            code,
            redirect_uri: REDIRECT_URI,
            grant_type: "authorization_code",
          }),
        }
      );

      if (!tokenRes.ok) {
        const errText = await tokenRes.text();
        console.error("MP token exchange failed:", errText);
        return Response.redirect(
          `${APP_URL}/profesional/dashboard?mp_error=token_exchange`,
          302
        );
      }

      const tokenData = (await tokenRes.json()) as {
        access_token: string;
        refresh_token: string;
        public_key: string;
        collector_id: number;
        scope: string;
        expires_in: number;
        token_type: string;
        live_mode?: boolean;
      };

      // Persist to mp_accounts using service role (bypasses RLS)
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );

      const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

      const { error: upsertErr } = await supabase
        .from("mp_accounts")
        .upsert(
          {
            professional_id: professionalId,
            mp_user_id: String(tokenData.collector_id),
            access_token: tokenData.access_token,
            refresh_token: tokenData.refresh_token,
            public_key: tokenData.public_key,
            scope: tokenData.scope,
            connected_at: new Date().toISOString(),
            active: true,
            expires_at: expiresAt,
            live_mode: tokenData.live_mode ?? null,
          },
          { onConflict: "professional_id" }
        );

      if (upsertErr) {
        console.error("mp_accounts upsert error:", upsertErr);
        return Response.redirect(
          `${APP_URL}/profesional/dashboard?mp_error=db_save`,
          302
        );
      }

      const { error: profErr } = await supabase
        .from("professional_profiles")
        .update({ mp_connected: true })
        .eq("user_id", professionalId);

      if (profErr) {
        // Account is connected on the MP side and mp_accounts is saved — log but
        // don't fail the redirect; mp_connected will self-heal on next mp-refresh-tokens
        // sweep or the next successful reconnect.
        console.error("professional_profiles.mp_connected update error:", profErr);
      }

      // All good — send back to professional dashboard
      return Response.redirect(
        `${APP_URL}/profesional/dashboard?mp_connected=1`,
        302
      );
    }

    // ─── Unknown action ───────────────────────────────────────────────────────
    return new Response(
      JSON.stringify({ error: `Unknown action: ${action ?? "(none)"}` }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("mp-connect error:", err);
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
