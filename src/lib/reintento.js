// ¿Vale la pena reintentar una llamada a Supabase? Sólo si el fallo es de transporte o
// del servidor (red caída, 5xx): un error de la base o de permisos (P0001, 42501…, o
// cualquier 4xx) vuelve a dar lo mismo y reintentar sólo lo enmascara.
// `respuesta` es lo que devuelve supabase-js: `{ error, status }`; `status` 0 = no hubo respuesta.
export function esErrorTransitorio(respuesta) {
  if (!respuesta?.error) return false
  const status = respuesta.status
  return status === 0 || status === undefined || status === null || status >= 500
}

/**
 * Pide el asiento del cambio de contraseña (RPC `registrar_cambio_de_contrasena`).
 *  - `llamar()` hace la llamada y devuelve `{ error, status }` (lo de supabase-js).
 *  - `quedoAsentado()` consulta si el asiento existe (para cuando se perdió la respuesta).
 * Reglas: sólo se reintenta ante un fallo de red / 5xx. Si el reintento contesta
 * P0001 ("no hay un cambio reciente para asentar") después de un primer intento que
 * se cortó, lo más probable es que el primero SÍ llegó y sólo se perdió la respuesta:
 * se consulta antes de decir que no quedó asentado.
 * Devuelve `{ registrado: true }` o `{ registrado: false, motivoSinRegistro }`.
 */
export async function asentarConReintento({ llamar, quedoAsentado }) {
  const primero = await llamar()
  if (!primero.error) return { registrado: true }
  if (!esErrorTransitorio(primero)) return { registrado: false, motivoSinRegistro: primero.error.message }

  const segundo = await llamar()
  if (!segundo.error) return { registrado: true }
  if (segundo.error.code === 'P0001' && await quedoAsentado()) return { registrado: true }
  return { registrado: false, motivoSinRegistro: segundo.error.message }
}
