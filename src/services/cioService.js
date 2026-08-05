import { supabase } from '../lib/supabase'
import { cioTrack } from '../utils/customerio'

// Eventos "ricos" de Customer.io — los que llevan payload completo porque del
// otro lado hay una campaña que manda un mail o un WhatsApp de verdad.
//
// Los eventos de UI (clicks, pageviews, los ~50 `track()` que ya existían) van
// solos por el auto-capture y por el fan-out de `utils/analytics.js`. Acá están
// sólo los momentos de negocio, que necesitan datos que el componente no tiene
// a mano y hay que ir a buscar a la base.
//
// 🔴 Regla de contenido (Ley 25.326 art. 8): sale la LOGÍSTICA de la consulta
// (quién, cuándo, cuánto, por qué canal) y NUNCA el CONTENIDO clínico. Motivo
// de consulta, notas de cierre, diagnóstico, receta y especialidad-del-paciente
// se reportan como booleanos (`has_closing_notes`) o no se reportan.
//
// El `professional_id` es `profiles.id` — el mismo uuid con el que se hace
// `identify` del profesional. Eso es lo que permite que Customer.io matchee la
// persona y le dispare el WhatsApp al médico.

/** Datos de contacto de las dos partes. `profiles.role='professional'` es
 *  legible por cualquier autenticado (RLS `profiles_read_professionals`), y el
 *  paciente lee su propia fila, así que esto funciona desde los dos lados. */
async function fetchParties(patientId, professionalId) {
  const ids = [patientId, professionalId].filter(Boolean)
  if (!ids.length) return {}

  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, phone, role, professional_profiles!professional_profiles_user_id_fkey(id)')
    .in('id', ids)
  if (error) return {}

  const byId = Object.fromEntries((data || []).map((row) => [row.id, row]))
  return { patient: byId[patientId], professional: byId[professionalId] }
}

function partyProps(prefix, row) {
  if (!row) return {}
  return {
    [`${prefix}_id`]:    row.id,
    [`${prefix}_name`]:  row.full_name,
    [`${prefix}_email`]: row.email,
    [`${prefix}_phone`]: row.phone,
  }
}

/** Fecha y hora separadas, en hora de Buenos Aires — es lo que se usa en el
 *  cuerpo del mail y del WhatsApp, y formatearlo dentro de Customer.io es
 *  incómodo (guarda UTC y el liquid no tiene timezone). */
function whenProps(iso) {
  if (!iso) return {}
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return {}
  const opts = { timeZone: 'America/Argentina/Buenos_Aires' }
  return {
    scheduled_at:        iso,
    scheduled_timestamp: Math.floor(d.getTime() / 1000),
    scheduled_date:      d.toLocaleDateString('es-AR', { ...opts, day: '2-digit', month: '2-digit', year: 'numeric' }),
    scheduled_time:      d.toLocaleTimeString('es-AR', { ...opts, hour: '2-digit', minute: '2-digit' }),
    scheduled_weekday:   d.toLocaleDateString('es-AR', { ...opts, weekday: 'long' }),
  }
}

export const cioService = {
  /**
   * `appointment_booked` — se reservó un turno.
   * Dispara el mail de confirmación al paciente y el WhatsApp al profesional.
   */
  async appointmentBooked(row, { bookedBy = 'patient' } = {}) {
    try {
      const { patient, professional } = await fetchParties(row.patient_id, row.professional_id)
      cioTrack('appointment_booked', {
        consultation_id:         row.id,
        booked_by:               bookedBy,
        modality:                row.modality,
        is_on_demand:            !!row.is_on_demand,
        status:                  row.status,
        price:                   row.price_at_booking != null ? Number(row.price_at_booking) : undefined,
        currency:                'ARS',
        payment_status:          row.payment_status,
        has_obra_social:         !!row.obra_social_name,
        professional_profile_id: professional?.professional_profiles?.[0]?.id,
        ...whenProps(row.scheduled_at),
        ...partyProps('patient', patient),
        ...partyProps('professional', professional),
      })
    } catch {
      // Nunca romper una reserva por un evento de marketing.
    }
  },

  /**
   * `consultation_closed` — el profesional cerró la consulta.
   * Dispara la encuesta al paciente y el resumen al profesional.
   *
   * Va TODO lo compartible: partes, duración real, plata, si quedó receta.
   * No va el contenido de las notas de cierre ni el diagnóstico.
   */
  async consultationClosed(consultationId, { closedBy } = {}) {
    try {
      const { data: row, error } = await supabase
        .from('consultations')
        .select('id, patient_id, professional_id, status, modality, is_on_demand, scheduled_at, started_at, completed_at, duration_minutes, payment_status, price_at_booking, obra_social_name, closing_notes')
        .eq('id', consultationId)
        .single()
      if (error || !row) return

      const { patient, professional } = await fetchParties(row.patient_id, row.professional_id)
      cioTrack('consultation_closed', {
        consultation_id:         row.id,
        closed_by:               closedBy,
        status:                  row.status,
        modality:                row.modality,
        is_on_demand:            !!row.is_on_demand,
        started_at:              row.started_at,
        completed_at:            row.completed_at,
        completed_timestamp:     row.completed_at ? Math.floor(new Date(row.completed_at).getTime() / 1000) : undefined,
        duration_minutes:        row.duration_minutes != null ? Number(row.duration_minutes) : undefined,
        price:                   row.price_at_booking != null ? Number(row.price_at_booking) : undefined,
        currency:                'ARS',
        payment_status:          row.payment_status,
        has_obra_social:         !!row.obra_social_name,
        // Booleano a propósito: el texto de cierre es dato clínico.
        has_closing_notes:       !!row.closing_notes,
        professional_profile_id: professional?.professional_profiles?.[0]?.id,
        ...whenProps(row.scheduled_at),
        ...partyProps('patient', patient),
        ...partyProps('professional', professional),
      })
    } catch {
      // idem: el cierre de la consulta manda, el evento no.
    }
  },
}
