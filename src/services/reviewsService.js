import { supabase, toCamelCase, toSnakeCase } from '../lib/supabase'

export const reviewsService = {
  async create(data) {
    const { data: row, error } = await supabase
      .from('reviews')
      .insert(toSnakeCase(data))
      .select()
      .single()
    if (error) throw error
    // average_rating / total_reviews los recalcula el trigger `reviews_recalc_rating`
    // (migración 069). No lo hacemos acá: si el recálculo vive sólo en JS, cualquier
    // escritura que no pase por este servicio deja los contadores mintiendo.
    return toCamelCase(row)
  },

  async getByProfessional(professionalId) {
    const { data, error } = await supabase
      .from('reviews')
      .select('*, profiles!patient_id(full_name, avatar_url)')
      .eq('professional_id', professionalId)
      .order('created_at', { ascending: false })
    if (error) throw error
    return toCamelCase(data)
  },

  async getByPatient(patientId) {
    const { data, error } = await supabase
      .from('reviews')
      .select('*')
      .eq('patient_id', patientId)
    if (error) throw error
    const rows = toCamelCase(data)
    const map = {}
    rows.forEach(r => { if (r.consultationId) map[r.consultationId] = r })
    return map
  },

}
