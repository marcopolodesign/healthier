/**
 * Marca de "esta sesión es modo operador" (una cuenta operadorN actuando como un
 * profesional de Medizin). Vive en localStorage y la escribe `operadorService`.
 * Sin dependencias a propósito: la leen la analítica (GTM), Customer.io y Sentry,
 * que en modo operador NO se identifican ni miden a nombre del profesional
 * (migración 242: la persona detrás de la cuenta no es el profesional).
 */
export const KEY_MODO_OPERADOR = 'operador-modo'
export const EVENTO_MODO_OPERADOR = 'modo-operador-cambio'

export function enModoOperadorMarcado() {
  try { return window.localStorage.getItem(KEY_MODO_OPERADOR) === '1' } catch { return false }
}

export function marcarModoOperador(activo) {
  try { activo ? window.localStorage.setItem(KEY_MODO_OPERADOR, '1') : window.localStorage.removeItem(KEY_MODO_OPERADOR) } catch { /* sin storage */ }
  try { window.dispatchEvent(new Event(EVENTO_MODO_OPERADOR)) } catch { /* sin window */ }
}
