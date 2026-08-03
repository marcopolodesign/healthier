import { supabase, toCamelCase } from '../lib/supabase'

// Shared insert payload for a new `profiles` row — used both by email/password
// registration and by first-time Google sign-in completion.
function buildProfileRow(userId, email, role, fullName, utms = {}) {
  return {
    id: userId,
    email,
    full_name: fullName,
    role,
    utm_source:   utms.utm_source   ?? null,
    utm_medium:   utms.utm_medium   ?? null,
    utm_campaign: utms.utm_campaign ?? null,
    utm_id:       utms.utm_id       ?? null,
    utm_content:  utms.utm_content  ?? null,
    referrer_url: utms.referrer_url ?? null,
  }
}

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
    const { error: profileError } = await supabase
      .from('profiles')
      .insert(buildProfileRow(authData.user.id, email, role, fullName, utms))
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

  async loginWithGoogle(redirectTo) {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectTo || `${window.location.origin}/login`,
        // Sin esto, Google saltea el selector cuando hay una sola sesión
        // activa y entra directo — el usuario nunca puede elegir otra cuenta.
        queryParams: { prompt: 'select_account' },
      },
    })
    if (error) throw new Error(error.message)
  },

  async completeGoogleProfile(user, role, fullName, utms = {}) {
    const { data, error } = await supabase
      .from('profiles')
      .insert(buildProfileRow(user.id, user.email, role, fullName, utms))
      .select()
      .single()
    if (error) throw new Error(error.message)

    const profile = toCamelCase(data)
    localStorage.setItem('userProfile', JSON.stringify(profile))
    return profile
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
