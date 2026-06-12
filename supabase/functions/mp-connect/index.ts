/**
 * mp-connect — MercadoPago Marketplace OAuth Connect
 *
 * GET /mp-connect?action=authorize&professionalId=UUID
 *   Redirects the professional to the MP OAuth consent page.
 *
 * GET /mp-connect?action=callback&code=XXX&state=PROFESSIONAL_ID
 *   Exchanges the auth code for tokens and persists them in mp_accounts.
 *   Redirects to /profesional/dashboard?mp_connected=1 on success.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MP_CLIENT_ID = Deno.env.get("MP_CLIENT_ID")!;
const MP_CLIENT_SECRET = Deno.env.get("MP_CLIENT_SECRET")!;
const REDIRECT_URI = Deno.env.get("MP_REDIRECT_URI")!; // e.g. https://aixjejdoofervrkggbkd.supabase.co/functions/v1/mp-connect?action=callback
const APP_URL = Deno.env.get("APP_URL") ?? "https://healthier.com.ar"; // fallback

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    // ─── 1. Authorize ────────────────────────────────────────────────────────
    if (action === "authorize") {
      const professionalId = url.searchParams.get("professionalId");
      if (!professionalId) {
        return new Response(
          JSON.stringify({ error: "Missing professionalId" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const authUrl = new URL("https://auth.mercadopago.com/authorization");
      authUrl.searchParams.set("client_id", MP_CLIENT_ID);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("platform_id", "mp");
      authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
      authUrl.searchParams.set("state", professionalId); // carried back in callback

      return Response.redirect(authUrl.toString(), 302);
    }

    // ─── 2. Callback ─────────────────────────────────────────────────────────
    if (action === "callback") {
      const code = url.searchParams.get("code");
      const professionalId = url.searchParams.get("state");

      if (!code || !professionalId) {
        return new Response(
          JSON.stringify({ error: "Missing code or state" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
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
      };

      // Persist to mp_accounts using service role (bypasses RLS)
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );

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
