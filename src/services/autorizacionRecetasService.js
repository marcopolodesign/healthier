/**
 * Recetas "Pendiente de autorización" de la obra social (migración 223).
 *
 * La API de recetas no deja volver a consultar el estado, así que por ahora la
 * autoriza la farmacia de Healthier (decisión de Mateo, 2026-11-02). Las dos
 * RPC verifican el rol en la base: el front sólo muestra.
 */
import { supabase, toCamelCase } from '../lib/supabase'

export const autorizacionRecetasService = {
  /** Pendientes; con `incluirAutorizadas`, también las autorizadas de los últimos 90 días. */
  async listar({ incluirAutorizadas = false } = {}) {
    const { data, error } = await supabase.rpc('farmacia_recetas_por_autorizar', { p_incluir_autorizadas: incluirAutorizadas })
    if (error) throw error
    return toCamelCase(data ?? [])
  },

  /** Pasa la receta (todas sus filas) a autorizada. Devuelve cuántas filas cambió. */
  async autorizar(medicationId) {
    const { data, error } = await supabase.rpc('farmacia_autorizar_receta', { p_medication_id: medicationId })
    if (error) throw error
    return data
  },
}
