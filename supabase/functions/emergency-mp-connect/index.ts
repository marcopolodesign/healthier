/**
 * emergency-mp-connect — OAuth de Mercado Pago del PRESTADOR de emergencias
 * (emergency_providers). Calcado de emergency-mp-connect: el cobro de la
 * emergencia va directo a la cuenta del prestador (decisión de Mateo,
 * 2026-11-19), no a la del médico ni a la de la plataforma.
 *
 * POST { action: "authorize" }  Authorization: Bearer <JWT>
 *   Sólo emergency_admin (de su entidad) o super_admin. Devuelve { data: { url } }.
 *   La entidad la resuelve el servidor (staff del que llama; super_admin: la
 *   entidad por defecto); cualquier providerId del cliente se IGNORA.
 * GET ?code=..&state=v2.<providerId>.<exp>.<sig>   (Mercado Pago)
 *   Canjea el code y guarda los tokens cifrados en emergency_provider_mp_accounts.
 *   Vuelve a /despacho/configuracion?mp_connected=1.
 * POST { action: "disconnect" }  Idem permisos. Marca active=false.
 *
 * ⚠️ Hay que registrar EMERGENCY_MP_REDIRECT_URI (o, sin el secret,
 * <SUPABASE_URL>/functions/v1/emergency-mp-connect) en las URLs de redirección
 * de la app de Mercado Pago: paso manual, MP no tiene API para eso.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { encryptToken } from "../_shared/tokenCrypto.ts";
import { buildOAuthState, verifyOAuthState } from "../_shared/oauthState.ts";
import {
  buildMpAuthUrl,
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
const REDIRECT_URI = Deno.env.get("EMERGENCY_MP_REDIRECT_URI") ?? `${Deno.env.get("SUPABASE_URL")}/functions/v1/emergency-mp-connect`; // e.g. https://aixjejdoofervrkggbkd.supabase.co/functions/v1/emergency-mp-connect
const APP_URL = Deno.env.get("APP_URL") ?? "https://healthier.com.ar";
const MP_WEBHOOK_SECRET = Deno.env.get("MP_WEBHOOK_SECRET")!; // reused as the state-signing secret, same as mp-connect

const STAFF_ROLES = ["emergency_admin", "super_admin"];

/** Entidad por defecto del MVP (migración 156) — para el super_admin, que no es staff de ninguna. */
const DEFAULT_PROVIDER_ID = "20000000-0000-0000-0000-000000000001";

type StaffCheck = { ok: true; providerId: string; userId: string } | { ok: false; status: number; error: string };

async function requireStaff(req: Request): Promise<StaffCheck> {
  const user = await userFromRequest(req);
  if (!user) return { ok: false, status: 401, error: "Unauthorized" };

  const supabase = serviceClient();
  const { data: profile, error: profErr } = await supabase
    .from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profErr) throw profErr;
  if (!profile || !STAFF_ROLES.includes(profile.role)) return { ok: false, status: 403, error: "Forbidden" };

  const { data: staff, error: stErr } = await supabase
    .from("emergency_provider_staff").select("provider_id")
    .eq("profile_id", user.id).eq("active", true).limit(1).maybeSingle();
  if (stErr) throw stErr;
  const providerId = staff?.provider_id ?? (profile.role === "super_admin" ? DEFAULT_PROVIDER_ID : null);
  if (!providerId) return { ok: false, status: 409, error: "No encontramos la entidad" };

  const { data: provider, error: pErr } = await supabase
    .from("emergency_providers").select("id").eq("id", providerId).maybeSingle();
  if (pErr) throw pErr;
  if (!provider) return { ok: false, status: 409, error: "No encontramos la entidad" };
  return { ok: true, providerId: provider.id, userId: user.id };
}

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
      } else if (url.searchParams.get("providerId")) {
        action = "authorize"; // links viejos: caen en el 401 / redirect de abajo
      }
    }
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({} as Record<string, unknown>));
      action = (body as { action?: string }).action ?? action;
      if (action === "callback") return json({ error: "callback is GET-only" }, 405);
    }

    // ─── 1. Authorize (exige sesión de staff de la entidad) ──────────────
    if (action === "authorize") {
      const staff = await requireStaff(req);
      if (!staff.ok) {
        // Link viejo (navegación): vuelve a la app con aviso, nunca a MP ni a un JSON crudo.
        return isBrowserNavigation(req)
          ? Response.redirect(`${APP_URL}/despacho/configuracion?mp_error=reintentar`, 302)
          : json({ error: staff.error }, staff.status);
      }

      const state = await buildOAuthState("emergency-mp-connect", staff.providerId, MP_WEBHOOK_SECRET);
      return json({ data: { url: buildMpAuthUrl(MP_CLIENT_ID, REDIRECT_URI, state) }, error: null });
    }

    // ─── Disconnect (POST, emergency_admin/super_admin) ─────────────────────
    if (action === "disconnect") {
      if (req.method !== "POST") return json({ error: "disconnect is POST-only" }, 405);
      const staff = await requireStaff(req);
      if (!staff.ok) return json({ error: staff.error }, staff.status);

      const serviceSupabase = serviceClient();
      const { error: mpErr } = await serviceSupabase
        .from("emergency_provider_mp_accounts").update({ active: false }).eq("provider_id", staff.providerId);
      if (mpErr) {
        console.error("emergency-mp-connect disconnect error:", mpErr.message);
        return json({ data: null, error: "Failed to disconnect MercadoPago account" }, 500);
      }

      return json({ data: { disconnected: true }, error: null });
    }

    // ─── 2. Callback ───────────────────────────────────────────────────────
    if (action === "callback" && req.method === "GET") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");

      if (!code || !state) {
        return json({ error: "Missing code or state" }, 400);
      }

      const check = await verifyOAuthState("emergency-mp-connect", state, MP_WEBHOOK_SECRET);
      if (!check.ok) {
        console.warn(`emergency-mp-connect callback: state ${check.reason}`);
        const mpError = check.reason === "expired" ? "state_expired" : "invalid_state";
        return Response.redirect(`${APP_URL}/despacho/configuracion?mp_error=${mpError}`, 302);
      }
      const providerId = check.entityId;

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
        return Response.redirect(`${APP_URL}/despacho/configuracion?mp_error=token_exchange`, 302);
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

      const supabase = serviceClient();

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
          console.warn("emergency-mp-connect: GET /users/me failed", meRes.status, await meRes.text());
        }
      } catch (meErr) {
        console.error("emergency-mp-connect: GET /users/me error (non-fatal):", meErr);
      }

      const [encryptedAccessToken, encryptedRefreshToken] = await Promise.all([
        encryptToken(tokenData.access_token),
        encryptToken(tokenData.refresh_token),
      ]);

      const { error: upsertErr } = await supabase
        .from("emergency_provider_mp_accounts")
        .upsert(
          {
            provider_id: providerId,
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
          { onConflict: "provider_id" }
        );

      if (upsertErr) {
        console.error("emergency_provider_mp_accounts upsert error:", upsertErr);
        return Response.redirect(`${APP_URL}/despacho/configuracion?mp_error=db_save`, 302);
      }

      return Response.redirect(`${APP_URL}/despacho/configuracion?mp_connected=1`, 302);
    }

    return json({ error: `Unknown action: ${action ?? "(none)"}` }, 400);
  } catch (err) {
    console.error("emergency-mp-connect error:", err);
    return json({ error: err instanceof Error ? err.message : "Internal error" }, 500);
  }
});
