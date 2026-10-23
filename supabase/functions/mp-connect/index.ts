/**
 * mp-connect — MercadoPago Marketplace OAuth Connect (profesional)
 *
 * POST /mp-connect  { action: "authorize" }        Authorization: Bearer <JWT del profesional>
 *   (también GET ?action=authorize con el mismo header)
 *   Devuelve `{ data: { url }, error: null }` con la URL de autorización de MP;
 *   el front navega a ella. El `state` se arma con el `user.id` del JWT —
 *   cualquier professionalId que venga en la URL o el body se IGNORA— y vence
 *   a los 15 minutos (ver _shared/oauthState.ts).
 *   Sin sesión válida: 401 (o, si es una navegación del browser de un cliente
 *   viejo, redirect a /profesional/dashboard?mp_error=reintentar). Nunca OAuth.
 *
 *   🔴 Hasta el 2026-10-23 este paso aceptaba `?professionalId=<cualquiera>`
 *   sin sesión y firmaba el state con ese id: cualquiera podía completar el
 *   OAuth con SU cuenta de MP y el callback la guardaba como la del profesional
 *   víctima — los cobros iban a la cuenta del atacante.
 *
 * GET /mp-connect?code=XXX&state=v2.<id>.<exp>.<sig>   (lo llama Mercado Pago)
 *   Verifica el state (firma + vencimiento), canjea el code por tokens, los
 *   guarda en mp_accounts y marca professional_profiles.mp_connected = true.
 *   Redirige a /profesional/dashboard?mp_connected=1 (o ?mp_error=...).
 *   También trae la identidad del vendedor (GET /users/me) — best-effort — y
 *   la guarda como mp_accounts.mp_nickname/mp_email + el label desnormalizado
 *   professional_profiles.mp_account_label.
 *
 * POST /mp-connect  { action: "disconnect" }       Authorization: Bearer <JWT>
 *   Desconecta la cuenta del dueño del JWT (nunca la de un id del body).
 *
 * `verify_jwt = false` en supabase/config.toml (el callback llega sin JWT):
 * cada acción valida su propia autenticación acá adentro.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { encryptToken } from "../_shared/tokenCrypto.ts";
import { buildOAuthState, verifyOAuthState } from "../_shared/oauthState.ts";
import {
  corsHeaders,
  isBrowserNavigation,
  json,
  serviceClient,
  userFromRequest,
} from "../_shared/mpConnectAuth.ts";

const IS_PROD = Deno.env.get("MP_IS_PROD") === "true";
const MP_CLIENT_ID = IS_PROD
  ? Deno.env.get("MP_CLIENT_ID_PROD")!
  : Deno.env.get("MP_CLIENT_ID_SANDBOX")!;
const MP_CLIENT_SECRET = IS_PROD
  ? Deno.env.get("MP_CLIENT_SECRET_PROD")!
  : Deno.env.get("MP_CLIENT_SECRET_SANDBOX")!;
const REDIRECT_URI = Deno.env.get("MP_REDIRECT_URI")!; // e.g. https://aixjejdoofervrkggbkd.supabase.co/functions/v1/mp-connect
const APP_URL = Deno.env.get("APP_URL") ?? "https://healthier.com.ar"; // fallback
const MP_WEBHOOK_SECRET = Deno.env.get("MP_WEBHOOK_SECRET")!; // reused pragmatically as the state-signing secret

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    // Route without requiring ?action= — MP's app panel rejects redirect URLs
    // with query strings, so the registered redirect URI is the bare function
    // URL and the callback is recognized by the presence of code+state.
    let action = url.searchParams.get("action");
    if (!action) {
      if (url.searchParams.get("code") && url.searchParams.get("state")) {
        action = "callback";
      } else if (
        url.searchParams.get("professionalId") ??
        url.searchParams.get("professional_id")
      ) {
        action = "authorize"; // links viejos: caen en el 401 / redirect de abajo
      }
    }
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({} as Record<string, unknown>));
      action = (body as { action?: string }).action ?? action;
      if (action === "callback") return json({ error: "callback is GET-only" }, 405);
    }

    // ─── 1. Authorize (exige la sesión del profesional) ─────────────────────
    if (action === "authorize") {
      const user = await userFromRequest(req);
      if (!user) {
        if (isBrowserNavigation(req)) {
          return Response.redirect(`${APP_URL}/profesional/dashboard?mp_error=reintentar`, 302);
        }
        return json({ error: "Unauthorized: iniciá sesión y volvé a tocar Conectar" }, 401);
      }

      const { data: pro, error: proErr } = await serviceClient()
        .from("professional_profiles")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (proErr) throw proErr;
      if (!pro) return json({ error: "Forbidden: sólo un profesional puede conectar su Mercado Pago" }, 403);

      const state = await buildOAuthState("mp-connect", user.id, MP_WEBHOOK_SECRET);

      const authUrl = new URL("https://auth.mercadopago.com/authorization");
      authUrl.searchParams.set("client_id", MP_CLIENT_ID);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("platform_id", "mp");
      authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
      authUrl.searchParams.set("state", state); // carried back in callback, HMAC-verified there

      return json({ data: { url: authUrl.toString() }, error: null });
    }

    // ─── Disconnect (POST, dueño del JWT) ───────────────────────────────────
    if (action === "disconnect") {
      if (req.method !== "POST") return json({ error: "disconnect is POST-only" }, 405);
      const user = await userFromRequest(req);
      if (!user) return json({ error: "Unauthorized" }, 401);

      const serviceSupabase = serviceClient();
      const { error: mpErr } = await serviceSupabase
        .from("mp_accounts")
        .update({ active: false })
        .eq("professional_id", user.id);

      const { error: profErr } = await serviceSupabase
        .from("professional_profiles")
        .update({ mp_connected: false, mp_account_label: null })
        .eq("user_id", user.id);

      if (mpErr || profErr) {
        console.error("mp-connect disconnect error:", mpErr?.message, profErr?.message);
        return json({ data: null, error: "Failed to disconnect MercadoPago account" }, 500);
      }

      return json({ data: { disconnected: true }, error: null });
    }

    // ─── 2. Callback ─────────────────────────────────────────────────────────
    if (action === "callback" && req.method === "GET") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");

      if (!code || !state) {
        return json({ error: "Missing code or state" }, 400);
      }

      const check = await verifyOAuthState("mp-connect", state, MP_WEBHOOK_SECRET);
      if (!check.ok) {
        console.warn(`mp-connect callback: state ${check.reason}`);
        const mpError = check.reason === "expired" ? "state_expired" : "invalid_state";
        return Response.redirect(`${APP_URL}/profesional/dashboard?mp_error=${mpError}`, 302);
      }
      const professionalId = check.entityId;

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
        collector_id?: number;
        user_id?: number;
        scope: string;
        expires_in: number;
        token_type: string;
        live_mode?: boolean;
      };

      // Persist to mp_accounts using service role (bypasses RLS)
      const supabase = serviceClient();

      const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

      // Fetch the seller's MP identity (nickname/email) so it can be shown
      // back to the professional and to the super-admin — best-effort, never
      // fails the connect flow (the token is already valid at this point).
      let mpNickname: string | null = null;
      let mpEmail: string | null = null;
      let mpAccountLabel: string | null = null;
      try {
        const meRes = await fetch("https://api.mercadopago.com/users/me", {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });
        if (meRes.ok) {
          const me = (await meRes.json()) as {
            nickname?: string;
            email?: string;
            first_name?: string;
            last_name?: string;
          };
          mpNickname = me.nickname ?? null;
          mpEmail = me.email ?? null;
          const fullName = [me.first_name, me.last_name].filter(Boolean).join(" ") || null;
          const primary = mpNickname ?? fullName;
          mpAccountLabel = primary
            ? mpEmail
              ? `${primary} · ${mpEmail}`
              : primary
            : mpEmail;
        } else {
          console.warn("mp-connect: GET /users/me failed", meRes.status, await meRes.text());
        }
      } catch (meErr) {
        console.error("mp-connect: GET /users/me error (non-fatal):", meErr);
      }

      const [encryptedAccessToken, encryptedRefreshToken] = await Promise.all([
        encryptToken(tokenData.access_token),
        encryptToken(tokenData.refresh_token),
      ]);

      const { error: upsertErr } = await supabase
        .from("mp_accounts")
        .upsert(
          {
            professional_id: professionalId,
            // MP's OAuth response uses `user_id` (seller's MP id); older docs
            // called it collector_id — accept both.
            mp_user_id: String(tokenData.user_id ?? tokenData.collector_id ?? ""),
            access_token: encryptedAccessToken,
            refresh_token: encryptedRefreshToken,
            public_key: tokenData.public_key,
            scope: tokenData.scope,
            connected_at: new Date().toISOString(),
            active: true,
            expires_at: expiresAt,
            live_mode: tokenData.live_mode ?? null,
            mp_nickname: mpNickname,
            mp_email: mpEmail,
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
        .update({ mp_connected: true, mp_account_label: mpAccountLabel })
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
    return json({ error: `Unknown action: ${action ?? "(none)"}` }, 400);
  } catch (err) {
    console.error("mp-connect error:", err);
    return json({ error: err instanceof Error ? err.message : "Internal error" }, 500);
  }
});
