/**
 * Pedidos de receta — el lado del médico de Healthier (migraciones 254/256).
 *
 * Todo pasa por RPC que validan en la base que quien llama sea médico de
 * Healthier (`professional_profiles.medico_healthier`, sólo lo marca el super
 * admin). El cobro y la liberación de la reserva los hace `mp-capture`, que
 * vuelve a validar del lado del servidor.
 */
import { supabase, toCamelCase } from '../lib/supabase'
import { mpService } from './mpService'

export const pedidosDeRecetaService = {
  /** Lo vivo: nuevos (nadie los tomó) y los que tomé yo. */
  async listar() {
    const { data, error } = await supabase.rpc('medico_pedidos_de_receta')
    if (error) throw error
    return toCamelCase(data ?? [])
  },

  /** Lo que resolví hoy (cobrado o no recetado). */
  async resueltosHoy() {
    const { data, error } = await supabase.rpc('medico_pedidos_de_receta_hoy')
    if (error) throw error
    return toCamelCase(data ?? [])
  },

  /** El primero que lo toma se lo queda. Devuelve el id de la consulta creada. */
  async tomar(orderId) {
    const { data, error } = await supabase.rpc('medico_tomar_pedido_de_receta', { p_order: orderId })
    if (error) throw error
    return data
  },

  /** No corresponde recetar: el pedido se cancela y se libera la reserva. */
  async rechazar(orderId, motivo) {
    const { error } = await supabase.rpc('medico_rechazar_pedido_de_receta', { p_order: orderId, p_motivo: motivo })
    if (error) throw error
  },

  /** Receta lista: cobra la reserva y el pedido pasa a la farmacia. */
  async cobrar(orderId) {
    const { data, error } = await mpService.capturarPedidoFarmacia(orderId)
    if (error) throw new Error(error)
    return data
  },

  /** El pedido de receta asociado a una consulta (si la consulta salió de uno). */
  async deConsulta(consultationId) {
    const lista = await this.listar()
    return lista.find(p => p.consultaId === consultationId) ?? null
  },
}
