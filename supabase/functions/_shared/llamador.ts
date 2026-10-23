/**
 * Quién llama a una Edge Function, leído del `Authorization: Bearer <jwt>`.
 *
 * 🔴 Sólo sirve en funciones con `verify_jwt = true` (el default; ver
 * `supabase/config.toml`): ahí el gateway de Supabase ya verificó la firma del
 * JWT antes de que la función corra, y alcanza con leer el claim `role`. En una
 * función con `verify_jwt = false` el claim se puede inventar — no usarlo ahí.
 *
 * Por qué hace falta: `verify_jwt = true` NO significa "sólo el servidor". La
 * key anónima es un JWT firmado por el proyecto (role = anon) y está en el
 * bundle del front, así que pasa el gateway igual que una sesión. Hasta el
 * 2026-10-23 `send-email` confiaba en eso y cualquiera, con la key anónima,
 * podía pedir el `preview` del mail de una receta ajena (número secuencial) y
 * leer el PDF, o el código de cambio de correo de otra persona.
 */

/** 'anon' | 'authenticated' | 'service_role' | null si no hay JWT legible. */
export function rolDelLlamador(req: Request): string | null {
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return null
  // La variable que inyecta Supabase no siempre es la misma cadena que la
  // service key que usan los triggers (vault `push_service_key`), por eso la
  // comparación exacta es sólo un atajo y lo que decide es el claim.
  if (jwt === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) return 'service_role'
  try {
    const payload = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const rol = JSON.parse(atob(payload)).role
    return typeof rol === 'string' ? rol : null
  } catch {
    return null
  }
}

/** La llamada viene del servidor (trigger, cron, otra función, script con la service key). */
export function esServicio(req: Request): boolean {
  return rolDelLlamador(req) === 'service_role'
}
