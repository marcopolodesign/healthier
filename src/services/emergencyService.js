import { supabase, toCamelCase } from '../lib/supabase'
import { verticalsService } from './verticalsService'

// ─────────────────────────────────────────────────────────────
// SOS settings — precio y disponibilidad, configurables desde
// /super-admin/verticales (migración 087, reusa `vertical_settings` con
// id='sos'; ver el comentario de esa migración para el porqué de reusar la
// tabla en vez de crear una nueva). `verticalsService` es la única dueña de
// las lecturas de esa tabla — acá sólo se envuelve con la semántica propia de
// S.O.S. (fail-open) y la forma que consume esta pantalla.
// ─────────────────────────────────────────────────────────────
export const SOS_FALLBACK = { enabled: true, price: 50 }

/**
 * Config actual de S.O.S. Fail-open a propósito: si la fila no existe o falla
 * la lectura (red caída, RLS mal configurada, lo que sea), el flujo de
 * emergencia NUNCA se bloquea por un problema de disponibilidad — es peor
 * mostrarle "no disponible" a un paciente con una emergencia real por un error
 * de lectura que dejar pasar la constante vieja como fallback.
 */
export async function getSosSettings() {
  try {
    const row = await verticalsService.getById('sos')
    if (!row) return SOS_FALLBACK
    return {
      enabled: row.enabled ?? SOS_FALLBACK.enabled,
      price: row.ondemandPrice != null ? Number(row.ondemandPrice) : SOS_FALLBACK.price,
    }
  } catch {
    return SOS_FALLBACK
  }
}

// Shared across professional + patient queries and their consumers
// (professional/Dashboard.jsx, professional/Emergencias.jsx) so the set of
// "still active" / "already resolved" statuses lives in one place.
export const EMERGENCY_ACTIVE_STATUSES = ['dispatched', 'in_transit', 'arrived']
export const EMERGENCY_TERMINAL_STATUSES = ['cancelled', 'completed']

/**
 * Lo que el PACIENTE tiene que poder retomar. Es un conjunto más ancho que el
 * del profesional a propósito: una solicitud sin pagar (`pending`) o pagada y
 * esperando móvil (`awaiting_dispatch`) todavía no tiene a nadie asignado, así
 * que no aparece en ninguna de las otras consultas — pero si el paciente
 * recarga la pantalla en ese momento tiene que volver a donde estaba, no
 * empezar de cero con una emergencia colgada en la base.
 */
export const EMERGENCY_PATIENT_OPEN_STATUSES = [
  'pending', 'awaiting_dispatch', 'dispatched', 'in_transit', 'arrived',
]

// ─────────────────────────────────────────────────────────────
// TODO (future): WhatsApp notification on emergency assignment
//
// When a patient fires an emergency and a professional is matched,
// send a WhatsApp message to the professional's phone number:
//   "🚨 Nueva emergencia asignada — Código ROJO (UTM-8842)
//    Abrí la app para aceptar: https://app.healthier.ar/profesional/emergencias?id=<id>"
//
// Implementation path:
//   1. Twilio WhatsApp API or Meta Cloud API (WhatsApp Business)
//   2. Trigger from a Supabase Edge Function on emergencies INSERT
//   3. Professional phone stored in profiles.phone (needs migration if not present)
//   4. Link must include ?id=<emergencia_id> so the screen loads the right record
//
// Do NOT use the Realtime subscription as the sole delivery channel —
// it only works if the professional already has the app open. The push
// notification below (send-push-notification) is the reliable fallback when
// the app is closed. WhatsApp would be a further fallback on top of that.
// ─────────────────────────────────────────────────────────────

export const emergencyService = {
  // ── Professional side ──────────────────────────────────────

  /** Fetch a specific emergency by ID (for deeplinks / reconnection) */
  async getById(emergenciaId) {
    const { data, error } = await supabase
      .from('emergencies')
      .select('*, patient:profiles!patient_id(full_name, avatar_url, phone)')
      .eq('id', emergenciaId)
      .single()
    if (error) throw error
    return toCamelCase(data)
  },

  /** Fetch the latest active emergency assigned to this professional */
  async getActiveForProfessional(professionalId) {
    const { data, error } = await supabase
      .from('emergencies')
      .select('*, patient:profiles!patient_id(full_name, avatar_url)')
      .eq('professional_id', professionalId)
      .in('status', EMERGENCY_ACTIVE_STATUSES)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw error
    return data ? toCamelCase(data) : null
  },

  /**
   * El traslado que le toca al usuario logueado, sea el médico asignado o
   * cualquier otro tripulante del móvil.
   *
   * `getActiveForProfessional` busca por `professional_id`, que es el médico.
   * Con la migración 160 la tripulación incluye chofer y enfermero, y a ellos
   * esa consulta les devuelve vacío: entraban a la pantalla y leían "En
   * guardia · No hay emergencias activas asignadas" con su ambulancia
   * despachada. Se vio probando desde el front con la cuenta del chofer.
   *
   * Dos consultas y no un `or` de PostgREST: el filtro por ambulancia sale de
   * otra tabla (`ambulance_crew`), así que no hay forma de expresarlo en un
   * solo `.or()`. La RLS igual acota las dos — un ajeno no ve ninguna.
   */
  async getActiveParaTripulacion(profileId) {
    const propia = await this.getActiveForProfessional(profileId)
    if (propia) return propia

    const { data: moviles, error: crewError } = await supabase
      .from('ambulance_crew')
      .select('ambulance_id')
      .eq('profile_id', profileId)
      .eq('active', true)
    if (crewError) throw crewError
    if (!moviles?.length) return null

    const { data, error } = await supabase
      .from('emergencies')
      .select('*, patient:profiles!patient_id(full_name, avatar_url, phone)')
      .in('ambulance_id', moviles.map(m => m.ambulanceId ?? m.ambulance_id))
      .in('status', EMERGENCY_ACTIVE_STATUSES)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw error
    return data ? toCamelCase(data) : null
  },

  /**
   * Realtime para la tripulación: el filtro de `subscribe()` es
   * `professional_id=eq.<uid>`, que al chofer no le trae nada. Acá se escucha
   * por ambulancia.
   */
  suscribirTripulacion(ambulanceIds, onChange) {
    if (!ambulanceIds?.length) return () => {}
    const canales = ambulanceIds.map(id =>
      supabase
        .channel(`crew-emergency-${id}`)
        .on('postgres_changes',
          { event: '*', schema: 'public', table: 'emergencies', filter: `ambulance_id=eq.${id}` },
          payload => onChange(toCamelCase(payload.new)))
        .subscribe(),
    )
    return () => { canales.forEach(c => supabase.removeChannel(c)) }
  },

  /** Update emergency status — returns the updated row (camelCased). */
  async updateStatus(emergencyId, status) {
    const { data, error } = await supabase
      .from('emergencies')
      .update({ status })
      .eq('id', emergencyId)
      .select()
      .single()
    if (error) throw error
    return toCamelCase(data)
  },

  /**
   * Subscribe to emergency changes for a professional.
   * Returns an unsubscribe function.
   */
  subscribe(professionalId, onChange) {
    const channel = supabase
      .channel(`pro-emergency-${professionalId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'emergencies', filter: `professional_id=eq.${professionalId}` },
        (payload) => onChange(toCamelCase(payload.new))
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'emergencies', filter: `professional_id=eq.${professionalId}` },
        (payload) => onChange(toCamelCase(payload.new))
      )
      .subscribe()

    return () => supabase.removeChannel(channel)
  },

  // ── Patient side ──────────────────────────────────────────────────────

  /** Fetch all emergencies for a patient, newest first */
  async getByPatient(patientId) {
    const { data, error } = await supabase
      .from('emergencies')
      .select('*')
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false })
    if (error) throw error
    return data ? toCamelCase(data) : []
  },

  /**
   * Fetch the patient's currently active emergency (if any), with the
   * assigned professional's contact info — used to resume the SOS screen on
   * refresh/reopen (state resilience rule: any non-terminal record needs a
   * resume path).
   */
  async getActiveForPatient(patientId) {
    const { data, error } = await supabase
      .from('emergencies')
      .select(`
        *,
        professional:profiles!professional_id(full_name, phone, avatar_url),
        ambulancia:ambulances!ambulance_id(id, label, plate, unit_type),
        entidad:emergency_providers!provider_id(id, name, color, dispatch_phone)
      `)
      .eq('patient_id', patientId)
      .in('status', EMERGENCY_PATIENT_OPEN_STATUSES)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw error
    return data ? toCamelCase(data) : null
  },

  /**
   * Paso 1 — la solicitud, todavía sin cobrar y sin nadie asignado.
   *
   * Antes acá vivía `create()`, que sorteaba un profesional al azar entre los
   * de medicina general on-demand y lo despachaba en el mismo insert. Se fue:
   * la reunión del 2026-09-11 dejó el orden en pedido → cobro → triage →
   * entidad → ambulancia, y la asignación es MANUAL de un operador. Macarena
   * fue explícita en por qué: la ambulancia más cercana no es la más rápida,
   * eso lo sabe el despachante y no un algoritmo de distancia.
   *
   * La fila se escribe ANTES de cobrar por la regla de resiliencia de estado:
   * si el paciente pierde la red en medio del pago tiene que poder volver a
   * `getActiveForPatient()` y retomar, no quedarse con una tarjeta reservada y
   * ninguna emergencia.
   */
  async crearSolicitud({ patientId, latitude, longitude, priceAtRequest }) {
    const { data, error } = await supabase
      .from('emergencies')
      .insert({
        patient_id: patientId,
        // El triage se contesta DESPUÉS del cobro, pero la columna es NOT NULL
        // desde la migración 015. VERDE es el piso: si el paciente abandona
        // entre el cobro y el triage, la solicitud que queda no miente
        // diciendo que era grave.
        triage_code: 'VERDE',
        status: 'pending',
        patient_latitude: latitude ?? null,
        patient_longitude: longitude ?? null,
        price_at_request: priceAtRequest ?? null,
      })
      .select()
      .single()
    if (error) throw error
    return toCamelCase(data)
  },

  /**
   * Paso 3 — el triage, ya con el cobro hecho. Recién con esto la solicitud
   * entra a la cola de la entidad (`awaiting_dispatch`).
   *
   * Que la base no permita saltearse el cobro lo garantiza `paid_at`: la cola
   * del operador filtra por él, así que una fila que llegue a
   * `awaiting_dispatch` sin pagar simplemente no la ve nadie.
   */
  async confirmarTriage({ emergencyId, triageCode, symptoms }) {
    const { data, error } = await supabase
      .from('emergencies')
      .update({
        triage_code: triageCode,
        notes: symptoms?.length ? JSON.stringify(symptoms) : null,
        status: 'awaiting_dispatch',
      })
      .eq('id', emergencyId)
      .select()
      .single()
    if (error) throw error
    return toCamelCase(data)
  },

  // ── Lado de la entidad que despacha ───────────────────────────────────

  /**
   * La cola del operador: pagas, triadas y sin móvil. Ordenadas por gravedad
   * y después por antigüedad — un ROJO que entró hace un minuto va antes que
   * un VERDE que entró hace diez.
   */
  async colaDeDespacho() {
    const { data, error } = await supabase
      .from('emergencies')
      .select('*, patient:profiles!patient_id(full_name, phone, avatar_url)')
      .eq('status', 'awaiting_dispatch')
      .not('paid_at', 'is', null)
      .order('created_at', { ascending: true })
    if (error) throw error
    const orden = { ROJO: 0, AMARILLO: 1, VERDE: 2 }
    return (data ?? []).map(toCamelCase)
      .sort((a, b) => (orden[a.triageCode] ?? 9) - (orden[b.triageCode] ?? 9))
  },

  /** Los traslados en curso de la entidad — la otra mitad del panel. */
  async enCursoParaDespacho() {
    const { data, error } = await supabase
      .from('emergencies')
      .select(`
        *,
        patient:profiles!patient_id(full_name, phone, avatar_url),
        ambulancia:ambulances!ambulance_id(id, label, plate)
      `)
      .in('status', EMERGENCY_ACTIVE_STATUSES)
      .order('created_at', { ascending: false })
    if (error) throw error
    return (data ?? []).map(toCamelCase)
  },

  /**
   * Paso 4 — el operador asigna un móvil. Esto es el despacho.
   *
   * `professional_id` se sigue escribiendo, con el médico de la tripulación:
   * es lo que miran la agenda del profesional, el aviso de la migración 150 y
   * todo el seguimiento de `emergency_tracking`. Sin médico a bordo queda en
   * NULL y el traslado igual existe — un móvil de traslado sin médico es un
   * caso real, no un error.
   */
  async asignarAmbulancia({ emergencyId, ambulanceId, providerId, operatorId }) {
    const { data: tripulacion, error: crewError } = await supabase
      .from('ambulance_crew')
      .select('profile_id, crew_role')
      .eq('ambulance_id', ambulanceId)
      .eq('active', true)
    if (crewError) throw crewError

    const medico = (tripulacion ?? []).find(t => t.crew_role === 'medico')

    const { data, error } = await supabase
      .from('emergencies')
      .update({
        ambulance_id: ambulanceId,
        provider_id: providerId,
        operator_id: operatorId,
        professional_id: medico?.profile_id ?? null,
        status: 'dispatched',
        dispatched_at: new Date().toISOString(),
        dispatch_code: `UTM-${Math.floor(1000 + Math.random() * 9000)}`,
      })
      .eq('id', emergencyId)
      .select('*, patient:profiles!patient_id(full_name, phone)')
      .single()
    if (error) throw error

    // El móvil pasa a ocupado. Si esto falla, el despacho queda hecho igual y
    // el operador ve el estado viejo en el mapa — se avisa, no se revierte un
    // despacho por no poder pintar un badge.
    const { error: ambError } = await supabase
      .from('ambulances')
      .update({ status: 'en_servicio' })
      .eq('id', ambulanceId)
    if (ambError) console.error('asignarAmbulancia: no se pudo marcar el móvil en servicio', ambError.message)

    return toCamelCase(data)
  },

  /** El móvil vuelve a estar disponible cuando el traslado termina. */
  async liberarAmbulancia(ambulanceId) {
    if (!ambulanceId) return
    const { error } = await supabase
      .from('ambulances')
      .update({ status: 'disponible' })
      .eq('id', ambulanceId)
    if (error) throw error
  },

  /** Patient cancels their own emergency (RLS: emergency_patient_cancel). */
  async cancel(emergencyId) {
    const { error } = await supabase
      .from('emergencies')
      .update({ status: 'cancelled' })
      .eq('id', emergencyId)
    if (error) throw error
  },

  /**
   * Subscribe to updates on a single emergency (patient side — status
   * changes as the professional accepts / arrives / completes).
   * Returns an unsubscribe function.
   */
  subscribeForPatient(emergencyId, onChange) {
    const channel = supabase
      .channel(`patient-emergency-${emergencyId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'emergencies', filter: `id=eq.${emergencyId}` },
        (payload) => onChange(toCamelCase(payload.new))
      )
      .subscribe()

    return () => supabase.removeChannel(channel)
  },

  // ── Super admin ─────────────────────────────────────────────────────

  /** All emergencies, newest first, with patient/professional info — /super-admin/emergencias. */
  async listAllForAdmin() {
    const { data, error } = await supabase
      .from('emergencies')
      .select(`
        *,
        patient:profiles!patient_id(full_name, phone),
        professional:profiles!professional_id(full_name),
        operador:profiles!operator_id(full_name),
        ambulancia:ambulances!ambulance_id(id, label, plate, unit_type),
        entidad:emergency_providers!provider_id(id, name, color)
      `)
      .order('created_at', { ascending: false })
    if (error) throw error
    return (data ?? []).map(toCamelCase)
  },

  /** Borra una o más emergencias — super admin. */
  async deleteMany(ids) {
    const { error } = await supabase.from('emergencies').delete().in('id', ids)
    if (error) throw new Error(error.message || 'Error al eliminar')
  },
}
