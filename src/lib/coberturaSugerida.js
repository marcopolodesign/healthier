/**
 * Cobertura sugerida por DNI (Edge Function `cobertura-sugerida`, migración 194).
 *
 * Reglas — y las dos funciones de acá existen para que no dependan de que cada
 * pantalla se acuerde:
 *   1. **Nunca se pisa lo que el paciente ya cargó.** Si ya eligió obra social
 *      o "particular", la sugerencia se ignora entera.
 *   2. **Se precarga, no se guarda.** El paciente la ve elegida y la confirma al
 *      guardar, o la cambia.
 *
 * El control de la regla 1 es `scripts/test-cobertura-sugerida.mjs`
 * (`npm run test:cobertura`), que falla si la precarga pisa una cobertura.
 * La app (`mobile/lib/coberturaSugerida.ts`) tiene la misma lógica y el mismo test.
 */

/** ¿El paciente ya tiene algo cargado? Particular cuenta: es una respuesta. */
export function tieneCobertura(actual) {
  if (!actual) return false
  return Boolean(
    actual.coverageType ||
    actual.financiadorId ||
    (actual.insuranceName && String(actual.insuranceName).trim()),
  )
}

/**
 * Devuelve el parche a aplicar sobre el estado de cobertura, o null si no hay
 * que tocar nada. Sólo precarga cuando la sugerencia matcheó con el catálogo
 * (tiene `financiadorId`): sin id la receta no sirve, así que en ese caso el
 * paciente elige a mano y sólo se le muestra el nombre (ver `avisoSinMatch`).
 */
export function precargarCobertura(actual, respuesta) {
  if (tieneCobertura(actual)) return null
  const s = respuesta?.sugerencia
  if (respuesta?.estado !== 'encontrada' || !s?.financiadorId) return null
  return {
    coverageType: 'financiador',
    financiadorId: s.financiadorId,
    insuranceName: s.financiadorNombre,
  }
}

/** Texto para cuando figura en el listado pero no en el catálogo de recetas. */
export function avisoSinMatch(actual, respuesta) {
  if (tieneCobertura(actual)) return null
  if (respuesta?.estado !== 'sin_match' || !respuesta?.sugerencia?.coberturaNombre) return null
  return respuesta.sugerencia.coberturaNombre
}

/** Al guardar: 'listado' si quedó la sugerida, 'manual' si eligió otra, null si nada. */
export function origenDeCobertura(guardada, sugerenciaId) {
  if (!guardada?.coverageType) return null
  if (guardada.coverageType === 'financiador' && sugerenciaId && guardada.financiadorId === sugerenciaId) return 'listado'
  return 'manual'
}
