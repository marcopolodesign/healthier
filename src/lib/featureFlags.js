/**
 * featureFlags.js — qué se muestra y a quién, sin depender de una variable de
 * entorno más que haya que acordarse de setear en Vercel.
 *
 * El entorno se deduce del proyecto de Supabase al que apunta el bundle:
 * staging tiene su propia base desde el 2026-08-24, así que la URL ya
 * distingue los dos mundos sin configuración nueva. Un `npm run dev` local
 * apuntando a producción se comporta como producción, que es lo correcto.
 */

const PROD_SUPABASE_REF = 'aixjejdoofervrkggbkd'

export const esProduccion = String(import.meta.env.VITE_SUPABASE_URL ?? '').includes(PROD_SUPABASE_REF)

/**
 * Farmacia todavía no sale: sigue afuera del menú del paciente en producción
 * (decisión del 2026-08-29, confirmada por Mateo el 2026-09-02). En staging se
 * ve entera, y en producción la ven sólo estas cuentas para poder probarla.
 */
const FARMACIA_ALLOWLIST = ['paciente@healthier.app', 'mateoaldao@gmail.com']

export function farmaciaVisible(profile) {
  if (!esProduccion) return true
  return FARMACIA_ALLOWLIST.includes(String(profile?.email ?? '').trim().toLowerCase())
}

/*
 * Profesionales de prueba: la allowlist que vivía acá (`veProfesionalesDePrueba`)
 * se fue con la migración 186. Ahora la marca es `profiles.es_prueba` y la regla
 * la aplica la base: prueba ↔ prueba, real ↔ real. Espejo en
 * `mobile/src/lib/featureFlags.ts`.
 */

/**
 * El S.O.S. del paciente todavía no sale en producción (Mateo, 2026-10-05):
 * el único móvil de prod es de prueba, y desde la 186 la emergencia de un
 * paciente real no se puede despachar a una tripulación de prueba. Se ve en
 * staging, y en producción sólo para las cuentas de prueba
 * (`profiles.es_prueba`) y las internas que usan los dos mundos
 * (`ve_ambos_mundos`: Mateo y Nacho, migración 187). Espejo de
 * `emergenciasVisible` en `mobile/src/lib/featureFlags.ts`.
 *
 * Esconde la ENTRADA a un S.O.S. nuevo. Una emergencia ya en curso se sigue
 * mostrando siempre: esconderla dejaría al paciente sin volver al seguimiento.
 */
const LANZAMIENTO_ALLOWLIST = ['mateoaldao@gmail.com', 'arteaga.ignacio95@gmail.com']

export function emergenciasVisible(profile) {
  if (!esProduccion) return true
  if (profile?.es_prueba || profile?.ve_ambos_mundos) return true
  return LANZAMIENTO_ALLOWLIST.includes(String(profile?.email ?? '').trim().toLowerCase())
}
