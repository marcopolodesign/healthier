import { supabase, toCamelCase, toSnakeCase } from '../lib/supabase'

export const historiaClinicaService = {
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
