import { supabase, toCamelCase } from '../lib/supabase'

/**
 * "El paciente está en camino" — `consultation_arrivals` (migración 145).
 *
 * El paciente publica su posición y su ETA mientras va al consultorio; el
 * profesional de ese turno los lee. La RLS es la que impide que la posición de
 * alguien la vea quien no corresponde: acá no hay ningún chequeo de permisos
 * que se pueda saltear desde el cliente.
 */

/**
 * Cuánto antes del turno se empieza a compartir la ubicación con el
 * profesional. Antes de esa ventana el paciente igual ve su mapa y su ruta,
 * pero no se escribe nada en la base: no tiene sentido que el profesional vea
 * "llega en 4 h" ni guardar la posición de alguien tres días antes.
 */
export const VENTANA_ANTES_MS = 2 * 60 * 60 * 1000   // 2 horas
export const VENTANA_DESPUES_MS = 60 * 60 * 1000     // 1 hora después de la hora del turno

/**
 * Pasados estos minutos sin novedades, lo que el profesional ve dejó de ser
 * "en vivo" — la app del paciente se cerró, se quedó sin señal o llegó y no lo
 * marcó. Mostrar un ETA viejo como si fuera actual es peor que no mostrar nada.
 */
export const FRESCURA_MINUTOS = 5

/** ¿Estamos dentro de la ventana en la que se comparte con el profesional? */
export function enVentanaDeLlegada(scheduledAt, ahora = Date.now()) {
  if (!scheduledAt) return false
  const t = new Date(scheduledAt).getTime()
  return ahora >= t - VENTANA_ANTES_MS && ahora <= t + VENTANA_DESPUES_MS
}

/** ¿El dato que tenemos sigue siendo de ahora? */
export function esReciente(arrival, ahora = Date.now()) {
  if (!arrival?.updatedAt) return false
  return ahora - new Date(arrival.updatedAt).getTime() < FRESCURA_MINUTOS * 60 * 1000
}

export const arrivalsService = {
  /**
   * Publica (o pisa) la llegada en curso. Un `upsert` por `consultation_id`:
   * hay una sola llegada viva por turno, la última.
   */
  async publicar({ consultationId, patientId, professionalId, lat, lng, etaMinutes, distanceMeters, travelMode = 'driving', status = 'en_camino' }) {
    const { data, error } = await supabase
      .from('consultation_arrivals')
      .upsert({
        consultation_id:  consultationId,
        patient_id:       patientId,
        professional_id:  professionalId,
        latitude:         lat,
        longitude:        lng,
        eta_minutes:      etaMinutes ?? null,
        distance_meters:  distanceMeters ?? null,
        travel_mode:      travelMode,
        status,
      }, { onConflict: 'consultation_id' })
      .select()
      .single()
    if (error) throw error
    return toCamelCase(data)
  },

  /** El paciente deja de compartir. Se borra la fila: es un dato efímero. */
  async dejarDeCompartir(consultationId) {
    const { error } = await supabase
      .from('consultation_arrivals')
      .delete()
      .eq('consultation_id', consultationId)
    if (error) throw error
  },

  async getByConsultation(consultationId) {
    if (!consultationId) return null
    const { data, error } = await supabase
      .from('consultation_arrivals')
      .select('*')
      .eq('consultation_id', consultationId)
      .maybeSingle()
    if (error) throw error
    return data ? toCamelCase(data) : null
  },

  /**
   * Todas las llegadas vivas de la plataforma — para el panel del super admin.
   * La RLS es la que decide quién puede: a un profesional esta misma consulta
   * le devuelve sólo las suyas, y a un paciente sólo la propia.
   */
  async getEnCurso() {
    const { data, error } = await supabase
      .from('consultation_arrivals')
      .select('*')
      .order('updated_at', { ascending: false })
    if (error) throw error
    return toCamelCase(data ?? [])
  },

  /** Todas las llegadas en curso hacia ESTE profesional (su agenda del día). */
  async getByProfessional(professionalId) {
    if (!professionalId) return []
    const { data, error } = await supabase
      .from('consultation_arrivals')
      .select('*')
      .eq('professional_id', professionalId)
    if (error) throw error
    return toCamelCase(data ?? [])
  },

  /**
   * Realtime sobre las llegadas de un profesional. Devuelve la función para
   * desuscribirse — llamarla siempre en el cleanup del efecto, si no cada
   * navegación deja un canal abierto.
   */
  suscribirProfesional(professionalId, onChange) {
    if (!professionalId) return () => {}
    const canal = supabase
      .channel(`arrivals:pro:${professionalId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'consultation_arrivals', filter: `professional_id=eq.${professionalId}` },
        payload => onChange({
          evento: payload.eventType,
          arrival: payload.new && Object.keys(payload.new).length ? toCamelCase(payload.new) : null,
          anterior: payload.old && Object.keys(payload.old).length ? toCamelCase(payload.old) : null,
        }),
      )
      .subscribe()
    return () => { supabase.removeChannel(canal) }
  },
}

export default arrivalsService
