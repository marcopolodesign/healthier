/**
 * Validación del aviso (webhook) de Mercado Pago. Pura: sin red ni base, para
 * poder probarla con un secreto de prueba (scripts/test-firma-mp.ts).
 *
 * MP firma "id:<data.id de la query>;request-id:<x-request-id>;ts:<ts>;" con
 * HMAC-SHA256 y lo manda en `x-signature: ts=<ts>,v1=<hex>`. Además de la
 * firma se exige:
 *   · que el `data.id` del cuerpo (el pago que después se procesa) sea el mismo
 *     que el firmado de la query — si no, alguien podría reenviar una firma
 *     válida con otro pago en el cuerpo;
 *
 * La antigüedad de `ts` NO se exige a propósito (Mateo/sesión principal,
 * 2026-11-25): no está probado cómo reintenta MP, y si reenvía con el `ts`
 * original un límite rechazaría pagos reales en silencio. El estado del pago
 * siempre se vuelve a leer de la API de MP, así que reenviar un aviso viejo no
 * cambia nada que MP no confirme.
 */

export type ResultadoAviso = { ok: true; dataId: string } | { ok: false; motivo: string }

async function hmacHex(secret: string, texto: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const firma = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(texto))
  return Array.from(new Uint8Array(firma)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Para las pruebas: arma un `x-signature` válido. */
export async function firmarAvisoMp(secret: string, dataId: string, requestId: string, ts: string): Promise<string> {
  return `ts=${ts},v1=${await hmacHex(secret, `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`)}`
}

export async function validarAvisoMp(p: {
  secret: string
  xSignature: string | null
  xRequestId: string | null
  queryDataId: string | null
  bodyDataId: string | null
  ahoraMs?: number
}): Promise<ResultadoAviso> {
  if (!p.xSignature) return { ok: false, motivo: 'sin_firma' }
  const partes = Object.fromEntries(
    p.xSignature.split(',').map((x) => x.trim().split('=') as [string, string]),
  )
  const ts = partes['ts']
  const v1 = partes['v1']
  if (!ts || !v1) return { ok: false, motivo: 'firma_mal_formada' }

  const dataId = String(p.queryDataId ?? p.bodyDataId ?? '').toLowerCase()
  if (!dataId) return { ok: false, motivo: 'sin_data_id' }
  if (p.queryDataId && p.bodyDataId && String(p.bodyDataId).toLowerCase() !== String(p.queryDataId).toLowerCase()) {
    return { ok: false, motivo: 'data_id_distinto' }
  }

  const esperado = await hmacHex(p.secret, `id:${dataId};request-id:${p.xRequestId ?? ''};ts:${ts};`)
  if (esperado !== v1) return { ok: false, motivo: 'firma_invalida' }
  return { ok: true, dataId }
}
