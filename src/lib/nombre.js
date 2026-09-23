/**
 * Nombres de personas: el tratamiento no es parte del nombre.
 *
 * `profiles.full_name` de un profesional casi siempre viene como
 * "Dra. Valentina Ruiz" — el placeholder del alta lo pide así. Sacar la
 * inicial cruda daba "D" para todos los médicos y "L" para los licenciados,
 * que es lo que se veía en los avatares sin foto de toda la plataforma.
 *
 * El mismo criterio vive en `supabase/functions/_shared/email/layout.ts`
 * (Deno no puede importar de `src/`): si cambia acá, cambiar allá.
 */

const TRATAMIENTO = /^(dr|dra|lic|prof|mg|mgtr)\.?$/i

/** "Dra. Valentina Ruiz" → ["Valentina", "Ruiz"]. Si sólo hay tratamiento, se devuelve tal cual. */
export function partesDeNombre(nombre) {
  const partes = String(nombre ?? '').trim().split(/\s+/).filter(Boolean)
  const propias = partes.filter(p => !TRATAMIENTO.test(p))
  return propias.length ? propias : partes
}

/** "Dra. Valentina Ruiz" → "V". Para el avatar de una sola letra. */
export function inicialDeNombre(nombre) {
  return (partesDeNombre(nombre)[0] ?? '?').charAt(0).toUpperCase()
}

/** "Dra. Valentina Ruiz" → "VR". Para el avatar de dos letras. */
export function inicialesDeNombre(nombre) {
  const partes = partesDeNombre(nombre)
  if (!partes.length) return '?'
  return (partes.length === 1
    ? partes[0].substring(0, 2)
    : partes[0][0] + partes[partes.length - 1][0]
  ).toUpperCase()
}

/** "Dra. Valentina Ruiz" → "Valentina". El nombre de pila, para tutear. */
export function nombreDePila(nombre) {
  return partesDeNombre(nombre)[0] ?? String(nombre ?? '')
}
