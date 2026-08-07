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

    return toCamelCase(order)
  },

  async updateDeliveryAddress(orderId, deliveryAddress) {
    const { data, error } = await supabase
      .from('medication_orders')
      .update({ delivery_address: deliveryAddress })
      .eq('id', orderId)
      .select()
      .single()
    if (error) throw error
    return toCamelCase(data)
  },

  async getMyOrders(patientId) {
    const { data, error } = await supabase
      .from('medication_orders')
      .select(ORDER_ITEMS_SELECT)
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false })
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
