import { supabase } from '../lib/supabase'

export const adminService = {
  async promoteUser(email, role = 'admin') {
    const { error } = await supabase.rpc('promote_user_to_admin', {
      target_email: email,
      new_role: role,
    })
    if (error) throw new Error(error.message || 'Error al cambiar el rol del usuario')
  },
}
