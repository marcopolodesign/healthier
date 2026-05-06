import { supabase, toCamelCase, toSnakeCase } from '../lib/supabase'

export const availabilityService = {
  // ── availability_slots (specific booked instances) ────────────────────────

  async getByProfessional(professionalId, onlyFree = false) {
    let query = supabase
      .from('availability_slots')
      .select('*')
      .eq('professional_id', professionalId)
      .order('start_time', { ascending: true })
    if (onlyFree) query = query.eq('is_booked', false)
    const { data, error } = await query
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

  async bookSlot(id) {
    const { data, error } = await supabase
      .from('availability_slots')
      .update({ is_booked: true })
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    return toCamelCase(data)
  },

  async delete(id) {
    const { error } = await supabase.from('availability_slots').delete().eq('id', id)
    if (error) throw error
  },

  // ── professional_schedules (recurring weekly patterns) ────────────────────

  async getSchedule(professionalId) {
    const { data, error } = await supabase
      .from('professional_schedules')
      .select('*')
      .eq('professional_id', professionalId)
      .order('day_of_week', { ascending: true })
      .order('start_time', { ascending: true })
    if (error) throw error
    return toCamelCase(data)
  },

  async addScheduleEntry({ professionalId, dayOfWeek, startTime, endTime }) {
    const { data, error } = await supabase
      .from('professional_schedules')
      .insert({ professional_id: professionalId, day_of_week: dayOfWeek, start_time: startTime, end_time: endTime })
      .select()
      .single()
    if (error) throw error
    return toCamelCase(data)
  },

  async deleteScheduleEntry(id) {
    const { error } = await supabase.from('professional_schedules').delete().eq('id', id)
    if (error) throw error
  },
}
