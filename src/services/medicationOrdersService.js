/**
 * medicationOrdersService.js — lifecycle of a medication_orders row.
 *
 * The order is always created by the patient — whether they got there by
 * browsing the catalog or by tapping a match under "Recetados por tu
 * médico". There is no professional-side creation path (see RLS on
 * medication_orders, migration 106): the doctor only ever issues a receta,
 * never a purchase, on the patient's behalf.
 *
 * El carrito **es** el borrador: `addToCart` lo crea en la primera llamada,
 * antes de que el paciente vea nada de pago — mismo principio de resiliencia
 * de estado que el booking de consultas, pero ahora desde el primer "Agregar"
 * en vez de desde el checkout, así que un carrito abandonado se puede retomar
 * en lugar de perderse en silencio.
 *
 * `createDraft` (armaba el pedido entero desde el cliente) y `setItemQuantity`
 * (cambiaba un item por su id) se retiraron el 2026-09-02 al pasar el carrito
 * a la base: los dos caminos escribían precios que venían del front. La RPC
 * por item (`actualizar_item_pedido_medicamentos`, migración 137) sigue viva en
 * la base y la usan los scripts de verificación.
 */
import { supabase, toCamelCase } from '../lib/supabase'

const PHARMACY_ID = '10000000-0000-0000-0000-000000000001' // single MVP tenant

const ORDER_ITEMS_SELECT = `
  *,
  items:medication_order_items(*)
`

export const medicationOrdersService = {
  async updateDeliveryAddress(orderId, deliveryAddress) {
    const { data, error } = await supabase
      .from('medication_orders')
      .update({ delivery_address: deliveryAddress })
      .eq('id', orderId)
      // Con el join, igual que getById: devolver el pedido sin sus items es
      // justo lo que rompía el listado del checkout.
      .select(ORDER_ITEMS_SELECT)
      .single()
    if (error) throw error
    return toCamelCase(data)
  },

  /**
   * Suma (o resta, con delta negativo) un producto del catálogo en el carrito
   * del paciente. El carrito ES el borrador: esta llamada lo crea si todavía
   * no existe — ver migración 138. El nombre, la presentación y el precio se
   * leen del catálogo del lado del servidor, no se mandan desde acá.
   *
   * @returns {Promise<Object|null>} el pedido, o `null` si quedó vacío.
   */
  async addToCart(productId, delta = 1) {
    const { data: orderId, error } = await supabase.rpc('agregar_item_pedido_medicamentos', {
      p_product_id: productId,
      p_delta: delta,
    })
    if (error) throw error
    if (!orderId) return null
    return this.getById(orderId)
  },

  /**
   * Deja anotado en el carrito de qué receta salió.
   *
   * `agregar_item_pedido_medicamentos` no recibe la receta —el carrito se creó
   * pensando en el catálogo suelto—, así que se sella después. Sin esto,
   * `rcta_prescription_id` queda null y el "Ya la pediste" de la pantalla de la
   * receta **no se activaría nunca**; tampoco funcionaría el descarte de
   * `getPrescribedMatches`, que mira esa misma columna.
   *
   * Un carrito puede mezclar lo de una receta con navegación suelta: se guarda
   * la primera receta que lo originó y no se pisa, que es lo que hace falta
   * para no ofrecerle dos veces la misma receta al paciente.
   */
  async linkPrescription(orderId, prescriptionId) {
    if (!orderId || !prescriptionId) return null
    const { data, error } = await supabase
      .from('medication_orders')
      .update({ rcta_prescription_id: prescriptionId })
      .eq('id', orderId)
      .is('rcta_prescription_id', null)
      .select('id, rcta_prescription_id')
      .maybeSingle()
    if (error) throw error
    return toCamelCase(data)
  },

  async getById(orderId) {
    const { data, error } = await supabase
      .from('medication_orders')
      .select(ORDER_ITEMS_SELECT)
      .eq('id', orderId)
      .maybeSingle()
    if (error) throw error
    return toCamelCase(data)
  },

  /** Last unpaid draft for the patient — used to resume an abandoned checkout. */
  async getPendingDraft(patientId) {
    const { data, error } = await supabase
      .from('medication_orders')
      .select(ORDER_ITEMS_SELECT)
      .eq('patient_id', patientId)
      .eq('payment_status', 'no_pagado')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw error
    return toCamelCase(data)
  },

  /**
   * Pedidos ya pagados del paciente, del más nuevo al más viejo. El borrador
   * sin pagar queda afuera a propósito: ése es el carrito, no un pedido.
   */
  async getMyOrders(patientId) {
    const { data, error } = await supabase
      .from('medication_orders')
      .select(ORDER_ITEMS_SELECT)
      .eq('patient_id', patientId)
      .eq('payment_status', 'pagado')
      .order('created_at', { ascending: false })
    if (error) throw error
    return toCamelCase(data)
  },

  /**
   * Los que todavía están en curso — lo que alimenta el módulo de seguimiento
   * del Inicio. Entregado y cancelado son finales y salen de la lista.
   */
  async getActiveOrders(patientId) {
    const { data, error } = await supabase
      .from('medication_orders')
      .select(ORDER_ITEMS_SELECT)
      .eq('patient_id', patientId)
      .eq('payment_status', 'pagado')
      .in('status', ['pendiente', 'en_preparacion', 'enviado'])
      .order('created_at', { ascending: false })
    if (error) throw error
    return toCamelCase(data)
  },

  /**
   * Pharmacy back-office list — filters mirror paymentsService.getAllPayments.
   * @param {Object} filters
   * @param {string} [filters.status]
   * @param {string} [filters.paymentStatus]
   * @param {string} [filters.dateFrom]
   * @param {string} [filters.dateTo]
   */
  async listForPharmacy(filters = {}) {
    let query = supabase
      .from('medication_orders')
      .select(`
        *,
        patient:profiles!patient_id(full_name, email, phone),
        items:medication_order_items(*)
      `)
      .order('created_at', { ascending: false })

    if (filters.status) query = query.eq('status', filters.status)
    if (filters.paymentStatus) query = query.eq('payment_status', filters.paymentStatus)
    if (filters.dateFrom) query = query.gte('created_at', filters.dateFrom)
    if (filters.dateTo) query = query.lte('created_at', filters.dateTo)

    const { data, error } = await query
    if (error) throw error
    return toCamelCase(data)
  },

  async getPaymentForOrder(orderId) {
    const { data, error } = await supabase
      .from('payments')
      .select('*')
      .eq('order_id', orderId)
      .maybeSingle()
    if (error) throw error
    return toCamelCase(data)
  },

  /**
   * Cancela el pedido con un motivo. El motivo se muestra en el seguimiento
   * del paciente: un pedido que aparece cancelado y no dice por qué es peor
   * que no mostrarlo. pharmacy_admin / pharmacy_operator, por RLS.
   */
  async cancelOrder(orderId, reason) {
    const { data, error } = await supabase
      .from('medication_orders')
      .update({ status: 'cancelado', cancellation_reason: reason?.trim() || null })
      .eq('id', orderId)
      .select()
      .single()
    if (error) throw error
    return toCamelCase(data)
  },

  /** pharmacy_admin / pharmacy_operator only — enforced by RLS. */
  async updateStatus(orderId, status) {
    const { data, error } = await supabase
      .from('medication_orders')
      .update({ status })
      .eq('id', orderId)
      .select()
      .single()
    if (error) throw error
    return toCamelCase(data)
  },

  PHARMACY_ID,
}
