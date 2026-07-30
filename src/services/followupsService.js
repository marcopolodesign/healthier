import { supabase, toCamelCase, toSnakeCase } from '../lib/supabase'

export const followupsService = {
  async getByPatient(professionalId, patientId) {
    const { data, error } = await supabase
      .from('patient_followups')
      .select('*, recommendedProfessional:profiles!recommended_professional_id(full_name), consultation:consultations!consultation_id(id, scheduled_at, status, modality)')
      .eq('professional_id', professionalId)
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false })
    if (error) throw error
    return toCamelCase(data)
  },

  async create({ professionalId, patientId, followUpDate, note, recommendedProfessionalId, consultationId }) {
    const payload = toSnakeCase({
      professionalId,
      patientId,
      followUpDate: followUpDate || null,
      note: note || null,
      recommendedProfessionalId: recommendedProfessionalId || null,
      // El turno que se agendó a partir de este seguimiento (migración 077).
      consultationId: consultationId || null,
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
