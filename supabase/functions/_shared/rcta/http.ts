// ── Las llamadas al servicio de recetas ───────────────────────────────────────
// Generar Receta, "Headers requeridos": `Authorization: Bearer {token}` y
// `Accept: application/json`. Lo usan la emisión, la anulación y el catálogo.
// ─────────────────────────────────────────────────────────────────────────────

/** Las cabeceras de toda llamada. `json: false` para un GET sin cuerpo. */
export function cabecerasRcta(apiKey: string, { json = true }: { json?: boolean } = {}): Record<string, string> {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${apiKey}`,
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  }
}

export type RctaCallResult =
  | { kind: 'network_error'; err: unknown }
  // deno-lint-ignore no-explicit-any
  | { kind: 'rejected'; status: number; body: string; json: any }
  // deno-lint-ignore no-explicit-any
  | { kind: 'ok'; status: number; data: any }

/**
 * Una llamada con cuerpo JSON (POST de la emisión, DELETE de la anulación).
 * La red se atrapa acá y vuelve como `network_error`: es AMBIGUO (no se sabe
 * si el servicio llegó a crear algo), así que quien llama NUNCA reintenta a
 * partir de eso. Una respuesta 2xx que no es JSON vuelve como `{ raw }`.
 */
export async function llamarRcta(
  method: 'POST' | 'DELETE',
  baseUrl: string,
  apiKey: string,
  path: string,
  body: Record<string, unknown>,
): Promise<RctaCallResult> {
  let res: Response
  try {
    res = await fetch(`${baseUrl}${path}`, { method, headers: cabecerasRcta(apiKey), body: JSON.stringify(body) })
  } catch (err) {
    return { kind: 'network_error', err }
  }
  const text = await res.text()
  // deno-lint-ignore no-explicit-any
  let parsed: any = null
  try { parsed = JSON.parse(text) } catch { parsed = text ? { raw: text } : null }
  if (!res.ok) return { kind: 'rejected', status: res.status, body: text, json: text ? parsed : null }
  return { kind: 'ok', status: res.status, data: parsed ?? {} }
}
