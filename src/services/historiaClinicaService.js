import { supabase, toCamelCase, toSnakeCase } from '../lib/supabase'

export const historiaClinicaService = {

  // Full patient timeline — pulls from new clinical schema (migration 033)
  // Returns encounters with their entries, conditions, allergies, and medications
  async getPatientTimeline(patientId) {
    const [encountersRes, entriesRes, conditionsRes, allergiesRes, medicationsRes] = await Promise.all([
      supabase
        .from('clinical_encounters')
        .select('*, professional:profiles!professional_id(full_name, avatar_url, professional_profiles(specialty))')
        .eq('patient_id', patientId)
        .in('status', ['in_progress', 'finished'])
        .order('created_at', { ascending: false }),
      supabase
        .from('clinical_entries')
        .select('*')
        .eq('patient_id', patientId)
        .order('sequence_number', { ascending: true }),
      supabase
        .from('clinical_conditions')
        .select('*, professional:profiles!professional_id(full_name)')
        .eq('patient_id', patientId)
        .order('created_at', { ascending: false }),
      supabase
        .from('clinical_allergies')
        .select('*, professional:profiles!professional_id(full_name)')
        .eq('patient_id', patientId)
        .eq('clinical_status', 'active')
        .order('created_at', { ascending: false }),
      supabase
        .from('clinical_medications')
        .select('*, professional:profiles!professional_id(full_name)')
        .eq('patient_id', patientId)
        .order('created_at', { ascending: false }),
    ])

    const encounters = toCamelCase(encountersRes.data || [])
    const entries    = toCamelCase(entriesRes.data || [])
    const conditions = toCamelCase(conditionsRes.data || [])
    const allergies  = toCamelCase(allergiesRes.data || [])
    const medications = toCamelCase(medicationsRes.data || [])

    // Group entries/conditions/medications by encounterId
    const byEncounter = id => ({
      entries:     entries.filter(e => e.encounterId === id),
      conditions:  conditions.filter(c => c.encounterId === id),
      medications: medications.filter(m => m.encounterId === id),
    })

    return {
      encounters: encounters.map(enc => ({ ...enc, ...byEncounter(enc.id) })),
      allergies, // patient-level, not per encounter
    }
  },

  async getPatientNotes(patientId) {
    const { data, error } = await supabase
      .from('clinical_notes')
      .select('*, professional:profiles!professional_id(full_name, avatar_url, professional_profiles(specialty))')
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false })
    if (error) throw error
    return toCamelCase(data)
  },

  async addNote({ patientId, consultationId, specialty, noteType, title, content }) {
    const { data, error } = await supabase
      .from('clinical_notes')
      .insert(toSnakeCase({ patientId, consultationId, specialty, noteType, title, content }))
      .select()
      .single()
    if (error) throw error
    return toCamelCase(data)
  },

  async updateNote(id, { title, content, noteType }) {
    const { data, error } = await supabase
      .from('clinical_notes')
      .update(toSnakeCase({ title, content, noteType }))
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    return toCamelCase(data)
  },

  async deleteNote(id) {
    const { error } = await supabase
      .from('clinical_notes')
      .delete()
      .eq('id', id)
    if (error) throw error
  },
}
