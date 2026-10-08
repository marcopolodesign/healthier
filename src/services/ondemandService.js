import { supabase, toCamelCase } from '../lib/supabase'
import { callEdgeFunction } from '../lib/edgeFunction'

/**
 * Teleclínica por despacho (migración 191).
 *
 * El paciente paga primero (deja el token de la tarjeta), el pedido les suena a
 * todos los elegibles y el primero que acepta se lo queda. La reserva en la
 * tarjeta se crea recién ahí, contra la cuenta de Mercado Pago de quien aceptó.
 *
 * Todas las escrituras pasan por la Edge Function `ondemand-despacho`: la tabla
 * no deja que ningún cliente inserte ni actualice filas (la 067 dejaba al
 * paciente marcarse `accepted` solo).
 */

/** Techo de "seguir buscando" desde que se pidió — igual que en el servidor. */
export const BUSQUEDA_MAX_MS = 20 * 60 * 1000

const despacho = (body) => callEdgeFunction('ondemand-despacho', body)

export const ondemandService = {
  /** @returns {Promise<{ requestId?: string, expiresAt?: string, sinProfesionales?: boolean }>} */
  pedir({ vertical, paraId = null, pago = null }) {
    return despacho({ action: 'pedir', vertical, paraId, pago })
  },

  cancelar(requestId) {
    return despacho({ action: 'cancelar', requestId })
  },

  extender(requestId) {
    return despacho({ action: 'extender', requestId })
  },

  /** @returns {Promise<{ tomada: boolean, consultationId?: string, pago?: 'autorizado'|'rechazado'|'sin_pago', detalle?: string }>} */
  aceptar(requestId) {
    return despacho({ action: 'aceptar', requestId })
  },

  async getPedido(requestId) {
    const { data, error } = await supabase
      .from('ondemand_requests')
      .select('*')
      .eq('id', requestId)
      .maybeSingle()
    if (error) throw error
    return data ? toCamelCase(data) : null
  },

  /**
   * El pedido vivo del paciente, para rehidratar la pantalla después de un
   * refresh: uno buscando todavía, o uno aceptado hace menos de media hora cuya
   * consulta no terminó.
   */
  async getMiPedidoVivo(patientId, vertical) {
    if (!patientId) return null
    const desde = new Date(Date.now() - 30 * 60 * 1000).toISOString()
    let q = supabase
      .from('ondemand_requests')
      .select('*, consulta:consultations!consultation_id(id, status)')
      .eq('patient_id', patientId)
      .in('status', ['pending', 'accepted'])
      .gte('created_at', desde)
      .order('created_at', { ascending: false })
      .limit(1)
    if (vertical) q = q.eq('vertical', vertical)
    const { data, error } = await q.maybeSingle()
    if (error || !data) return null
    const pedido = toCamelCase(data)
    if (pedido.status === 'pending' && new Date(pedido.expiresAt).getTime() <= Date.now()) return { ...pedido, status: 'expired' }
    if (pedido.status === 'accepted' && ['completed', 'cancelled', 'expired', 'no_show'].includes(pedido.consulta?.status)) return null
    return pedido
  },

  /** Lo que ve el profesional: pedidos vivos que puede tomar (la RLS filtra). */
  async getPedidosAbiertos() {
    const { data, error } = await supabase
      .from('ondemand_requests')
      .select('id, vertical, especialidades, created_at, expires_at, status')
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: true })
    if (error) throw error
    return (data ?? []).map(toCamelCase)
  },

  /** Para el super admin: todos los pedidos, con quién pidió y quién aceptó. */
  async getTodos({ limit = 100 } = {}) {
    const { data, error } = await supabase
      .from('ondemand_requests')
      .select('*, paciente:profiles!patient_id(full_name, email), profesional:profiles!accepted_by(full_name), consulta:consultations!consultation_id(status, payment_status)')
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) throw error
    return (data ?? []).map(toCamelCase)
  },

  /**
   * Cambios en vivo. `filtro` es un filtro de Realtime (`id=eq.<uuid>`) o null
   * para todos los que la RLS deja ver. Devuelve la función para desuscribirse.
   */
  suscribir(nombre, filtro, alCambiar) {
    const canal = supabase
      .channel(`ondemand-${nombre}-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'ondemand_requests', ...(filtro ? { filter: filtro } : {}),
      }, (payload) => alCambiar(payload.new ? toCamelCase(payload.new) : null))
      .subscribe()
    return () => { supabase.removeChannel(canal) }
  },
}
