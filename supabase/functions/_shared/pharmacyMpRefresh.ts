/**
 * pharmacyMpRefresh.ts — MercadoPago OAuth token refresh for the pharmacy
 * beneficiary. Deliberate duplicate of mpRefresh.ts (professional_id/
 * mp_accounts) rather than a generalization of it — mpRefresh.ts is a
 * shared choke point already used by mp-payment, mp-webhook and the
 * mp-refresh-tokens sweep for consultation payments in production;
 * touching it to add a second entity type is unnecessary risk. Same
 * reasoning as pharmacy_mp_accounts being its own table instead of a
 * generalized mp_accounts.
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

export interface PharmacyMpAccountRow {
  pharmacy_id: string;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
  active?: boolean;
}

export interface RefreshResult {
  accessToken: string;
  refreshed: boolean;
  invalidGrant?: boolean;
  error?: string;
}

function needsRefresh(expiresAt: string | null, marginMs: number): boolean {
  if (!expiresAt) return true;
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
    return { ok: false, invalidGrant: errorCode === "invalid_grant", detail: JSON.stringify(data) };
  }

  const d = data as { access_token: string; refresh_token: string; expires_in: number; live_mode?: boolean };
  return { ok: true, access_token: d.access_token, refresh_token: d.refresh_token, expires_in: d.expires_in, live_mode: d.live_mode };
}

async function deactivateAccount(supabase: SupabaseClient, pharmacyId: string): Promise<void> {
  const [{ error }, { error: pharmErr }] = await Promise.all([
    supabase.from("pharmacy_mp_accounts").update({ active: false }).eq("pharmacy_id", pharmacyId),
    supabase.from("pharmacies").update({ mp_connected: false }).eq("id", pharmacyId),
  ]);
  if (error) console.error("pharmacyMpRefresh: failed to deactivate pharmacy_mp_accounts row:", error.message);
  if (pharmErr) console.error("pharmacyMpRefresh: failed to unset mp_connected:", pharmErr.message);
}

export async function ensureFreshPharmacyMpToken(
  supabase: SupabaseClient,
  account: PharmacyMpAccountRow,
  marginMs: number
): Promise<RefreshResult> {
  const currentAccessToken = await decryptToken(account.access_token);

  if (!needsRefresh(account.expires_at, marginMs)) {
    return { accessToken: currentAccessToken, refreshed: false };
  }

  if (!account.refresh_token) {
    console.warn(`pharmacyMpRefresh: pharmacy ${account.pharmacy_id} has no refresh_token on file`);
    return { accessToken: currentAccessToken, refreshed: false };
  }

  const currentRefreshToken = await decryptToken(account.refresh_token);
  const result = await callMpOAuthRefresh(currentRefreshToken);

  if (!result.ok) {
    console.error(`pharmacyMpRefresh: refresh failed for pharmacy ${account.pharmacy_id}:`, result.detail);
    if (result.invalidGrant) await deactivateAccount(supabase, account.pharmacy_id);
    return { accessToken: currentAccessToken, refreshed: false, invalidGrant: result.invalidGrant, error: result.detail };
  }

  const expiresAt = new Date(Date.now() + result.expires_in * 1000).toISOString();
  const [encryptedAccessToken, encryptedRefreshToken] = await Promise.all([
    encryptToken(result.access_token),
    encryptToken(result.refresh_token),
  ]);

  const { error: updateErr } = await supabase
    .from("pharmacy_mp_accounts")
    .update({
      access_token: encryptedAccessToken,
      refresh_token: encryptedRefreshToken,
      expires_at: expiresAt,
      ...(result.live_mode !== undefined ? { live_mode: result.live_mode } : {}),
    })
    .eq("pharmacy_id", account.pharmacy_id);

  if (updateErr) {
    console.error(`pharmacyMpRefresh: refreshed tokens for ${account.pharmacy_id} but failed to persist:`, updateErr.message);
  }

  return { accessToken: result.access_token, refreshed: true };
}
