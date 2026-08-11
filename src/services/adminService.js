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
}
