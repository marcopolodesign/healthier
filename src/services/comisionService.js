/**
 * comisionService.js — comisión de Healthier por profesional (migración 184).
 *
 * La tasa de cada cobro la decide el servidor (`comision_efectiva`, llamada
 * desde mp-payment): referido → 0 · tasa propia vigente → esa · si no → la
 * general. Acá sólo se lee y, desde el super admin, se carga un cambio.
 */
import { supabase, toCamelCase } from '../lib/supabase'

export const comisionService = {
  /** Lo que ve el profesional: su tasa, hasta cuándo y cuántos pacientes trajo. */
  async getMiComision() {
    const { data, error } = await supabase.rpc('mi_comision')
    if (error) throw error
    const row = Array.isArray(data) ? data[0] : data
    return row ? toCamelCase(row) : null
  },

  /** super admin — la comisión propia actual de cada profesional, por profiles.id. */
  async getComisionesDeProfesionales() {
    const { data, error } = await supabase.rpc('comisiones_de_profesionales')
    if (error) throw error
    const map = {}
    for (const row of data ?? []) map[row.professional_id] = toCamelCase(row)
    return map
  },

  /** super admin — historial completo de un profesional (append-only). */
  async getHistorial(professionalId) {
    const { data, error } = await supabase
      .from('professional_commission_changes')
      .select('id, rate, valid_until, reason, created_at, setter:profiles!set_by(full_name)')
      .eq('professional_id', professionalId)
      .order('created_at', { ascending: false })
    if (error) throw error
    return (data ?? []).map(toCamelCase)
  },

  /**
   * super admin — carga un cambio. `rate` en 0..1, o null para volver a la
   * general. `until` (Date|string|null) = sin vencimiento si es null.
   */
  async fijar(professionalId, { rate, until, reason }) {
    const { data, error } = await supabase.rpc('fijar_comision_de_profesional', {
      p_professional_id: professionalId,
      p_rate: rate,
      p_until: until ? new Date(until).toISOString() : null,
      p_reason: reason,
    })
    if (error) throw error
    return toCamelCase(data)
  },
}

/** "0%", "5%", "12,5%" */
export function formatTasa(rate) {
  const pct = Math.round(Number(rate) * 1000) / 10
  return `${pct.toLocaleString('es-AR')}%`
}

/** "31/12" — el vencimiento se muestra corto, como en el pedido. */
export function formatHasta(fecha) {
  if (!fecha) return null
  return new Date(fecha).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })
}
