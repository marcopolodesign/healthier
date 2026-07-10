import { supabase, toCamelCase, toSnakeCase } from '../lib/supabase'

export const followupsService = {
  async getByPatient(professionalId, patientId) {
    const { data, error } = await supabase
      .from('patient_followups')
      .select('*, recommendedProfessional:profiles!recommended_professional_id(full_name)')
      .eq('professional_id', professionalId)
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false })
    if (error) throw error
    return toCamelCase(data)
  },

  async create({ professionalId, patientId, followUpDate, note, recommendedProfessionalId }) {
    const payload = toSnakeCase({
      professionalId,
      patientId,
      followUpDate: followUpDate || null,
      note: note || null,
      recommendedProfessionalId: recommendedProfessionalId || null,
    })
    const { data, error } = await supabase
      .from('patient_followups')
      .insert(payload)
      .select()
      .single()
    if (error) throw error
    return toCamelCase(data)
  },

  async delete(id) {
    const { error } = await supabase.from('patient_followups').delete().eq('id', id)
    if (error) throw error
  },
}
