import { supabase } from '../lib/supabase'

// activityPlanService — plan de actividad/rutina para Salud Mental, Rehabilitación
// y Preparador Físico. Mismo patrón que nutriplanService.js (migración 131) pero
// genérico y sin cálculos: título + indicaciones + una lista de items
// {nombre, detalle, frecuencia}. Ver migración 171 (activity_plans).

export const TIPOS = [
  { value: 'mente', label: 'Salud Mental' },
  { value: 'rehabilitacion', label: 'Rehabilitación' },
  { value: 'preparador', label: 'Preparador Físico' },
]

export const TIPO_LABELS = Object.fromEntries(TIPOS.map(t => [t.value, t.label]))

// Qué tipo(s) de plan puede cargar un profesional según su especialidad
// (`professional_profiles.specialty`, catálogo de la migración 101). El
// catálogo hoy no distingue "kinesiólogo" de "entrenador" — los dos declaran
// specialty='entrenamiento' (no existe un slug 'kinesiologia' propio, ver
// PROFESSION_CATEGORIES en lib/verticals.js) — así que a un profesional de
// 'entrenamiento' se le ofrecen los dos tipos y elige cuál está cargando.
// Psicología es unívoca: siempre 'mente'.
export function tiposParaEspecialidad(specialty) {
  if (specialty === 'psicologia') return ['mente']
  if (specialty === 'entrenamiento') return ['rehabilitacion', 'preparador']
  return []
}

function mapPlan(row) {
  if (!row) return null
  return {
    id: row.id,
    patientId: row.patient_id,
    professionalId: row.professional_id,
    consultationId: row.consultation_id,
    tipo: row.tipo,
    titulo: row.titulo,
    indicaciones: row.indicaciones,
    // NUNCA pasar `items` por un helper de camelCase/snakeCase recursivo — son
    // objetos libres {nombre, detalle, frecuencia}, no columnas de la base.
    items: Array.isArray(row.items) ? row.items : [],
    vigente: row.vigente,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    professional: row.professional
      ? {
          id: row.professional.id,
          fullName: row.professional.full_name,
          avatarUrl: row.professional.avatar_url,
        }
      : null,
  }
}

const SELECT_CON_PROFESIONAL = '*, professional:profiles!professional_id(id, full_name, avatar_url)'

// ── Lado profesional ─────────────────────────────────────────────────────────

// El plan vigente que ESTE profesional le armó a este paciente, para ese tipo
// (precarga el formulario de edición).
export async function getPlanForPatient(patientId, professionalId, tipo) {
  const { data, error } = await supabase
    .from('activity_plans')
    .select('*')
    .eq('patient_id', patientId)
    .eq('professional_id', professionalId)
    .eq('tipo', tipo)
    .eq('vigente', true)
    .maybeSingle()
  if (error) throw error
  return mapPlan(data)
}

// Planes anteriores (no vigentes) que ESTE profesional le armó a este paciente,
// para el mismo tipo — historial dentro del editor.
export async function getHistorialPlanes(patientId, professionalId, tipo) {
  const { data, error } = await supabase
    .from('activity_plans')
    .select('*')
    .eq('patient_id', patientId)
    .eq('professional_id', professionalId)
    .eq('tipo', tipo)
    .eq('vigente', false)
    .order('updated_at', { ascending: false })
  if (error) throw error
  return (data || []).map(mapPlan)
}

/**
 * Guarda el plan. Por default EDITA en el lugar el plan vigente de este
 * profesional para este paciente/tipo (mismo criterio que nutrition_plans). Con
 * `asNew: true` el vigente actual pasa a archivado (vigente=false) y se inserta
 * uno nuevo — así el paciente conserva "Planes anteriores" en vez de perder el
 * historial cada vez que el profesional ajusta la rutina.
 */
export async function savePlan({
  patientId, professionalId, consultationId = null, tipo, titulo, indicaciones, items, asNew = false,
}) {
  const row = {
    patient_id: patientId,
    professional_id: professionalId,
    consultation_id: consultationId,
    tipo,
    titulo,
    indicaciones,
    items,
  }

  const { data: existing, error: findError } = await supabase
    .from('activity_plans')
    .select('id')
    .eq('patient_id', patientId)
    .eq('professional_id', professionalId)
    .eq('tipo', tipo)
    .eq('vigente', true)
    .maybeSingle()
  if (findError) throw findError

  if (existing && asNew) {
    const { error: archiveError } = await supabase
      .from('activity_plans')
      .update({ vigente: false })
      .eq('id', existing.id)
    if (archiveError) throw archiveError
  }

  const query = existing && !asNew
    ? supabase.from('activity_plans').update(row).eq('id', existing.id)
    : supabase.from('activity_plans').insert({ ...row, vigente: true })

  const { data, error } = await query.select('*').single()
  if (error) throw error
  return mapPlan(data)
}

// ── Lado paciente ────────────────────────────────────────────────────────────

// Planes vigentes de este tipo (normalmente uno, pero un paciente puede tener
// más de un profesional de la misma vertical a la vez) + los archivados, cada
// uno con quién lo armó.
export async function getPlanesByTipo(patientId, tipo) {
  const { data, error } = await supabase
    .from('activity_plans')
    .select(SELECT_CON_PROFESIONAL)
    .eq('patient_id', patientId)
    .eq('tipo', tipo)
    .order('updated_at', { ascending: false })
  if (error) throw error
  const planes = (data || []).map(mapPlan)
  return {
    vigentes: planes.filter(p => p.vigente),
    anteriores: planes.filter(p => !p.vigente),
  }
}
