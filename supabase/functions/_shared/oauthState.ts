/**
 * oauthState.ts — CSRF-hardened OAuth `state` param helpers, shared by
 * mp-connect (professional) and pharmacy-mp-connect (pharmacy). Pure/
 * stateless HMAC — identical logic either caller used to keep an inline
 * copy of.
 */

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

/** Builds `${entityId}.${hmac16}` — hmac16 is the first 16 hex chars of HMAC-SHA256(entityId, secret). */
export async function buildOAuthState(entityId: string, secret: string): Promise<string> {
  const sig = (await hmacHex(entityId, secret)).slice(0, 16);
  return `${entityId}.${sig}`;
}

/** Returns the entityId if the state's HMAC checks out against `secret`, otherwise null. */
export async function verifyOAuthState(state: string, secret: string): Promise<string | null> {
  const dotIdx = state.indexOf(".");
  if (dotIdx === -1) return null;

  const entityId = state.slice(0, dotIdx);
  const receivedSig = state.slice(dotIdx + 1);
  const expectedSig = (await hmacHex(entityId, secret)).slice(0, 16);

  return receivedSig === expectedSig ? entityId : null;
}
