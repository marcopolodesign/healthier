import { supabase, toCamelCase } from '../lib/supabase'

/**
 * "El médico está en camino" — `emergency_tracking` (migración 149).
 *
 * Espejo de `arrivalsService`, con la dirección dada vuelta: acá el que publica
 * es el PROFESIONAL despachado y el que lee es el PACIENTE de la emergencia.
 * Quién puede ver qué lo decide la RLS: no hay ningún chequeo de permisos en
 * este archivo que se pueda saltear desde el cliente.
 */

/**
 * Pasados estos minutos sin novedades, la posición dejó de ser "en vivo" — la
 * app del profesional se cerró, se quedó sin señal, o llegó y no lo marcó.
 * Mostrarle a alguien con una emergencia un punto viejo como si fuera actual
 * es peor que decirle que no tenemos la ubicación.
 */
export const FRESCURA_MINUTOS = 2

/** ¿Lo que tenemos sigue siendo de ahora? */
export function esReciente(tracking, ahora = Date.now()) {
  if (!tracking?.updatedAt) return false
  return ahora - new Date(tracking.updatedAt).getTime() < FRESCURA_MINUTOS * 60 * 1000
}

export const emergencyTrackingService = {
  /**
   * Publica (o pisa) la posición del profesional. Un `upsert` por
   * `emergency_id`: hay un solo traslado vivo por emergencia, el último.
   */
  async publicar({ emergencyId, professionalId, patientId, lat, lng, etaMinutes, distanceMeters, travelMode = 'driving', status = 'en_camino' }) {
    const { data, error } = await supabase
      .from('emergency_tracking')
      .upsert({
        emergency_id:     emergencyId,
        professional_id:  professionalId,
        patient_id:       patientId,
        latitude:         lat,
        longitude:        lng,
        eta_minutes:      etaMinutes ?? null,
        distance_meters:  distanceMeters ?? null,
        travel_mode:      travelMode,
        status,
      }, { onConflict: 'emergency_id' })
      .select()
      .single()
    if (error) throw error
    return toCamelCase(data)
  },

  /** El profesional deja de compartir. Se borra: es un dato efímero. */
  async dejarDeCompartir(emergencyId) {
    if (!emergencyId) return
    const { error } = await supabase
      .from('emergency_tracking')
      .delete()
      .eq('emergency_id', emergencyId)
    if (error) throw error
  },

  async getByEmergency(emergencyId) {
    if (!emergencyId) return null
    const { data, error } = await supabase
      .from('emergency_tracking')
      .select('*')
      .eq('emergency_id', emergencyId)
      .maybeSingle()
    if (error) throw error
    return data ? toCamelCase(data) : null
  },

  /**
   * Todos los traslados en curso — para el panel del super admin. La RLS es la
   * que decide qué devuelve: a un paciente esta misma consulta le trae sólo el
   * suyo, y a un profesional sólo el que él publica.
   */
  async getEnCurso() {
    const { data, error } = await supabase
      .from('emergency_tracking')
      .select('*')
      .order('updated_at', { ascending: false })
    if (error) throw error
    return toCamelCase(data ?? [])
  },

  /**
   * Realtime sobre el traslado de UNA emergencia — lo que mira el paciente.
   * Devuelve la función para desuscribirse; llamarla siempre en el cleanup, si
   * no cada navegación deja un canal abierto.
   */
  suscribir(emergencyId, onChange) {
    if (!emergencyId) return () => {}
    const canal = supabase
      .channel(`emergency-tracking:${emergencyId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'emergency_tracking', filter: `emergency_id=eq.${emergencyId}` },
        payload => onChange({
          evento: payload.eventType,
          tracking: payload.new && Object.keys(payload.new).length ? toCamelCase(payload.new) : null,
        }),
      )
      .subscribe()
    return () => { supabase.removeChannel(canal) }
  },
}

export default emergencyTrackingService
