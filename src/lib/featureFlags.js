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
