import { supabase, toCamelCase } from '../lib/supabase'

export const referralService = {
  /**
   * Resuelve `/r/<codigo>` y registra la visita.
   *
   * Es una RPC y no un select porque el visitante es anónimo: la tabla de
   * visitas no tiene policy de INSERT a propósito (ver migración 115), así que
   * el contador sólo se puede tocar desde acá.
   *
   * Devuelve `null` si el código no existe — la pantalla lo trata como link
   * inválido, no como error.
   */
  async resolve(codigo, { registrarVisita = true } = {}) {
    const { data, error } = await supabase.rpc('resolver_link_de_referido', {
      p_codigo: codigo,
      p_registrar_visita: registrarVisita,
    })
    if (error) throw new Error(error.message)
    return data?.length ? toCamelCase(data[0]) : null
  },

  /** Contadores del profesional que está logueado, para su propia tarjeta. */
  async myStats() {
    const { data, error } = await supabase.rpc('mis_referidos')
    if (error) throw new Error(error.message)
    return toCamelCase(data?.[0]) ?? { visitas: 0, registros: 0, conConsulta: 0 }
  },

  /** Una fila por profesional. Sólo admin / super_admin. */
  async summary() {
    const { data, error } = await supabase.rpc('resumen_de_referidos')
    if (error) throw new Error(error.message)
    return toCamelCase(data ?? [])
  },

  /** Los pacientes que entraron por el link de un profesional. */
  async patientsOf(professionalId) {
    const { data, error } = await supabase.rpc('referidos_de_profesional', {
      p_professional_id: professionalId,
    })
    if (error) throw new Error(error.message)
    return toCamelCase(data ?? [])
  },

  /** El link tal cual se comparte. Una sola definición para toda la app. */
  buildUrl(codigo) {
    return `${window.location.origin}/r/${codigo}`
  },
}
