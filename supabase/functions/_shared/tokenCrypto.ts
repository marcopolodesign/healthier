/**
 * tokenCrypto.ts — application-layer encryption for MercadoPago OAuth tokens
 * stored in `mp_accounts.access_token` / `mp_accounts.refresh_token`.
 *
 * AES-256-GCM via WebCrypto, keyed by `MP_TOKEN_ENC_KEY` (base64-encoded
 * 32-byte key, set as a Supabase Edge Function secret).
 *
 * Storage format: `enc:v1:<base64(iv)>:<base64(ciphertext)>`
 *   - iv: 12 random bytes (GCM standard), re-generated per encryption call.
 *   - ciphertext: includes the GCM auth tag (WebCrypto appends it automatically).
 *
 * `decryptToken` passes through any value that doesn't start with the
 * `enc:v1:` prefix unchanged — this tolerates legacy/plaintext rows (there
 * are none at the time this was written, mp_accounts had 0 rows) and makes
 * rollout order-independent: this code can deploy before or after
 * MP_TOKEN_ENC_KEY is set, and reads of not-yet-encrypted rows still work.
 */

const ENC_PREFIX = "enc:v1:";

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array<ArrayBuffer>): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

async function importKey(): Promise<CryptoKey> {
  const keyB64 = Deno.env.get("MP_TOKEN_ENC_KEY");
  if (!keyB64) {
    throw new Error(
      "tokenCrypto: MP_TOKEN_ENC_KEY is not set — cannot encrypt MercadoPago tokens"
    );
  }

  const rawKey = base64ToBytes(keyB64);
  if (rawKey.length !== 32) {
    throw new Error(
      `tokenCrypto: MP_TOKEN_ENC_KEY must decode to 32 bytes for AES-256-GCM, got ${rawKey.length}`
    );
  }

  return crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

/** Encrypts `plain` with AES-256-GCM. Throws if MP_TOKEN_ENC_KEY is missing/invalid. */
export async function encryptToken(plain: string): Promise<string> {
  const key = await importKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const ciphertextBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plain)
  );

  return `${ENC_PREFIX}${bytesToBase64(iv)}:${bytesToBase64(new Uint8Array(ciphertextBuf))}`;
}

/**
 * Decrypts a value produced by `encryptToken`. Values that don't start with
 * the `enc:v1:` prefix are returned unchanged (defensive pass-through for
 * legacy plaintext rows / pre-encryption rollout).
 */
export async function decryptToken(stored: string): Promise<string> {
  if (!stored.startsWith(ENC_PREFIX)) return stored;

  const rest = stored.slice(ENC_PREFIX.length);
  const [ivB64, ciphertextB64] = rest.split(":");
  if (!ivB64 || !ciphertextB64) {
    throw new Error("tokenCrypto: malformed encrypted token value");
  }

  const key = await importKey();
  const iv = base64ToBytes(ivB64);
  const ciphertext = base64ToBytes(ciphertextB64);

  const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return new TextDecoder().decode(plainBuf);
}
