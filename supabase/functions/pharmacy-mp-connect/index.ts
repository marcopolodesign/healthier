/**
 * pharmacy-mp-connect — MercadoPago OAuth Connect for the pharmacy beneficiary.
 * Structural duplicate of mp-connect/index.ts (professional OAuth) — kept
 * separate rather than parameterizing mp-connect, same reasoning as
 * pharmacy_mp_accounts being its own table.
 *
 * POST /pharmacy-mp-connect  { action: "authorize" }   Authorization: Bearer <JWT>
 *   (también GET ?action=authorize con el mismo header)
 *   Sólo pharmacy_admin / super_admin. Devuelve `{ data: { url } }` con la URL
 *   de autorización de MP. La farmacia del state la resuelve el servidor (hoy:
 *   el único tenant, PHARMACY_ID fijo); cualquier pharmacyId de la URL o el
 *   body se IGNORA. Sin sesión: 401 (o redirect a /farmacia/configuracion?mp_error=
 *   reintentar si es una navegación del browser de un cliente viejo).
 *   🔴 Hasta el 2026-10-23 aceptaba `?pharmacyId=<cualquiera>` sin sesión — ver
 *   el comentario de mp-connect.
 *
 * GET /pharmacy-mp-connect?code=XXX&state=v2.<pharmacyId>.<exp>.<sig>   (Mercado Pago)
 *   Exchanges the code, persists tokens in pharmacy_mp_accounts, sets
 *   pharmacies.mp_connected = true. Redirects to /farmacia/configuracion?mp_connected=1.
 *
 * POST /pharmacy-mp-connect  { action: "disconnect" }   Authorization: Bearer <JWT>
 *   (pharmacy_admin o super_admin) Marks pharmacy_mp_accounts.active = false
 *   and pharmacies.mp_connected = false, sobre la farmacia que resuelve el server.
 *
 * ⚠️ Requires a dedicated MP_REDIRECT_URI registered in the MercadoPago
 * developer app's allowed redirect URLs (manual step, not doable via API) —
 * see PHARMACY_MP_REDIRECT_URI below.
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
const REDIRECT_URI = Deno.env.get("PHARMACY_MP_REDIRECT_URI")!; // e.g. https://aixjejdoofervrkggbkd.supabase.co/functions/v1/pharmacy-mp-connect
const APP_URL = Deno.env.get("APP_URL") ?? "https://healthier.com.ar";
const MP_WEBHOOK_SECRET = Deno.env.get("MP_WEBHOOK_SECRET")!; // reused as the state-signing secret, same as mp-connect

const PHARMACY_STAFF_ROLES = ["pharmacy_admin", "super_admin"];

type StaffCheck = { ok: true; pharmacyId: string } | { ok: false; status: number; error: string };

/**
 * La farmacia es el único tenant del MVP, con id fijo (migración 103): el
 * mismo PHARMACY_ID que usa el front (medicationOrdersService). No existe
 * todavía un vínculo usuario→farmacia; el día que haya más de una, esto se
 * reemplaza por ese vínculo — nunca por un id que mande el cliente.
 */
const PHARMACY_ID = "10000000-0000-0000-0000-000000000001";

/** El que llama tiene que ser staff con permiso (pharmacy_admin/super_admin). */
async function requirePharmacyStaff(req: Request): Promise<StaffCheck> {
  const user = await userFromRequest(req);
  if (!user) return { ok: false, status: 401, error: "Unauthorized" };

  const supabase = serviceClient();
  const { data: profile, error: profErr } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profErr) throw profErr;
  if (!profile || !PHARMACY_STAFF_ROLES.includes(profile.role)) {
    return { ok: false, status: 403, error: "Forbidden" };
  }

  const { data: pharmacy, error: phErr } = await supabase
    .from("pharmacies")
    .select("id")
    .eq("id", PHARMACY_ID)
    .maybeSingle();
  if (phErr) throw phErr;
  if (!pharmacy) return { ok: false, status: 409, error: "No se encontró la farmacia" };
  return { ok: true, pharmacyId: pharmacy.id };
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
      } else if (url.searchParams.get("pharmacyId")) {
        action = "authorize"; // links viejos: caen en el 401 / redirect de abajo
      }
    }
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({} as Record<string, unknown>));
      action = (body as { action?: string }).action ?? action;
      if (action === "callback") return json({ error: "callback is GET-only" }, 405);
    }

    // ─── 1. Authorize (exige sesión de staff de la farmacia) ──────────────
    if (action === "authorize") {
      const staff = await requirePharmacyStaff(req);
      if (!staff.ok) {
        // Link viejo (navegación): vuelve a la app con aviso, nunca a MP ni a un JSON crudo.
        return isBrowserNavigation(req)
          ? Response.redirect(`${APP_URL}/farmacia/configuracion?mp_error=reintentar`, 302)
          : json({ error: staff.error }, staff.status);
      }

      const state = await buildOAuthState("pharmacy-mp-connect", staff.pharmacyId, MP_WEBHOOK_SECRET);
      return json({ data: { url: buildMpAuthUrl(MP_CLIENT_ID, REDIRECT_URI, state) }, error: null });
    }

    // ─── Disconnect (POST, pharmacy_admin/super_admin) ─────────────────────
    if (action === "disconnect") {
      if (req.method !== "POST") return json({ error: "disconnect is POST-only" }, 405);
      const staff = await requirePharmacyStaff(req);
      if (!staff.ok) return json({ error: staff.error }, staff.status);

      const serviceSupabase = serviceClient();
      const [{ error: mpErr }, { error: pharmErr }] = await Promise.all([
        serviceSupabase.from("pharmacy_mp_accounts").update({ active: false }).eq("pharmacy_id", staff.pharmacyId),
        serviceSupabase.from("pharmacies").update({ mp_connected: false }).eq("id", staff.pharmacyId),
      ]);

      if (mpErr || pharmErr) {
        console.error("pharmacy-mp-connect disconnect error:", mpErr?.message, pharmErr?.message);
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

      const check = await verifyOAuthState("pharmacy-mp-connect", state, MP_WEBHOOK_SECRET);
      if (!check.ok) {
        console.warn(`pharmacy-mp-connect callback: state ${check.reason}`);
        const mpError = check.reason === "expired" ? "state_expired" : "invalid_state";
        return Response.redirect(`${APP_URL}/farmacia/configuracion?mp_error=${mpError}`, 302);
      }
      const pharmacyId = check.entityId;

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

    return json({ error: `Unknown action: ${action ?? "(none)"}` }, 400);
  } catch (err) {
    console.error("pharmacy-mp-connect error:", err);
    return json({ error: err instanceof Error ? err.message : "Internal error" }, 500);
  }
});
