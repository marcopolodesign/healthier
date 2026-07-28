import { supabase, toCamelCase } from '../lib/supabase'

/**
 * Pedidos de consulta inmediata (migración 067).
 *
 * El pedido se crea SIN médico asignado y les suena a todos los elegibles; el
 * primero que acepta confirma el match. Ver el comentario de la migración para
 * el porqué del modelo — el resumen es que exigir presencia (pestaña abierta)
 * para aparecer disponible es un impuesto de atención inviable, y en web no se
 * puede latir con el browser cerrado.
 */

/** Ventana que tiene el pedido para ser tomado antes de vencer. */
export const REQUEST_WINDOW_SECONDS = 3 * 60

export const ondemandService = {
  /** Crea el pedido. Todavía sin médico y sin cobro. */
  async create({ patientId, vertical, specialty, price, paymentMethodId = null }) {
    const { data, error } = await supabase
      .from('ondemand_requests')
      .insert({
        patient_id: patientId,
        vertical,
        specialty,
        price_at_request: price,
        payment_method_id: paymentMethodId,
        expires_at: new Date(Date.now() + REQUEST_WINDOW_SECONDS * 1000).toISOString(),
      })
      .select()
      .single()
    if (error) throw error
    return toCamelCase(data)
  },

  /** Guarda las respuestas que el paciente contesta mientras suenan los timbres. */
  async savePreconsulta(requestId, preconsultaData) {
    const { error } = await supabase
      .from('ondemand_requests')
      .update({ preconsulta_data: preconsultaData })
      .eq('id', requestId)
    if (error) throw error
  },

  async getById(requestId) {
    const { data, error } = await supabase
      .from('ondemand_requests')
      .select('*, accepted_professional:profiles!accepted_by(full_name, avatar_url)')
      .eq('id', requestId)
      .maybeSingle()
    if (error) throw error
    return data ? toCamelCase(data) : null
  },

  async cancel(requestId) {
    const { error } = await supabase
      .from('ondemand_requests')
      .update({ status: 'cancelled' })
      .eq('id', requestId)
    if (error) throw error
  },

  /** Marca vencido lo que nadie tomó. El cliente lo hace mientras mira; el backstop es la función de barrido. */
  async expire(requestId) {
    const { error } = await supabase
      .from('ondemand_requests')
      .update({ status: 'expired' })
      .eq('id', requestId)
      .eq('status', 'pending')
    if (error) throw error
  },

  // ── Lado del profesional ──────────────────────────────────────────────────

  /**
   * Pedidos abiertos que este profesional puede tomar.
   * El filtrado real lo hace RLS (`professional_select_open_requests`): solo ve
   * los de su especialidad, vivos, y únicamente si declara on-demand, está
   * verificado/activo y tiene MP conectado. Acá no se repite esa lógica.
   */
  async listOpen() {
    const { data, error } = await supabase
      .from('ondemand_requests')
      .select('*, patient:profiles!patient_id(full_name, avatar_url)')
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: true })
    if (error) throw error
    return (data ?? []).map(toCamelCase)
  },

  /**
   * Toma el pedido. Devuelve el id de la consulta creada, o null si otro llegó
   * primero / venció. La atomicidad vive en el RPC, no acá: cualquier chequeo
   * previo desde el cliente sería una ventana de carrera.
   */
  async accept(requestId) {
    const { data, error } = await supabase.rpc('accept_ondemand_request', { p_request_id: requestId })
    if (error) throw error
    return data ?? null
  },
}
