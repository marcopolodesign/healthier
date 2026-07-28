import { supabase, toCamelCase } from '../lib/supabase'

/**
 * Bitácora de eventos por consulta (migración 070).
 *
 * Existe porque una videollamada de prueba terminó en `no_show` y nadie podía
 * decir por qué: la consulta solo guarda su estado FINAL. Esto guarda la línea
 * de tiempo — quién hizo qué y cuándo.
 *
 * El trigger de la migración ya registra todo cambio de estado pase lo que pase.
 * Lo que se escribe desde acá es el detalle que la base no puede ver sola:
 * que el paciente entró a la sala, que alguien se unió al Daily, que el otro
 * participante apareció (o no), que se colgó.
 *
 * Regla: registrar NUNCA debe romper el flujo. Todas las escrituras son
 * best-effort y se tragan sus errores — una consulta no puede fallar porque
 * falló su log.
 */

/** Slugs estables. Usar estos y no strings sueltos, para que las lecturas no se rompan. */
export const CONSULTATION_EVENTS = {
  PRECONSULTA_SUBMITTED:  'preconsulta_submitted',
  PATIENT_ENTERED_WAITING: 'patient_entered_waiting',
  PATIENT_LEFT_WAITING:    'patient_left_waiting',
  PRO_ADMITTED_PATIENT:    'professional_admitted_patient',
  CALL_PAGE_OPENED:        'call_page_opened',
  CALL_JOINED:             'call_joined',
  CALL_PARTICIPANT_JOINED: 'call_participant_joined',
  CALL_LEFT:               'call_left',
  CALL_ERROR:              'call_error',
  MARKED_NO_SHOW:          'marked_no_show',
  CONSULTATION_CLOSED:     'consultation_closed',
}

export const consultationEventsService = {
  /**
   * Registra un evento. Best-effort por diseño: devuelve siempre, nunca tira.
   *
   * @param {string} consultationId
   * @param {string} event  — usar CONSULTATION_EVENTS
   * @param {object} [detail] — cualquier cosa que ayude a entender qué pasó
   * @param {{id?: string, role?: string}} [actor]
   */
  async log(consultationId, event, detail = null, actor = null) {
    if (!consultationId || !event) return
    try {
      await supabase.from('consultation_events').insert({
        consultation_id: consultationId,
        actor_id: actor?.id ?? null,
        actor_role: actor?.role ?? null,
        event,
        detail,
      })
    } catch {
      // Un log que rompe el flujo es peor que no tener log.
    }
  },

  /** Línea de tiempo completa de una consulta, en orden cronológico. */
  async listByConsultation(consultationId) {
    const { data, error } = await supabase
      .from('consultation_events')
      .select('*, actor:profiles!actor_id(full_name, role)')
      .eq('consultation_id', consultationId)
      .order('created_at', { ascending: true })
    if (error) throw error
    return (data ?? []).map(toCamelCase)
  },
}
