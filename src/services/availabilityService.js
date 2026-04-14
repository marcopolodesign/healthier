import { supabase, toCamelCase, toSnakeCase } from '../lib/supabase'

export const availabilityService = {
  async getByProfessional(professionalId) {
    const { data, error } = await supabase
      .from('availability_slots')
      .select('*')
      .eq('professional_id', professionalId)
      .order('start_time', { ascending: true })
    if (error) throw error
    return toCamelCase(data)
  },

  async create(slot) {
    const { data, error } = await supabase
      .from('availability_slots')
      .insert(toSnakeCase(slot))
      .select()
      .single()
    if (error) throw error
    return toCamelCase(data)
  },

  async delete(id) {
    const { error } = await supabase.from('availability_slots').delete().eq('id', id)
    if (error) throw error
  },
}
