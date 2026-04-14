import { supabase, toCamelCase, toSnakeCase } from '../lib/supabase'

export const consultationsService = {
  async create(data) {
    const { data: row, error } = await supabase
      .from('consultations')
      .insert(toSnakeCase(data))
      .select()
      .single()
    if (error) throw error
    return toCamelCase(row)
  },

  async getByPatient(patientId) {
    const { data, error } = await supabase
      .from('consultations')
      .select('*, professional:profiles!professional_id(full_name, avatar_url, professional_profiles(specialty))')
      .eq('patient_id', patientId)
      .order('scheduled_at', { ascending: false })
    if (error) throw error
    return toCamelCase(data)
  },

  async getByProfessional(professionalId) {
    const { data, error } = await supabase
      .from('consultations')
      .select('*, profiles!patient_id(full_name, avatar_url, email)')
      .eq('professional_id', professionalId)
      .order('scheduled_at', { ascending: false })
    if (error) throw error
    return toCamelCase(data)
  },

  async getById(id) {
    const { data, error } = await supabase
      .from('consultations')
      .select('*, patient:profiles!patient_id(full_name, avatar_url, email), professional:profiles!professional_id(full_name, avatar_url, professional_profiles(specialty, calendly_url))')
      .eq('id', id)
      .single()
    if (error) throw error
    return toCamelCase(data)
  },

  async updateStatus(id, status, extra = {}) {
    const { data, error } = await supabase
      .from('consultations')
      .update({ status, ...toSnakeCase(extra) })
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    return toCamelCase(data)
  },

  async getAll(filters = {}) {
    let query = supabase
      .from('consultations')
      .select('*, patient:profiles!patient_id(full_name, email), professional:profiles!professional_id(full_name, professional_profiles(specialty))')
      .order('scheduled_at', { ascending: false })

    if (filters.status) query = query.eq('status', filters.status)

    const { data, error } = await query
    if (error) throw error
    return toCamelCase(data)
  },
}
