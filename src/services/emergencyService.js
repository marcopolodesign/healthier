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

// Mismo pool que usa mobile hoy (EmergencyService.ts findOnCallDoctor):
// especialidad clínica general, on-demand, verificado y activo. Pre-MVP el
// pool es de UN solo profesional — no hay zonas, olas de despacho ni scoring
// de reputación (ver "Estadio del producto" en el CLAUDE.md raíz). Dispatch =
// elegir UNO al azar entre los elegibles. Sin cola, sin reintento: si no hay
// nadie elegible, no se inserta la fila — se avisa al paciente.
const ELIGIBLE_SPECIALTY = 'medicina_general'

// Shared across professional + patient queries and their consumers
// (professional/Dashboard.jsx, professional/Emergencias.jsx) so the set of
// "still active" / "already resolved" statuses lives in one place.
export const EMERGENCY_ACTIVE_STATUSES = ['dispatched', 'in_transit', 'arrived']
export const EMERGENCY_TERMINAL_STATUSES = ['cancelled', 'completed']

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
      .select('*, professional:profiles!professional_id(full_name, phone, avatar_url)')
      .eq('patient_id', patientId)
      .in('status', EMERGENCY_ACTIVE_STATUSES)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw error
    return data ? toCamelCase(data) : null
  },

  /**
   * Create a real SOS dispatch. Pre-MVP dispatch model: pick ONE eligible
   * professional AT RANDOM (random rotation, not rating-ordered) — no queue,
   * no retry. If nobody is eligible, do NOT insert a row; return a signal so
   * the UI can tell the patient nobody is available right now.
   *
   * Writes to the DB before any UI confirmation — this is the flow-critical
   * record for the state-resilience rule (network drop / refresh mid-SOS
   * must be resumable via getActiveForPatient()).
   */
  async create({ patientId, triageCode, symptoms, latitude, longitude, priceAtRequest, paymentMethodId }) {
    const { data: eligible, error: eligibleError } = await supabase
      .from('professional_profiles')
      .select('user_id')
      .eq('specialty', ELIGIBLE_SPECIALTY)
      .eq('is_on_demand', true)
      .eq('is_verified', true)
      .eq('is_active', true)
    if (eligibleError) throw eligibleError

    if (!eligible || eligible.length === 0) {
      return { noProfessional: true }
    }

    const chosen = eligible[Math.floor(Math.random() * eligible.length)]
    const dispatchCode = `UTM-${Math.floor(1000 + Math.random() * 9000)}`

    const { data, error } = await supabase
      .from('emergencies')
      .insert({
        patient_id: patientId,
        professional_id: chosen.user_id,
        triage_code: triageCode,
        status: 'dispatched',
        dispatch_code: dispatchCode,
        notes: symptoms?.length ? JSON.stringify(symptoms) : null,
        patient_latitude: latitude ?? null,
        patient_longitude: longitude ?? null,
        price_at_request: priceAtRequest ?? null,
        payment_method_id: paymentMethodId ?? null,
      })
      .select('*, professional:profiles!professional_id(full_name, phone, avatar_url)')
      .single()
    if (error) throw error

    const result = toCamelCase(data)

    // Fire-and-forget — never let a push failure break the SOS dispatch.
    supabase.functions.invoke('send-push-notification', {
      body: {
        userId: chosen.user_id,
        title: '🚨 EMERGENCIA SOS',
        body:  `Nueva emergencia asignada — Código ${triageCode} (${dispatchCode}). Abrí la app para aceptar.`,
        url:   '/profesional/emergencias',
      },
    }).catch(() => {})

    return result
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
      .select('*, patient:profiles!patient_id(full_name, phone), professional:profiles!professional_id(full_name)')
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
