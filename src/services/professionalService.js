import { supabase, toCamelCase, toSnakeCase } from '../lib/supabase'

export const professionalService = {
  async getByUserId(userId) {
    const { data, error } = await supabase
      .from('professional_profiles')
      .select('*, profiles!user_id(*)')
      .eq('user_id', userId)
      .single()
    if (error) return null
    return toCamelCase(data)
  },

  async upsert(userId, profileData) {
    // `profiles` is a read-only join added by getByUserId()'s `select('*, profiles!user_id(*)')` —
    // callers often spread the whole record back in (e.g. Configuracion.jsx's saveTarifas/saveCuenta),
    // and sending it here 400s the whole upsert since it isn't a real column.
    const { profiles, ...rest } = profileData
    const payload = { ...toSnakeCase(rest), user_id: userId }
    const { data, error } = await supabase
      .from('professional_profiles')
      .upsert(payload, { onConflict: 'user_id' })
      .select()
      .single()
    if (error) throw error
    return toCamelCase(data)
  },

  async uploadDocument(userId, file, bucket, fileName) {
    const ext = file.name.split('.').pop()
    const path = `${userId}/${fileName}.${ext}`
    const { error } = await supabase.storage
      .from(bucket)
      .upload(path, file, { upsert: true })
    if (error) throw error
    const { data } = supabase.storage.from(bucket).getPublicUrl(path)
    return data.publicUrl
  },

  async getDashboardPool() {
    const { data, error } = await supabase
      .from('professional_profiles')
      .select('*, profiles!user_id(full_name, avatar_url, email)')
      .eq('is_verified', true)
      .eq('is_active', true)
      .order('average_rating', { ascending: false })
    if (error) throw error
    return toCamelCase(data)
  },

  async search(filters = {}) {
    let query = supabase
      .from('professional_profiles')
      .select('*, profiles!user_id(full_name, avatar_url, email)')
      .eq('is_verified', true)
      .eq('is_active', true)

    if (filters.specialty) {
      query = query.eq('specialty', filters.specialty)
    }
    if (filters.onDemand) {
      query = query.eq('is_on_demand', true)
    }
    if (filters.minRating) {
      query = query.gte('average_rating', filters.minRating)
    }

    const { data, error } = await query.order('average_rating', { ascending: false })
    if (error) throw error
    return toCamelCase(data)
  },

  async getPublicProfile(professionalId) {
    const { data, error } = await supabase
      .from('professional_profiles')
      .select('*, profiles!user_id(full_name, avatar_url, email)')
      .eq('id', professionalId)
      .single()
    if (error) throw error
    return toCamelCase(data)
  },

  async setVerified(userId, isVerified, isActive = true) {
    const { error } = await supabase
      .from('professional_profiles')
      .update({ is_verified: isVerified, is_active: isActive })
      .eq('user_id', userId)
    if (error) throw error
  },

  async reject(userId, reason = '') {
    const { error } = await supabase
      .from('professional_profiles')
      .update({
        is_verified: false,
        is_active: false,
        rejection_reason: reason || null,
        rejected_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
    if (error) throw error
  },

  async getPendingVerification() {
    const { data, error } = await supabase
      .from('professional_profiles')
      .select('*, profiles!user_id(full_name, email, avatar_url)')
      .eq('is_verified', false)
      .is('rejected_at', null)
      .order('created_at', { ascending: true })
    if (error) throw error
    return toCamelCase(data)
  },
}
