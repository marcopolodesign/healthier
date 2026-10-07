import { supabase } from '../lib/supabase'
import { bajaService } from './bajaService'

export const adminService = {
  async promoteUser(email, role = 'admin') {
    const { error } = await supabase.rpc('promote_user_to_admin', {
      target_email: email,
      new_role: role,
    })
    if (error) throw new Error(error.message || 'Error al cambiar el rol del usuario')
  },

  /** "Eliminar" del super admin: es una baja lógica (migración 188), nunca un
   *  DELETE. El perfil y su historia clínica se conservan (Ley 26.529), el mail
   *  pasa a un alias y se libera, y la persona queda sin acceso hasta que
   *  recupere la cuenta. Si alguno falla, tira con el error real de cada uno. */
  async deleteProfiles(ids) {
    const resultados = await bajaService.darDeBaja(ids)
    const fallidos = resultados.filter(r => !r.ok)
    if (fallidos.length) {
      const detalle = fallidos.map(f => f.error).join(' · ')
      const hechos = resultados.length - fallidos.length
      throw new Error(hechos ? `Se dieron de baja ${hechos}, fallaron ${fallidos.length}: ${detalle}` : detalle)
    }
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
