/**
 * "Bonificar" de Teleclínica — la regla del servidor (`ondemand-despacho`).
 *
 * El interruptor del checkout lo ve sólo la cuenta de la allowlist. Esa cuenta
 * además tiene `profiles.payment_exempt` en producción, y hasta el 2026-10-13
 * la consulta salía bonificada por las dos vías: apagar el interruptor no
 * cambiaba nada y la pantalla seguía diciendo "Consulta bonificada".
 *
 * Desde ahí, para la cuenta del interruptor MANDA EL INTERRUPTOR: el front
 * manda `cobrar: true` cuando lo apaga, y entonces se cobra aunque el perfil
 * sea exento. Un cliente viejo nunca manda `cobrar`, así que para él no cambia
 * nada. Cualquier otra cuenta: `bonificar` y `cobrar` se ignoran, decide sólo
 * `payment_exempt`.
 *
 * Espejo de `src/lib/bonificar.js` (web) y `src/lib/bonificar.ts` (app).
 * Control: `node scripts/test-bonificar.mjs`.
 */
export const BONIFICAR_ALLOWLIST = ['mateoaldao@gmail.com']

export function puedeBonificar(email: string | null | undefined): boolean {
  return BONIFICAR_ALLOWLIST.includes(String(email ?? '').trim().toLowerCase())
}

export function exentoEnServidor(p: {
  paymentExempt: boolean | null | undefined
  email: string | null | undefined
  bonificar?: unknown
  cobrar?: unknown
}): boolean {
  const habilitada = puedeBonificar(p.email)
  if (habilitada && p.cobrar === true) return false
  return p.paymentExempt === true || (habilitada && p.bonificar === true)
}
