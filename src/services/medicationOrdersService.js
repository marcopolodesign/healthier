/**
 * medicationOrdersService.js — lifecycle of a medication_orders row.
 *
 * The order is always created by the patient — whether they got there by
 * browsing the catalog or by tapping a match under "Recetados por tu
 * médico". There is no professional-side creation path (see RLS on
 * medication_orders, migration 106): the doctor only ever issues a receta,
 * never a purchase, on the patient's behalf.
 *
 * `createDraft` writes to the DB before payment is shown/confirmed — same
 * state-resilience principle as consultations booking — so an abandoned
 * checkout is resumable instead of silently lost.
 */
import { supabase, toCamelCase, toSnakeCase } from '../lib/supabase'

const PHARMACY_ID = '10000000-0000-0000-0000-000000000001' // single MVP tenant

const ORDER_ITEMS_SELECT = `
  *,
  items:medication_order_items(*)
`

export const medicationOrdersService = {
  /**
   * items: [{ pharmacyProductId, medicationName, presentation, quantity, unitPrice, requiresPrescription }]
   */
  async createDraft({ patientId, deliveryAddress = null, items, rctaPrescriptionId = null }) {
    if (!items?.length) throw new Error('El pedido necesita al menos un medicamento')

    const subtotal = items.reduce((s, it) => s + Number(it.unitPrice) * Number(it.quantity), 0)

    const { data: order, error: orderErr } = await supabase
      .from('medication_orders')
      .insert(toSnakeCase({
        patientId,
        pharmacyId: PHARMACY_ID,
        rctaPrescriptionId,
        deliveryAddress,
        subtotal,
        total: subtotal,
      }))
      .select()
      .single()
    if (orderErr) throw orderErr

    const { error: itemsErr } = await supabase
      .from('medication_order_items')
      .insert(items.map(it => toSnakeCase({
        orderId: order.id,
        pharmacyProductId: it.pharmacyProductId ?? null,
        medicationName: it.medicationName,
        presentation: it.presentation ?? null,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        requiresPrescription: it.requiresPrescription ?? false,
      })))
    if (itemsErr) throw itemsErr

    // Releer con el join: la fila que devuelve el insert de arriba es de ANTES
    // de que existieran los items, así que nunca los traía. El checkout hace
    // `(order.items ?? []).map(...)` y por eso mostraba el total sin un solo
    // medicamento debajo — el paciente confirmaba un pedido sin ver qué estaba
    // comprando. (Mobile ya lo tenía arreglado desde el 2026-08-27; el website
    // se quedó con el bug hasta el 2026-09-02.)
    return (await this.getById(order.id)) ?? toCamelCase(order)
  },

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
   * Cambia la cantidad de un medicamento del carrito, o lo saca (quantity 0).
   * Va por RPC porque hay que recalcular subtotal/total en la misma
   * transacción — ver migración 137. `medication_order_items` no tiene (ni
   * debe tener) policies sueltas de UPDATE/DELETE para el paciente.
   *
   * @returns {Promise<Object|null>} el pedido actualizado, o `null` si se sacó
   *   el último medicamento y el borrador se eliminó.
   */
  async setItemQuantity(itemId, quantity) {
    const { data: orderId, error } = await supabase.rpc('actualizar_item_pedido_medicamentos', {
      p_item_id: itemId,
      p_quantity: quantity,
    })
    if (error) throw error
    if (!orderId) return null
    return this.getById(orderId)
  },

  /** Saca un medicamento del carrito. Ver setItemQuantity. */
  removeItem(itemId) {
    return this.setItemQuantity(itemId, 0)
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
