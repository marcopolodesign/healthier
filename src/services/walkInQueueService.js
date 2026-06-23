import { supabase, toCamelCase, toSnakeCase } from '../lib/supabase'

export const walkInQueueService = {
  async joinQueue({ patientId, chiefComplaint, priority = 'medium' }) {
    const { data, error } = await supabase
      .from('walk_in_queue')
      .insert({ patient_id: patientId, chief_complaint: chiefComplaint, priority })
      .select('*, patient:profiles!patient_id(full_name, avatar_url)')
      .single()
    if (error) throw error
    return toCamelCase(data)
  },

  async getActiveEntry(patientId) {
    const { data, error } = await supabase
      .from('walk_in_queue')
      .select('*, patient:profiles!patient_id(full_name, avatar_url)')
      .eq('patient_id', patientId)
      .in('status', ['waiting', 'in_progress'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw error
    return data ? toCamelCase(data) : null
  },

  async getWaitingQueue() {
    const { data, error } = await supabase
      .from('walk_in_queue')
      .select('*, patient:profiles!patient_id(full_name, avatar_url)')
      .eq('status', 'waiting')
      .order('priority', { ascending: false })
      .order('created_at', { ascending: true })
    if (error) throw error
    return (data ?? []).map(toCamelCase)
  },

  async cancel(id) {
    const { error } = await supabase
      .from('walk_in_queue')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) throw error
  },

  async claim(id, professionalId, consultationId) {
    const { error } = await supabase
      .from('walk_in_queue')
      .update({
        professional_id: professionalId,
        consultation_id: consultationId,
        status: 'in_progress',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
    if (error) throw error
  },

  async complete(id) {
    const { error } = await supabase
      .from('walk_in_queue')
      .update({ status: 'completed', updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) throw error
  },

  async getQueuePosition(entryId) {
    const { data, error } = await supabase
      .from('walk_in_queue')
      .select('id')
      .eq('status', 'waiting')
      .order('priority', { ascending: false })
      .order('created_at', { ascending: true })
    if (error) throw error
    const idx = (data ?? []).findIndex(e => e.id === entryId)
    return idx === -1 ? null : idx + 1
  },

  subscribeToEntry(entryId, callback) {
    return supabase
      .channel(`walk_in_queue:${entryId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'walk_in_queue',
        filter: `id=eq.${entryId}`,
      }, payload => callback(toCamelCase(payload.new)))
      .subscribe()
  },

  subscribeToQueue(callback) {
    return supabase
      .channel('walk_in_queue_all')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'walk_in_queue',
      }, () => callback())
      .subscribe()
  },
}
