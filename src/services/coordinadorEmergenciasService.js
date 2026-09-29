import { supabase, toCamelCase } from '../lib/supabase'

// El coordinador de ambulancias (migración 179): a esa persona le llega un
// push por cada pedido nuevo y asigna ambulancia y médico desde la app. Puede
// ser cualquier usuario — no se le cambia el rol. Lo elige el super admin.
export const coordinadorEmergenciasService = {
  /** El coordinador actual `{ profileId, fullName, email, provider }`, o `null`. */
  async getActual() {
    const { data, error } = await supabase.rpc('coordinador_emergencias')
    if (error) throw new Error(error.message)
    return data ? toCamelCase(data) : null
  },

  /** Lo define y devuelve el nuevo coordinador. El error de la base sube tal cual. */
  async definir(profileId) {
    const { data, error } = await supabase.rpc('definir_coordinador_emergencias', { p_profile_id: profileId })
    if (error) throw new Error(error.message)
    return data ? toCamelCase(data) : null
  },

  /** Busca usuarios de cualquier rol por nombre o mail (el super admin lee todos los perfiles). */
  async buscarUsuarios(texto) {
    const q = texto.trim().replace(/[,()%*]/g, ' ').trim()
    if (q.length < 2) return []
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, email, role')
      .is('deleted_at', null)
      .or(`full_name.ilike.%${q}%,email.ilike.%${q}%`)
      .order('full_name')
      .limit(8)
    if (error) throw new Error(error.message)
    return toCamelCase(data || [])
  },
}
