import { supabase, toCamelCase } from '../lib/supabase'
import { VERTICALS_BY_ID } from '../lib/verticals'

/**
 * Derivaciones (migración 195, docs/derivaciones.md).
 *
 * Todas las escrituras van por RPC (`crear_derivacion`, `responder_consentimiento_derivacion`,
 * `cancelar_derivacion`): validan quién puede hacer qué y los errores vienen en
 * castellano en `error.message`, así que se relanzan tal cual para mostrarlos.
 * La lectura es un select común: la RLS decide qué ve cada uno (el paciente y su
 * titular, quien derivó, el destinatario, el super admin).
 */
const SELECT = `*,
  derivado:profiles!derivado_por(id, full_name, avatar_url),
  destino:profiles!profesional_destino_id(id, full_name, avatar_url),
  paciente:profiles!patient_id(id, full_name, avatar_url)`

// Mismo select + el turno vinculado, para el listado del super admin.
const SELECT_ADMIN = `${SELECT},
  consulta_reservada:consultations!consulta_reservada_id(id, scheduled_at, status)`

/** Embed para colgar "Derivado por" de una consulta. Ojo: hay DOS FKs entre
 *  consultations y derivaciones, el `!derivacion_id` desambigua. */
export const DERIVACION_EMBED =
  'derivacion:derivaciones!derivacion_id(id, motivo, derivado:profiles!derivado_por(full_name))'

export const ESTADOS_DERIVACION = {
  pendiente: { label: 'Pendiente', clase: 'bg-amber-50 text-amber-700 border-amber-200' },
  reservada: { label: 'Reservada', clase: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  vencida: { label: 'Vencida', clase: 'bg-gray-100 text-gray-600 border-gray-200' },
  cancelada: { label: 'Cancelada', clase: 'bg-red-50 text-red-700 border-red-200' },
}

/** Una derivación está viva si sigue pendiente y no pasó su vencimiento. */
export function derivacionVigente(d) {
  return d?.estado === 'pendiente' && (!d.venceAt || new Date(d.venceAt) > new Date())
}

/**
 * Texto del destino: el profesional con nombre y apellido, o la vertical (con la
 * especialidad si la hay). `porSlug` viene de `useEspecialidades()`.
 */
export function destinoLabel(d, porSlug = {}) {
  if (!d) return ''
  if (d.destino?.fullName) return d.destino.fullName
  const vertical = VERTICALS_BY_ID[d.verticalDestino]?.nombre ?? d.verticalDestino
  const esp = d.especialidadDestino ? (porSlug[d.especialidadDestino] ?? d.especialidadDestino) : null
  return esp ? `${vertical} · ${esp}` : vertical
}

async function leer(query) {
  const { data, error } = await query
  if (error) throw error
  return toCamelCase(data ?? [])
}

export const derivacionesService = {
  async crear({ patientId, motivo, profesionalDestinoId = null, verticalDestino = null, especialidadDestino = null, consultaOrigenId = null }) {
    const { data, error } = await supabase.rpc('crear_derivacion', {
      p_patient_id: patientId,
      p_motivo: motivo,
      p_profesional_destino_id: profesionalDestinoId,
      p_vertical_destino: verticalDestino,
      p_especialidad_destino: especialidadDestino,
      p_consulta_origen_id: consultaOrigenId,
    })
    if (error) throw error
    return data
  },

  async responderConsentimiento(derivacionId, acepta) {
    const { error } = await supabase.rpc('responder_consentimiento_derivacion', {
      p_derivacion_id: derivacionId,
      p_acepta: acepta,
    })
    if (error) throw error
  },

  async cancelar(derivacionId) {
    const { error } = await supabase.rpc('cancelar_derivacion', { p_derivacion_id: derivacionId })
    if (error) throw error
  },

  async getById(id) {
    const { data, error } = await supabase.from('derivaciones').select(SELECT).eq('id', id).maybeSingle()
    if (error) throw error
    return data ? toCamelCase(data) : null
  },

  /** Las del paciente (la RLS suma las de sus familiares si es el titular). */
  listarDelPaciente(patientId) {
    return leer(supabase.from('derivaciones').select(SELECT).eq('patient_id', patientId).order('created_at', { ascending: false }))
  },

  /** Las derivaciones vivas que el usuario puede ver como paciente: para el inicio. */
  listarPendientesVisibles() {
    return leer(
      supabase.from('derivaciones').select(SELECT)
        .eq('estado', 'pendiente')
        .gt('vence_at', new Date().toISOString())
        .order('created_at', { ascending: false }),
    )
  },

  /** Las que hizo este profesional. Con `patientId`, sólo las de ese paciente. */
  listarHechas(proId, { patientId = null } = {}) {
    let q = supabase.from('derivaciones').select(SELECT).eq('derivado_por', proId)
    if (patientId) q = q.eq('patient_id', patientId)
    return leer(q.order('created_at', { ascending: false }))
  },

  /** Las que le hicieron a este profesional (destino concreto). */
  listarRecibidas(proId, { patientId = null } = {}) {
    let q = supabase.from('derivaciones').select(SELECT).eq('profesional_destino_id', proId)
    if (patientId) q = q.eq('patient_id', patientId)
    return leer(q.order('created_at', { ascending: false }))
  },

  /** La derivación detrás de una consulta reservada (null si no vino de una). */
  getForConsultation(derivacionId) {
    return derivacionId ? this.getById(derivacionId) : Promise.resolve(null)
  },

  /** Todas, con el turno vinculado — super admin. */
  adminListar() {
    return leer(supabase.from('derivaciones').select(SELECT_ADMIN).order('created_at', { ascending: false }))
  },
}
