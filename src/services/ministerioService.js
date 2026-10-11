import { supabase, toCamelCase } from '../lib/supabase'

/**
 * Registros del Ministerio de Salud (migración 196):
 *  - Federador Nacional de pacientes (`profiles.federador_*`, Edge Function `federador-paciente`)
 *  - REFES, consultorios de los profesionales (`professional_profiles.refes_*`, `refes-consultorio`)
 *
 * Todo lo escriben las Edge Functions; desde el front sólo el super admin
 * reintenta o decide a mano.
 */

/** "Consultorio habilitado": match automático o aprobado por el super admin. */
export const consultorioHabilitado = (pro) =>
  ['verificado', 'aprobado_manual'].includes(pro?.refesEstado ?? pro?.refes_estado)

async function invocar(funcion, body) {
  const { data, error } = await supabase.functions.invoke(funcion, { body })
  if (error) {
    let detalle = error.message
    try { detalle = (await error.context?.json())?.error ?? detalle } catch { /* sin cuerpo */ }
    throw new Error(detalle)
  }
  return data
}

export const ministerioService = {
  async listarConsultorios() {
    const { data, error } = await supabase
      .from('professional_profiles')
      .select('id, specialty, address, refes_id, refes_estado, refes_nombre, refes_raw, refes_error, refes_actualizado_at, refes_revisado_at, profile:profiles!user_id(full_name, email)')
      .not('refes_estado', 'is', null)
      .order('refes_actualizado_at', { ascending: false, nullsFirst: false })
      .limit(500)
    if (error) throw error
    return toCamelCase(data ?? [])
  },

  reintentarConsultorio: (professionalId) => invocar('refes-consultorio', { professionalId }),

  decidirConsultorio: (professionalId, decision, nota) =>
    invocar('refes-consultorio', { professionalId, decision, nota }),

  async listarFederador() {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, email, es_prueba, federador_id, federador_estado, federador_error, federador_intentos, federador_actualizado_at, federador_proximo_intento')
      .eq('role', 'patient')
      .not('federador_estado', 'is', null)
      .order('federador_actualizado_at', { ascending: false, nullsFirst: false })
      .limit(1000)
    if (error) throw error
    return toCamelCase(data ?? [])
  },

  reintentarFederador: (profileId) => invocar('federador-paciente', { profileId }),
}
