/**
 * mpRefresh.ts — shared MercadoPago OAuth token refresh helper.
 *
 * Used two ways:
 *  1. Inline, by mp-payment (C2.6) right before charging a card — refreshes the
 *     professional's access_token if it's within 7 days of expiring, so the
 *     payment call never hits an expired token.
 *  2. In bulk, by mp-refresh-tokens (C4) — a periodic sweep refreshing every
 *     account within 30 days of expiring.
 *
 * MP's /oauth/token refresh always returns a NEW access_token AND a NEW
 * refresh_token — both must be persisted every time (SECCIÓN A.5).
 *
 * Token encryption: `mp_accounts.access_token`/`refresh_token` are stored
 * encrypted at rest (see _shared/tokenCrypto.ts). This module is the single
 * choke point for both directions — `ensureFreshMpToken` decrypts the
 * incoming `account.access_token`/`refresh_token` before use and always
 * returns a plaintext `accessToken` to its caller, and encrypts before
 * persisting a refreshed pair. Callers never touch the raw column values.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encryptToken, decryptToken } from "./tokenCrypto.ts";

const IS_PROD = Deno.env.get("MP_IS_PROD") === "true";
const MP_CLIENT_ID = IS_PROD
  ? Deno.env.get("MP_CLIENT_ID_PROD")!
  : Deno.env.get("MP_CLIENT_ID_SANDBOX")!;
const MP_CLIENT_SECRET = IS_PROD
  ? Deno.env.get("MP_CLIENT_SECRET_PROD")!
  : Deno.env.get("MP_CLIENT_SECRET_SANDBOX")!;

// mp-payment refreshes when expires_at is within 7 days (SECCIÓN C2.6).
export const PAYMENT_REFRESH_MARGIN_MS = 7 * 24 * 60 * 60 * 1000;
// mp-refresh-tokens sweeps everything within 30 days (SECCIÓN C4).
export const SWEEP_REFRESH_MARGIN_MS = 30 * 24 * 60 * 60 * 1000;

export interface MpAccountRow {
  professional_id: string;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
  active?: boolean;
}

export interface RefreshResult {
  accessToken: string;
  refreshed: boolean;
  /** true only when MP rejected the refresh_token (invalid_grant) — caller should treat the account as disconnected */
  invalidGrant?: boolean;
  error?: string;
}

export function needsRefresh(expiresAt: string | null, marginMs: number): boolean {
  if (!expiresAt) return true; // unknown expiry — be conservative and refresh
  return new Date(expiresAt).getTime() < Date.now() + marginMs;
}

async function callMpOAuthRefresh(refreshToken: string): Promise<
  | { ok: true; access_token: string; refresh_token: string; expires_in: number; live_mode?: boolean }
  | { ok: false; invalidGrant: boolean; detail: string }
> {
  const res = await fetch("https://api.mercadopago.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: MP_CLIENT_ID,
      client_secret: MP_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  const data = await res.json().catch(() => ({} as Record<string, unknown>));

  if (!res.ok) {
    const errorCode = (data as { error?: string })?.error ?? "";
    return {
      ok: false,
      invalidGrant: errorCode === "invalid_grant",
      detail: JSON.stringify(data),
    };
  }

  const d = data as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    live_mode?: boolean;
  };

  return {
    ok: true,
    access_token: d.access_token,
    refresh_token: d.refresh_token,
    expires_in: d.expires_in,
    live_mode: d.live_mode,
  };
}

/**
 * Deactivates an mp_account after MP rejects its refresh_token (invalid_grant) —
 * the professional must reconnect via mp-connect, and is blocked from new
 * bookings in the meantime (professional_profiles.mp_connected = false).
 */
async function deactivateAccount(supabase: SupabaseClient, professionalId: string): Promise<void> {
  const { error: mpErr } = await supabase
    .from("mp_accounts")
    .update({ active: false })
    .eq("professional_id", professionalId);
  if (mpErr) console.error("mpRefresh: failed to deactivate mp_accounts row:", mpErr.message);

  const { error: profErr } = await supabase
    .from("professional_profiles")
    .update({ mp_connected: false })
    .eq("user_id", professionalId);
  if (profErr) console.error("mpRefresh: failed to unset mp_connected:", profErr.message);
}

/**
 * Ensures `account` has a token that won't expire within `marginMs`. Refreshes
 * inline and persists the new access_token/refresh_token/expires_at via
 * `supabase` (expects a service-role client) when needed. On invalid_grant,
 * deactivates the account and returns the (now stale) existing access_token —
 * callers must check `invalidGrant` and fail the operation rather than use it.
 *
 * `account.access_token`/`account.refresh_token` are expected to be the raw
 * (possibly encrypted) column values straight from `mp_accounts` — this
 * function decrypts them internally and always returns a plaintext
 * `accessToken`. Callers must never read `account.access_token` directly.
 */
export async function ensureFreshMpToken(
  supabase: SupabaseClient,
  account: MpAccountRow,
  marginMs: number = PAYMENT_REFRESH_MARGIN_MS
): Promise<RefreshResult> {
  const currentAccessToken = await decryptToken(account.access_token);

  if (!needsRefresh(account.expires_at, marginMs)) {
    return { accessToken: currentAccessToken, refreshed: false };
  }

  if (!account.refresh_token) {
    console.warn(`mpRefresh: professional ${account.professional_id} has no refresh_token on file`);
    return { accessToken: currentAccessToken, refreshed: false };
  }

  const currentRefreshToken = await decryptToken(account.refresh_token);
  const result = await callMpOAuthRefresh(currentRefreshToken);

  if (!result.ok) {
    console.error(`mpRefresh: refresh failed for professional ${account.professional_id}:`, result.detail);

    if (result.invalidGrant) {
      await deactivateAccount(supabase, account.professional_id);
    }

    return {
      accessToken: currentAccessToken,
      refreshed: false,
      invalidGrant: result.invalidGrant,
      error: result.detail,
    };
  }

  const expiresAt = new Date(Date.now() + result.expires_in * 1000).toISOString();

  const [encryptedAccessToken, encryptedRefreshToken] = await Promise.all([
    encryptToken(result.access_token),
    encryptToken(result.refresh_token),
  ]);

  const { error: updateErr } = await supabase
    .from("mp_accounts")
    .update({
      access_token: encryptedAccessToken,
      refresh_token: encryptedRefreshToken,
      expires_at: expiresAt,
      ...(result.live_mode !== undefined ? { live_mode: result.live_mode } : {}),
    })
    .eq("professional_id", account.professional_id);

  if (updateErr) {
    console.error(
      `mpRefresh: refreshed tokens for ${account.professional_id} but failed to persist:`,
      updateErr.message
    );
  }

  return { accessToken: result.access_token, refreshed: true };
}
