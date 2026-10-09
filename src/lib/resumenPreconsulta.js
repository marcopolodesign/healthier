/**
 * Una preconsulta resumida en una o dos líneas, para mostrarla donde no entra
 * el `PreconsultaSummary` entero: el pedido de Teleclínica que le llega al
 * profesional (que decide si lo toma con esto) y la lista del super admin.
 *
 * Acepta el payload en snake_case (como se guarda) o en camelCase (como lo
 * devuelve `toCamelCase`). Devuelve null si no hay preconsulta. Es defensivo a
 * propósito: lo pinta la pantalla de TODOS los profesionales elegibles.
 */
const txt = v => (typeof v === 'string' && v.trim() ? v.trim() : null)

export function resumenPreconsulta(pc) {
  if (!pc || typeof pc !== 'object') return null
  const sintoma = pc.symptom && typeof pc.symptom === 'object' ? pc.symptom : {}
  const motivo = txt(sintoma.free_text) || txt(sintoma.freeText) || txt(sintoma.label) || txt(pc.main_complaint) || txt(pc.mainComplaint)
  if (!motivo) return null
  const respuestas = (Array.isArray(pc.answers) ? pc.answers : []).filter(r => r && typeof r === 'object')
  const detalle = respuestas
    .flatMap(r => (Array.isArray(r.labels) ? r.labels : []))
    .map(txt).filter(Boolean).join(' · ')
  const alarma = (pc.has_red_flags ?? pc.hasRedFlags) === true || respuestas.some(r => (r.red_flag ?? r.redFlag) === true)
  return { motivo, detalle: detalle || null, alarma }
}
