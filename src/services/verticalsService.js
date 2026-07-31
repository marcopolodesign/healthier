import { supabase, toCamelCase } from '../lib/supabase'

/**
 * Configuración operativa de las verticales (migración 078).
 *
 * Sólo dos cosas viven en la base: si la vertical está habilitada y cuánto sale
 * su consulta inmediata. La identidad visual (nombre, ícono, colores, imagen)
 * se queda en `src/lib/verticals.js` — ver el comentario de la migración para el
 * porqué de esa división.
 */
export const verticalsService = {
  /** Config de todas las verticales, ordenada. Lectura pública por RLS. */
  async getAll() {
    const { data, error } = await supabase
      .from('vertical_settings')
      .select('id, enabled, ondemand_price, sort_order')
      .order('sort_order', { ascending: true })
    if (error) throw error
    return (data ?? []).map(toCamelCase)
  },

  /**
   * Habilitar/deshabilitar y fijar precio. super_admin únicamente — lo impone la
   * RLS, no este método.
   */
  async update(id, { enabled, ondemandPrice }) {
    const { data: { user } } = await supabase.auth.getUser()

    const patch = { updated_at: new Date().toISOString(), updated_by: user?.id ?? null }
    if (enabled !== undefined) patch.enabled = enabled
    // `null` es un valor válido a propósito: es "sin precio definido", distinto
    // de "no lo toques" (undefined).
    if (ondemandPrice !== undefined) {
      patch.ondemand_price = ondemandPrice === null || ondemandPrice === '' ? null : Number(ondemandPrice)
    }

    const { data, error } = await supabase
      .from('vertical_settings')
      .update(patch)
      .eq('id', id)
      .select('id, enabled, ondemand_price, sort_order')
      .single()
    if (error) throw error
    return toCamelCase(data)
  },
}
