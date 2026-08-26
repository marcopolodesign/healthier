import { supabase, toCamelCase, toSnakeCase } from '../lib/supabase'

export const profilesService = {
  async getById(id) {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', id).single()
    if (error) throw error
    return toCamelCase(data)
  },

  async update(id, updates) {
    const { data, error } = await supabase
      .from('profiles')
      .update(toSnakeCase(updates))
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    const profile = toCamelCase(data)
    localStorage.setItem('userProfile', JSON.stringify(profile))
    return profile
  },

  async uploadAvatar(userId, file) {
    const ext = file.name.split('.').pop()
    const path = `${userId}/avatar.${ext}`
    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(path, file, { upsert: true })
    if (uploadError) throw uploadError

    const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path)
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ avatar_url: urlData.publicUrl })
      .eq('id', userId)
    if (updateError) throw updateError
    return urlData.publicUrl
  },
}
