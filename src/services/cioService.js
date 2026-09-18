import { supabase } from '../lib/supabase'
import { cioTrack, toE164Ar } from '../utils/customerio'

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
    .select('id, full_name, email, phone, role, professional_profiles!professional_profiles_user_id_fkey(id, address)')
    .in('id', ids)
  if (error) return {}

  const byId = Object.fromEntries((data || []).map((row) => [row.id, row]))
  return { patient: byId[patientId], professional: byId[professionalId] }
}

/**
 * El teléfono sale SIEMPRE en E.164 (`+549…`). Antes salía crudo, tal como la
 * persona lo había tipeado ("11 5555-0000", "011…", "15…"), y Customer.io no
 * puede mandar un WhatsApp a eso: el envío falla o le llega a otro número. Es
 * el stopper transversal que levantó Hyppo el 2026-09-16.
 *
 * El crudo viaja igual en `*_phone_raw` para poder corregirlo sin perder el dato.
 */
function partyProps(prefix, row) {
  if (!row) return {}
  const phone = toE164Ar(row.phone)
  return {
    [`${prefix}_id`]:    row.id,
    [`${prefix}_name`]:  row.full_name,
    [`${prefix}_email`]: row.email,
    [`${prefix}_phone`]: phone ?? undefined,
    [`${prefix}_phone_raw`]: phone ? undefined : row.phone,
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

/**
 * Base pública de la app, para los links que van en el cuerpo del mail o del
 * WhatsApp.
 *
 * A propósito NO usa `import.meta.env.VITE_APP_URL`: esa variable vale
 * `http://localhost:5173` en desarrollo, y un evento disparado desde un build
 * de dev o de preview le metería ese link al WhatsApp de un paciente real —
 * Customer.io no distingue de qué entorno vino el evento. El link tiene que ser
 * el de producción siempre.
 *
 * Es el mismo valor que devuelve `cio.base_url()` en la migración 166, que es
 * la otra mitad de lo que lee Customer.io.
 */
const APP_URL = 'https://gethealthier.vercel.app'

/**
 * ¿Es en el consultorio o por video? `modality` admite null en la base (turnos
 * viejos), así que la comparación directa deja el turno sin dirección Y sin link.
 * Espeja `cio.es_presencial()` de la migración 166.
 */
function esPresencial(row) {
  return (row.modality ?? 'video') === 'presencial' && !row.is_on_demand
}

/**
 * Dónde y por dónde. Los dos datos que pidió Hyppo y que el mail de confirmación
 * y los recordatorios no podían nombrar.
 *
 * ⚠️ El link de video NO es `consultations.daily_room_url`: esa columna está en
 * null al reservar, porque la sala de Daily se crea recién cuando el primero de
 * los dos entra (edge function `daily-token`). Un recordatorio de 24 hs armado
 * con esa columna sale con el campo vacío. El link que sirve siempre es el de la
 * pantalla de la app, que resuelve la sala cuando la persona llega.
 */
function dondeProps(row, professional) {
  const presencial = esPresencial(row)
  const direccion = professional?.professional_profiles?.[0]?.address || undefined
  return {
    modalidad:        presencial ? 'presencial' : 'videoconsulta',
    direccion:        presencial ? direccion : undefined,
    // Un turno presencial cuyo profesional nunca cargó el consultorio: la campaña
    // tiene que poder ramificar en vez de mandar el campo vacío.
    falta_direccion:  presencial && !direccion,
    link_videollamada: presencial ? undefined : `${APP_URL}/paciente/videollamada/${row.id}`,
    link_videollamada_profesional: presencial ? undefined : `${APP_URL}/profesional/videollamada/${row.id}`,
    link_mis_turnos:  `${APP_URL}/paciente/consultas`,
  }
}

/** Ficha pública del profesional — el botón "reagendar" del follow-up. */
function linkReserva(professional) {
  const id = professional?.professional_profiles?.[0]?.id
  return id ? `${APP_URL}/paciente/profesional/${id}` : undefined
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
        ...dondeProps(row, professional),
        link_reserva:            linkReserva(professional),
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
        // La rama "¿asistió al turno?" de Hyppo no tenía de dónde leer. `no_show`
        // es un estado real de `consultations`, así que la señal existía — sólo
        // no salía en ningún evento.
        attended:                row.status === 'completed',
        professional_profile_id: professional?.professional_profiles?.[0]?.id,
        // El follow-up de +7 días manda a reagendar con el mismo profesional.
        link_reserva:            linkReserva(professional),
        ...whenProps(row.scheduled_at),
        ...dondeProps(row, professional),
        ...partyProps('patient', patient),
        ...partyProps('professional', professional),
      })
    } catch {
      // idem: el cierre de la consulta manda, el evento no.
    }
  },
}
