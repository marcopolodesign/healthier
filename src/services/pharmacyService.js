import { supabase, toCamelCase } from '../lib/supabase'

export const pharmacyService = {
  async getAll() {
    const { data, error } = await supabase
      .from('pharmacy_products')
      .select('*')
      .order('name')
    if (error) throw error
    return toCamelCase(data)
  },

  async getFeatured() {
    const { data, error } = await supabase
      .from('pharmacy_products')
      .select('*')
      .eq('featured', true)
      .eq('in_stock', true)
      .order('name')
    if (error) throw error
    return toCamelCase(data)
  },

  // Products in the same category as the patient's most recent consultation vertical.
  async getSuggested(patientId) {
    const { data: consultations, error: consErr } = await supabase
      .from('consultations')
      .select('vertical')
      .eq('patient_id', patientId)
      .order('scheduled_at', { ascending: false })
      .limit(1)
    if (consErr) throw consErr

    const category = consultations?.[0]?.vertical
    if (!category) return []

    const { data, error } = await supabase
      .from('pharmacy_products')
      .select('*')
      .eq('category', category)
      .eq('in_stock', true)
      .order('name')
    if (error) throw error
    return toCamelCase(data)
  },

  async search(query) {
    const { data, error } = await supabase
      .from('pharmacy_products')
      .select('*')
      .ilike('name', `%${query}%`)
      .order('name')
    if (error) throw error
    return toCamelCase(data)
  },
}
