/**
 * DNI del profesional: una sola normalización y una sola validación para el
 * registro (mail y Google), el onboarding y `authService` (2026-10-16).
 *
 * - Se queda con los dígitos ("28.999.888" → "28999888"), sin cortar: un pegado
 *   con puntos no puede quedar truncado.
 * - Si pegó su CUIT/CUIL (11 dígitos con prefijo 20/23/24/27/30/33/34), el DNI
 *   son los 8 del medio — la misma regla que `documento_es_extranjero` (migración 201).
 */
const PREFIJOS_CUIT = ['20', '23', '24', '27', '30', '33', '34']

export function normalizarDni(valor) {
  const d = String(valor ?? '').replace(/\D/g, '')
  if (d.length === 11 && PREFIJOS_CUIT.includes(d.slice(0, 2))) return d.slice(2, 10)
  return d
}

export const dniValido = dni => /^\d{7,8}$/.test(normalizarDni(dni))
export const MENSAJE_DNI_INVALIDO = 'Revisá tu DNI: son 7 u 8 números.'
