/**
 * paymentsService.js — reads/writes against the `payments` and
 * `platform_settings` tables introduced by the Mercado Pago split-payments
 * migration (spec Sección B3/B2). `payments` is the transactional source of
 * truth for money movement — consultations.payment_status is a denormalized
 * summary, this is where the real numbers (fees, net, refunds) live.
 *
 * Writes to `payments` itself only ever happen server-side (Edge Functions
 * with the service-role key) — this service is read-mostly, except for
 * `updatePlatformSettings` (super_admin only, enforced by RLS).
 */

import { supabase, toCamelCase, toSnakeCase } from '../lib/supabase'

export const paymentsService = {
  /**
   * Cobros de UNA consulta, para la línea de tiempo del super admin.
   * Trae los sellos de tiempo del ciclo de pre-autorización (autorizado,
   * capturado, cancelado) porque son justo lo que hace falta para entender qué
   * pasó con la plata cuando una consulta terminó mal.
   */
  async listByConsultation(consultationId) {
    const { data, error } = await supabase
      .from('payments')
      .select('id, status, status_detail, method, gross_amount, charged_amount, platform_fee, net_to_professional, authorized_at, captured_at, auth_cancelled_at, refunded_at, created_at')
      .eq('consultation_id', consultationId)
      .order('created_at', { ascending: true })
    if (error) throw error
    return (data ?? []).map(toCamelCase)
  },

  /**
   * All payments — admin/super_admin view (super-admin/Payments.jsx).
   * @param {Object} filters
   * @param {string} [filters.dateFrom] - ISO date, inclusive
   * @param {string} [filters.dateTo]   - ISO date, inclusive
   * @param {string} [filters.status]   - pending|authorized|approved|rejected|refunded|cancelled
   * @param {string} [filters.professionalId]
   * @param {string} [filters.method]   - card|credits|mixed
   */
  async getAllPayments(filters = {}) {
    let query = supabase
      .from('payments')
      .select(`
        *,
        consultation:consultations!consultation_id(id, status, scheduled_at, modality),
        patient:profiles!patient_id(full_name, email),
        professional:profiles!professional_id(full_name, email)
      `)
      .order('created_at', { ascending: false })

    if (filters.dateFrom) query = query.gte('created_at', filters.dateFrom)
    if (filters.dateTo) query = query.lte('created_at', filters.dateTo)
    if (filters.status) query = query.eq('status', filters.status)
    if (filters.professionalId) query = query.eq('professional_id', filters.professionalId)
    if (filters.method) query = query.eq('method', filters.method)

    const { data, error } = await query
    if (error) throw error
    return toCamelCase(data)
  },

  /**
   * Payments with a pending refund request (cancellation → Healthy Credits),
   * awaiting manual super_admin review — refunds are NEVER automatic
   * (product rule, 2026-07-24). See mp-refund action=cancel-refund / approve-refund / reject-refund.
   */
  async getPendingRefundRequests() {
    const { data, error } = await supabase
      .from('payments')
      .select(`
        *,
        consultation:consultations!consultation_id(id, scheduled_at),
        patient:profiles!patient_id(full_name, email),
        professional:profiles!professional_id(full_name, email)
      `)
      .eq('refund_request_status', 'pending')
      .order('refund_requested_at', { ascending: true })
    if (error) throw error
    return toCamelCase(data)
  },

  /** Payments with a pending "credits → MP refund" conversion request. */
  async getPendingConversionRequests() {
    const { data, error } = await supabase
      .from('payments')
      .select(`
        *,
        consultation:consultations!consultation_id(id, scheduled_at),
        patient:profiles!patient_id(full_name, email)
      `)
      .not('refund_conversion_requested_at', 'is', null)
      .is('refund_conversion_resolved_at', null)
      .order('refund_conversion_requested_at', { ascending: true })
    if (error) throw error
    return toCamelCase(data)
  },

  /** Current professional's own payments — used by Ganancias.jsx. */
  async getMyPayments() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return []
    const { data, error } = await supabase
      .from('payments')
      .select(`
        *,
        consultation:consultations!consultation_id(id, scheduled_at, completed_at, modality, consultation_type:consultation_types!consultation_type_id(name)),
        patient:profiles!patient_id(full_name, avatar_url)
      `)
      .eq('professional_id', user.id)
      .order('created_at', { ascending: false })
    if (error) throw error
    return toCamelCase(data)
  },

  /** Single-row platform settings (commission, MP fee estimate, refund window, duración de turno). */
  async getPlatformSettings() {
    const { data, error } = await supabase
      .from('platform_settings')
      .select('*')
      .eq('id', 1)
      .maybeSingle()
    if (error) throw error
    return toCamelCase(data) ?? {
      commissionRate: 0.20,
      mpFeeEstimateRate: 0.0629,
      refundWindowBusinessHours: 48,
      slotDurationMinutes: 15,
    }
  },

  /** super_admin only — enforced by RLS (get_my_role() = 'super_admin'). */
  async updatePlatformSettings(fields) {
    const { data: { user } } = await supabase.auth.getUser()
    const { data, error } = await supabase
      .from('platform_settings')
      .update({
        ...toSnakeCase(fields),
        updated_at: new Date().toISOString(),
        updated_by: user?.id ?? null,
      })
      .eq('id', 1)
      .select()
      .single()
    if (error) throw error
    return toCamelCase(data)
  },

  /**
   * Pagos pendientes a profesionales ("cuenta corriente") — super_admin view.
   * All payments with an outstanding manual_settlement_amount (debt owed to
   * the professional for the Healthy Credits-covered portion) not yet settled.
   */
  async getPendingSettlements() {
    const { data, error } = await supabase
      .from('payments')
      .select(`
        id,
        manual_settlement_amount,
        created_at,
        settled_at,
        professional:profiles!professional_id(id, full_name, email),
        consultation:consultations!consultation_id(id, scheduled_at)
      `)
      .gt('manual_settlement_amount', 0)
      .is('settled_at', null)
      .order('created_at', { ascending: true })
    if (error) throw error
    return toCamelCase(data)
  },

  /** super_admin only — enforced inside the RPC (get_my_role() = 'super_admin'). */
  async markSettlementPaid(paymentId) {
    const { data, error } = await supabase.rpc('mark_settlement_paid', { p_payment: paymentId })
    return { data, error }
  },

  /**
   * Current professional's own settlement ("cuenta corriente") balance —
   * used by Ganancias.jsx. Professional can already SELECT their own
   * payments per RLS, so this reads directly instead of needing an RPC.
   */
  async getMySettlementBalance() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { pending: 0, settled: 0 }
    const { data, error } = await supabase
      .from('payments')
      .select('manual_settlement_amount, settled_at')
      .eq('professional_id', user.id)
      .gt('manual_settlement_amount', 0)
    if (error) throw error
    const rows = data ?? []
    return {
      pending: rows.reduce((s, r) => s + (r.settled_at ? 0 : Number(r.manual_settlement_amount || 0)), 0),
      settled: rows.reduce((s, r) => s + (r.settled_at ? Number(r.manual_settlement_amount || 0) : 0), 0),
    }
  },

  /**
   * Aggregated totals for a period — used by super-admin Dashboard + Payments.
   * @param {Object} range
   * @param {string} [range.from] - ISO date, inclusive
   * @param {string} [range.to]   - ISO date, inclusive
   */
  async getPaymentsSummary({ from, to } = {}) {
    let query = supabase
      .from('payments')
      .select('gross_amount, platform_fee, mp_fee_estimated, mp_fee_actual, net_to_professional, credits_used, charged_amount, status, created_at')
    if (from) query = query.gte('created_at', from)
    if (to) query = query.lte('created_at', to)

    const { data, error } = await query
    if (error) throw error
    const rows = data ?? []
    const approved = rows.filter(r => r.status === 'approved')

    return {
      count: rows.length,
      approvedCount: approved.length,
      grossTotal: approved.reduce((s, r) => s + Number(r.gross_amount || 0), 0),
      platformFeeTotal: approved.reduce((s, r) => s + Number(r.platform_fee || 0), 0),
      mpFeeTotal: approved.reduce((s, r) => s + Number(r.mp_fee_actual ?? r.mp_fee_estimated ?? 0), 0),
      netProfessionalTotal: approved.reduce((s, r) => s + Number(r.net_to_professional || 0), 0),
      creditsUsedTotal: approved.reduce((s, r) => s + Number(r.credits_used || 0), 0),
      byStatus: rows.reduce((acc, r) => {
        acc[r.status] = (acc[r.status] || 0) + 1
        return acc
      }, {}),
    }
  },
}
