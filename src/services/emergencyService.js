import { supabase } from '../lib/supabase'

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
// it only works if the professional already has the app open.
// WhatsApp is the reliable fallback when the app is closed.
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
    return data
  },

  /** Fetch the latest active emergency assigned to this professional */
  async getActiveForProfessional(professionalId) {
    const { data, error } = await supabase
      .from('emergencies')
      .select('*, patient:profiles!patient_id(full_name, avatar_url)')
      .eq('professional_id', professionalId)
      .in('status', ['dispatched', 'in_transit', 'arrived'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw error
    return data
  },

  /** Update emergency status */
  async updateStatus(emergencyId, status) {
    const { error } = await supabase
      .from('emergencies')
      .update({ status })
      .eq('id', emergencyId)
    if (error) throw error
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
        (payload) => onChange(payload.new)
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'emergencies', filter: `professional_id=eq.${professionalId}` },
        (payload) => onChange(payload.new)
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
    return data ?? []
  },

  async processPayment(_amount) {
    await new Promise(r => setTimeout(r, 2000))
    return { success: true, token: `EMG-${Date.now()}` }
  },

  async findUnit(_userLocation) {
    await new Promise(r => setTimeout(r, 4500))
    return { unit: 'Móvil 42', paramedic: 'Juan Pérez', etaMinutes: 4, phone: '+54 11 4567-0042' }
  },
}
