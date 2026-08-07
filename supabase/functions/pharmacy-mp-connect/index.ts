/**
 * pharmacy-mp-connect — MercadoPago OAuth Connect for the pharmacy beneficiary.
 * Structural duplicate of mp-connect/index.ts (professional OAuth) — kept
 * separate rather than parameterizing mp-connect, same reasoning as
 * pharmacy_mp_accounts being its own table.
 *
 * GET /pharmacy-mp-connect?action=authorize&pharmacyId=UUID
 *   Redirects to the MP OAuth consent page. `state` = `${pharmacyId}.${hmac16}`.
 *
 * GET /pharmacy-mp-connect?action=callback&code=XXX&state=PHARMACY_ID.HMAC
 *   Exchanges the code, persists tokens in pharmacy_mp_accounts, sets
 *   pharmacies.mp_connected = true. Redirects to /farmacia/configuracion?mp_connected=1.
 *
 * POST /pharmacy-mp-connect  { action: "disconnect", pharmacyId }
 *   (authenticated — pharmacy_admin or super_admin) Marks
 *   pharmacy_mp_accounts.active = false and pharmacies.mp_connected = false.
 *
 * ⚠️ Requires a dedicated MP_REDIRECT_URI registered in the MercadoPago
 * developer app's allowed redirect URLs (manual step, not doable via API) —
 * see PHARMACY_MP_REDIRECT_URI below.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encryptToken } from "../_shared/tokenCrypto.ts";
import { buildOAuthState, verifyOAuthState } from "../_shared/oauthState.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const IS_PROD = Deno.env.get("MP_IS_PROD") === "true";
const MP_CLIENT_ID = IS_PROD
  ? Deno.env.get("MP_CLIENT_ID_PROD")!
  : Deno.env.get("MP_CLIENT_ID_SANDBOX")!;
const MP_CLIENT_SECRET = IS_PROD
  ? Deno.env.get("MP_CLIENT_SECRET_PROD")!
  : Deno.env.get("MP_CLIENT_SECRET_SANDBOX")!;
const REDIRECT_URI = Deno.env.get("PHARMACY_MP_REDIRECT_URI")!; // e.g. https://aixjejdoofervrkggbkd.supabase.co/functions/v1/pharmacy-mp-connect?action=callback
const APP_URL = Deno.env.get("APP_URL") ?? "https://healthier.com.ar";
const MP_WEBHOOK_SECRET = Deno.env.get("MP_WEBHOOK_SECRET")!; // reused as the state-signing secret, same as mp-connect

const buildState = (pharmacyId: string) => buildOAuthState(pharmacyId, MP_WEBHOOK_SECRET);
const verifyState = (state: string) => verifyOAuthState(state, MP_WEBHOOK_SECRET);

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    let action = url.searchParams.get("action");
    if (!action) {
      if (url.searchParams.get("code") && url.searchParams.get("state")) {
        action = "callback";
      } else if (url.searchParams.get("pharmacyId")) {
        action = "authorize";
      }
    }

    // ─── POST: disconnect (authenticated, pharmacy_admin/super_admin only) ──
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({} as Record<string, unknown>));
      const postAction = (body as { action?: string }).action ?? action;
      const pharmacyId = (body as { pharmacyId?: string }).pharmacyId;

      if (postAction !== "disconnect") {
        return new Response(
          JSON.stringify({ error: `Unknown POST action: ${postAction ?? "(none)"}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (!pharmacyId) {
        return new Response(JSON.stringify({ error: "Missing pharmacyId" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const authHeader = req.headers.get("Authorization");
      if (!authHeader) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
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
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const serviceSupabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );

      // Caller must be pharmacy_admin or super_admin — enforced here since
      // this endpoint runs as service_role and bypasses RLS.
      const { data: callerProfile } = await serviceSupabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();
      if (!callerProfile || !["pharmacy_admin", "super_admin"].includes(callerProfile.role)) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const [{ error: mpErr }, { error: pharmErr }] = await Promise.all([
        serviceSupabase.from("pharmacy_mp_accounts").update({ active: false }).eq("pharmacy_id", pharmacyId),
        serviceSupabase.from("pharmacies").update({ mp_connected: false }).eq("id", pharmacyId),
      ]);

      if (mpErr || pharmErr) {
        console.error("pharmacy-mp-connect disconnect error:", mpErr?.message, pharmErr?.message);
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

    // ─── 1. Authorize ──────────────────────────────────────────────────────
    if (action === "authorize") {
      const pharmacyId = url.searchParams.get("pharmacyId");
      if (!pharmacyId) {
        return new Response(JSON.stringify({ error: "Missing pharmacyId" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const state = await buildState(pharmacyId);
      const authUrl = new URL("https://auth.mercadopago.com/authorization");
      authUrl.searchParams.set("client_id", MP_CLIENT_ID);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("platform_id", "mp");
      authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
      authUrl.searchParams.set("state", state);

      return Response.redirect(authUrl.toString(), 302);
    }

    // ─── 2. Callback ───────────────────────────────────────────────────────
    if (action === "callback") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");

      if (!code || !state) {
        return new Response(JSON.stringify({ error: "Missing code or state" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const pharmacyId = await verifyState(state);
      if (!pharmacyId) {
        console.warn("pharmacy-mp-connect callback: invalid state HMAC");
        return Response.redirect(`${APP_URL}/farmacia/configuracion?mp_error=invalid_state`, 302);
      }

      const tokenRes = await fetch("https://api.mercadopago.com/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: MP_CLIENT_ID,
          client_secret: MP_CLIENT_SECRET,
          code,
          redirect_uri: REDIRECT_URI,
          grant_type: "authorization_code",
        }),
      });

      if (!tokenRes.ok) {
        const errText = await tokenRes.text();
        console.error("MP token exchange failed:", errText);
        return Response.redirect(`${APP_URL}/farmacia/configuracion?mp_error=token_exchange`, 302);
      }

      const tokenData = (await tokenRes.json()) as {
        access_token: string;
        refresh_token: string;
        public_key: string;
        collector_id?: number;
        user_id?: number;
        expires_in: number;
        live_mode?: boolean;
      };

      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );

      const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

      let mpNickname: string | null = null;
      let mpEmail: string | null = null;
      try {
        const meRes = await fetch("https://api.mercadopago.com/users/me", {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });
        if (meRes.ok) {
          const me = (await meRes.json()) as { nickname?: string; email?: string };
          mpNickname = me.nickname ?? null;
          mpEmail = me.email ?? null;
        } else {
          console.warn("pharmacy-mp-connect: GET /users/me failed", meRes.status, await meRes.text());
        }
      } catch (meErr) {
        console.error("pharmacy-mp-connect: GET /users/me error (non-fatal):", meErr);
      }

      const [encryptedAccessToken, encryptedRefreshToken] = await Promise.all([
        encryptToken(tokenData.access_token),
        encryptToken(tokenData.refresh_token),
      ]);

      const { error: upsertErr } = await supabase
        .from("pharmacy_mp_accounts")
        .upsert(
          {
            pharmacy_id: pharmacyId,
            mp_user_id: String(tokenData.user_id ?? tokenData.collector_id ?? ""),
            access_token: encryptedAccessToken,
            refresh_token: encryptedRefreshToken,
            public_key: tokenData.public_key,
            connected_at: new Date().toISOString(),
            active: true,
            expires_at: expiresAt,
            live_mode: tokenData.live_mode ?? null,
            mp_nickname: mpNickname,
            mp_email: mpEmail,
          },
          { onConflict: "pharmacy_id" }
        );

      if (upsertErr) {
        console.error("pharmacy_mp_accounts upsert error:", upsertErr);
        return Response.redirect(`${APP_URL}/farmacia/configuracion?mp_error=db_save`, 302);
      }

      const { error: pharmErr } = await supabase
        .from("pharmacies")
        .update({ mp_connected: true })
        .eq("id", pharmacyId);

      if (pharmErr) {
        console.error("pharmacies.mp_connected update error:", pharmErr);
      }

      return Response.redirect(`${APP_URL}/farmacia/configuracion?mp_connected=1`, 302);
    }

    return new Response(
      JSON.stringify({ error: `Unknown action: ${action ?? "(none)"}` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("pharmacy-mp-connect error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
