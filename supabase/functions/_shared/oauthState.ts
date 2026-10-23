/**
 * oauthState.ts — `state` del OAuth de Mercado Pago, compartido por
 * mp-connect (profesional) y pharmacy-mp-connect (farmacia).
 *
 * Formato v2: `v2.<entityId>.<exp>.<sig>`
 *   · exp   — vencimiento en segundos UNIX (corto: ver OAUTH_STATE_TTL_SECONDS).
 *   · sig   — primeros 32 hex de HMAC-SHA256(`<purpose>|<entityId>|<exp>`, secret).
 *   · purpose separa los dos flujos: un state del profesional no sirve en el
 *     callback de la farmacia ni al revés.
 *
 * 🔴 El state sólo prueba que NOSOTROS lo firmamos. Que el entityId sea el de
 * quien está autorizando lo garantiza el paso `authorize`, que lo arma con el
 * usuario del JWT (nunca con un id que venga en la URL). Hasta el 2026-10-23
 * se firmaba cualquier id que llegara por query string, sin sesión: cualquiera
 * podía vincular SU cuenta de MP al perfil de otro y quedarse con los cobros.
 *
 * El formato viejo (`<id>.<hmac16>`, sin vencimiento) ya no se acepta.
 */

/** Cuánto vive un state: lo que tarda alguien en loguearse en MP y aceptar. */
export const OAUTH_STATE_TTL_SECONDS = 15 * 60;

export type OAuthPurpose = "mp-connect" | "pharmacy-mp-connect";

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

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const sign = async (purpose: OAuthPurpose, entityId: string, exp: number, secret: string) =>
  (await hmacHex(`${purpose}|${entityId}|${exp}`, secret)).slice(0, 32);

export async function buildOAuthState(
  purpose: OAuthPurpose,
  entityId: string,
  secret: string,
  nowMs = Date.now()
): Promise<string> {
  if (!secret) throw new Error("OAuth state secret missing");
  const exp = Math.floor(nowMs / 1000) + OAUTH_STATE_TTL_SECONDS;
  return `v2.${entityId}.${exp}.${await sign(purpose, entityId, exp, secret)}`;
}

export type OAuthStateCheck =
  | { ok: true; entityId: string }
  | { ok: false; reason: "invalid" | "expired" };

export async function verifyOAuthState(
  purpose: OAuthPurpose,
  state: string,
  secret: string,
  nowMs = Date.now()
): Promise<OAuthStateCheck> {
  if (!secret) return { ok: false, reason: "invalid" };
  const parts = state.split(".");
  if (parts.length !== 4 || parts[0] !== "v2") return { ok: false, reason: "invalid" };
  const [, entityId, expStr, receivedSig] = parts;
  const exp = Number(expStr);
  if (!entityId || !/^\d+$/.test(expStr) || !Number.isSafeInteger(exp)) {
    return { ok: false, reason: "invalid" };
  }
  const expectedSig = await sign(purpose, entityId, exp, secret);
  if (!timingSafeEqual(receivedSig, expectedSig)) return { ok: false, reason: "invalid" };
  if (Math.floor(nowMs / 1000) > exp) return { ok: false, reason: "expired" };
  return { ok: true, entityId };
}
