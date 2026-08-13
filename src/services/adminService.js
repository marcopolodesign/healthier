import { supabase } from '../lib/supabase'

export const adminService = {
  async promoteUser(email, role = 'admin') {
    const { error } = await supabase.rpc('promote_user_to_admin', {
      target_email: email,
      new_role: role,
    })
    if (error) throw new Error(error.message || 'Error al cambiar el rol del usuario')
  },

  /** Borra uno o más perfiles (profiles.id) — cascada a professional_profiles,
   *  consultas, etc. según las FK de la base. Falla (y hay que dejar que el
   *  error llegue al usuario) si el perfil tiene historia clínica: la Ley
   *  26.529 exige retención de 10 años y hay triggers que lo bloquean a propósito. */
  async deleteProfiles(ids) {
    const { error } = await supabase.from('profiles').delete().in('id', ids)
    if (error) throw new Error(error.message || 'Error al eliminar')
  },

  /** Devuelve un magic link que loguea como `targetUserId` — la Edge Function
   *  verifica que quien llama sea super_admin y deja registro en
   *  impersonation_log. No usa supabase.functions.invoke() a propósito: no
   *  expone el mensaje de error real del body cuando la función responde
   *  4xx/5xx (ver mpService.callEdgeFunction, mismo motivo). */
  async impersonate(targetUserId) {
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/impersonate-user`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: JSON.stringify({ targetUserId }),
    })
    const json = await res.json().catch(() => ({ error: 'invalid_response' }))
    if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
    return json.url
  },
}
