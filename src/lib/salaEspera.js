/**
 * Sala de espera del paciente cuando el profesional ya lo habilitó
 * (`patient_admitted_at`) o la consulta ya está en curso: el texto deja de
 * decir "esperando que se una" (Mateo + Felipe, 2026-10-13). Espejo de
 * `mobile/src/lib/salaEspera.ts`. Control: `node scripts/test-sala-espera.mjs`.
 */
const TITULOS = new Set(['dr', 'dra', 'lic', 'licda', 'mg', 'mgtr', 'prof', 'ing', 'od', 'klgo', 'klga', 'tec'])

/**
 * "Dra. Valentina Ortega" tal cual; "Macarena Alejandra Arteaga" → "Macarena
 * Arteaga". Si pasa de 24 caracteres: tratamiento + apellido ("Dra. Ortega").
 * Sin tratamiento no se inventa uno.
 */
export function nombreCorto(fullName) {
  const partes = String(fullName ?? '').trim().split(/\s+/).filter(Boolean)
  if (!partes.length) return null
  const titulo = TITULOS.has(partes[0].toLowerCase().replace(/\.$/, '')) ? partes[0] : null
  const resto = titulo ? partes.slice(1) : partes
  if (!resto.length) return null
  const nombre = resto.length > 1 ? [resto[0], resto[resto.length - 1]] : [resto[0]]
  const corto = [titulo, ...nombre].filter(Boolean).join(' ')
  if (corto.length <= 24) return corto
  return titulo ? `${titulo} ${resto[resto.length - 1]}` : resto[resto.length - 1]
}

export function textoSalaHabilitada(fullName) {
  const n = nombreCorto(fullName)
  return {
    titulo: n ? `${n} te está esperando` : 'Tu profesional te está esperando',
    sub: 'Ya te habilitó. Entrá cuando quieras.',
  }
}
