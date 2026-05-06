import { supabase, toCamelCase, toSnakeCase } from '../lib/supabase'

export const reviewsService = {
  async create(data) {
    const { data: row, error } = await supabase
      .from('reviews')
      .insert(toSnakeCase(data))
      .select()
      .single()
    if (error) throw error

    // Update average rating on professional_profiles
    await this.recalculateRating(data.professionalId)

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

  async recalculateRating(professionalId) {
    const { data } = await supabase
      .from('reviews')
      .select('rating')
      .eq('professional_id', professionalId)

    if (!data || data.length === 0) return

    const avg = data.reduce((sum, r) => sum + r.rating, 0) / data.length
    await supabase
      .from('professional_profiles')
      .update({ average_rating: Math.round(avg * 10) / 10, total_reviews: data.length })
      .eq('user_id', professionalId)
  },
}
