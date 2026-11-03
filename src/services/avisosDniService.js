import { supabase } from '../lib/supabase'
import { sinPrueba } from '../lib/cuentasDePrueba'

/**
 * Avisos de "completó su DNI" para el super admin (migración 225): un
 * profesional verificado completó un DNI que tenía vacío y se chequeó contra
 * SISA. La tabla la escriben la base y la Edge Function `dni-completado`; acá
 * sólo se lee y se marca como visto (RPC, la RLS no deja escribir).
 */
export const avisosDniService = {
  async listarSinVer({ incluirPrueba = true } = {}) {
    const { data, error } = await sinPrueba(supabase
      .from('dni_completado_chequeos')
      .select('id, created_at, resultado, detalle, professional_profile_id, profile:profiles!user_id(full_name, email)')
      .is('visto_at', null)
      .order('created_at', { ascending: false })
      .limit(50), incluirPrueba)
    if (error) throw error
    return data ?? []
  },

  async marcarVisto(id) {
    const { error } = await supabase.rpc('marcar_aviso_dni_visto', { p_id: id })
    if (error) throw error
  },
}

export const ETIQUETA_SISA = {
  pendiente: 'chequeando con SISA…',
  coincide: 'SISA coincide',
  no_coincide: 'SISA no coincide',
  sin_respuesta: 'SISA sin respuesta',
}
