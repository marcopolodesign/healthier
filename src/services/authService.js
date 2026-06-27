import { supabase, toCamelCase } from '../lib/supabase'

export const authService = {
  async register(email, password, role, fullName, utms = {}) {
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName, role },
      },
    })
    if (authError) throw new Error(authError.message)

    // Create profile row — include UTM attribution if captured from landing page
    const { error: profileError } = await supabase.from('profiles').insert({
      id: authData.user.id,
      email,
      full_name: fullName,
      role,
      utm_source:   utms.utm_source   ?? null,
      utm_medium:   utms.utm_medium   ?? null,
      utm_campaign: utms.utm_campaign ?? null,
      utm_id:       utms.utm_id       ?? null,
      utm_content:  utms.utm_content  ?? null,
      referrer_url: utms.referrer_url ?? null,
    })
    if (profileError) throw new Error(profileError.message)

    return { user: authData.user, session: authData.session }
  },

  async login(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      if (error.message.includes('Invalid login credentials')) {
        throw new Error('Credenciales inválidas. Verificá tu email y contraseña.')
      }
      throw new Error(error.message)
    }

    const profile = await this.getCurrentUserProfile(data.user.id)
    if (profile) localStorage.setItem('userProfile', JSON.stringify(profile))
    return { user: data.user, session: data.session, profile }
  },

  async logout() {
    await supabase.auth.signOut()
    localStorage.removeItem('userProfile')
  },

  async getCurrentUser() {
    const { data: { user } } = await supabase.auth.getUser()
    return user
  },

  async getCurrentUserProfile(userId) {
    const uid = userId || (await this.getCurrentUser())?.id
    if (!uid) return null

    const cached = localStorage.getItem('userProfile')
    if (cached) {
      try {
        const p = JSON.parse(cached)
        if (p && p.id === uid) return p
      } catch {
        localStorage.removeItem('userProfile')
      }
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', uid)
      .single()

    if (error) return null
    const profile = toCamelCase(data)
    localStorage.setItem('userProfile', JSON.stringify(profile))
    return profile
  },

  async verifySession() {
    const { data: { session } } = await supabase.auth.getSession()
    return !!session
  },

  onAuthStateChange(callback) {
    return supabase.auth.onAuthStateChange(callback)
  },
}
