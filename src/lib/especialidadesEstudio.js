/**
 * Especialidad de un estudio cargado por el paciente (`medical_documents.especialidad`,
 * migración 174). Los valores son el contrato con la base y con la app — el
 * check de la columna acepta exactamente estos cinco.
 */
export const ESPECIALIDADES_ESTUDIO = [
  { id: 'odontologia',  label: 'Odontología' },
  { id: 'medicina',     label: 'Medicina' },
  { id: 'kinesiologia', label: 'Kinesiología' },
  { id: 'pediatria',    label: 'Pediatría' },
  { id: 'otra',         label: 'Otra' },
]

const LABELS = Object.fromEntries(ESPECIALIDADES_ESTUDIO.map(e => [e.id, e.label]))

/** Lo cargado antes de la 174 no tiene especialidad: se muestra así, nunca rompe. */
export const SIN_ESPECIALIDAD = 'Sin especialidad'

export function labelEspecialidadEstudio(id) {
  return LABELS[id] ?? SIN_ESPECIALIDAD
}

const normalizar = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/**
 * Qué especialidad de estudio le corresponde a un profesional, para destacarla
 * por defecto en su filtro. `null` = no hay una obvia (psicología, nutrición,
 * entrenamiento, veterinaria…) y el filtro arranca en "Todas".
 */
export function especialidadEstudioDelProfesional(specialtySlug) {
  const s = normalizar(specialtySlug)
  if (!s || s === 'otra') return null
  if (s.includes('odonto')) return 'odontologia'
  if (s.includes('kinesio')) return 'kinesiologia'
  if (s.includes('pediatr')) return 'pediatria'
  if (/psico|psiqu|terapia|nutri|entrena|veterin/.test(s)) return null
  return 'medicina'
}

/** "radiografia_muela.final.pdf" → "radiografia_muela.final" */
export function tituloPorDefecto(fileName) {
  const nombre = fileName || ''
  const punto = nombre.lastIndexOf('.')
  return punto > 0 ? nombre.slice(0, punto) : nombre
}
