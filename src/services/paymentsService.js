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
import { sinPrueba } from '../lib/cuentasDePrueba'

export const paymentsService = {
  /**
   * Pacientes que llegaron a la pantalla de pago y no pagaron después de la
   * última vez que llegaron. Sale de los hitos de `recorrido_paciente`
   * (migración 247, existe desde el 2026-11-25; sólo web — la app todavía no
   * anota hitos). Sólo lo puede leer el super admin (RLS de la 247).
   *
   *   · Se compara con `created_at` (reloj del servidor), no con `at`, que es
   *     el reloj del teléfono y puede venir adelantado.
   *   · "Pagó" = hito `pago` del mismo usuario (lo anota quien paga, también
   *     cuando la consulta es para un familiar) o una consulta suya pagada,
   *     en proceso o bonificada.
   *   · Qué pasó: le falló el cobro (`error_de_pago`), nadie lo atendió
   *     (`sin_disponibilidad`, consulta inmediata), cargó la tarjeta y no
   *     siguió (`cargo_medio_de_pago`) o no intentó pagar.
   */
  async getPagosSinConcretar({ dias = 30, incluirPrueba = false } = {}) {
    const desde = new Date(Date.now() - dias * 86400000).toISOString()
    const HITOS = ['llego_al_pago', 'cargo_medio_de_pago', 'error_de_pago', 'sin_disponibilidad', 'pago']
    const { data: hitos, error } = await supabase
      .from('recorrido_paciente')
      .select('user_id, created_at, hito')
      .in('hito', HITOS)
      .gte('created_at', desde)
      .order('created_at', { ascending: false })
      .limit(5000)
    if (error) throw error

    // Recorrido de más nuevo a más viejo: se corta en el último llego_al_pago
    // y se juntan sólo los hitos posteriores a él.
    const porPaciente = new Map()
    for (const h of hitos ?? []) {
      const p = porPaciente.get(h.user_id) ?? { pacienteId: h.user_id, llegoAt: null, veces: 0, despues: new Set() }
      if (h.hito === 'llego_al_pago') {
        p.veces += 1
        if (!p.llegoAt) p.llegoAt = h.created_at
      } else if (!p.llegoAt) {
        p.despues.add(h.hito)
      }
      porPaciente.set(h.user_id, p)
    }
    const candidatos = [...porPaciente.values()].filter((p) => p.llegoAt && !p.despues.has('pago'))
    if (!candidatos.length) return []

    const ids = candidatos.map((p) => p.pacienteId)
    const perfiles = []
    const pagadas = []
    for (let k = 0; k < ids.length; k += 100) {
      const lote = ids.slice(k, k + 100)
      const [{ data: pf, error: e1 }, { data: cs, error: e2 }] = await Promise.all([
        supabase.from('profiles').select('id, full_name, email, phone, es_prueba').in('id', lote),
        supabase.from('consultations').select('patient_id, created_at')
          .in('patient_id', lote).in('payment_status', ['paid', 'in_process', 'exempt']).gte('created_at', desde),
      ])
      if (e1) throw e1
      if (e2) throw e2
      perfiles.push(...(pf ?? []))
      pagadas.push(...(cs ?? []))
    }

    const perfilDe = new Map(perfiles.map((r) => [r.id, r]))
    return candidatos
      .filter((p) => !pagadas.some((c) => c.patient_id === p.pacienteId && c.created_at >= p.llegoAt))
      .map((p) => {
        const perfil = perfilDe.get(p.pacienteId) ?? {}
        const quePaso = p.despues.has('error_de_pago') ? 'fallo'
          : p.despues.has('sin_disponibilidad') ? 'sin_profesional'
          : p.despues.has('cargo_medio_de_pago') ? 'cargo_tarjeta'
          : 'no_intento'
        return {
          pacienteId: p.pacienteId,
          llegoAt: p.llegoAt,
          veces: p.veces,
          quePaso,
          nombre: perfil.full_name ?? null,
          email: perfil.email ?? null,
          telefono: perfil.phone ?? null,
          esPrueba: !!perfil.es_prueba,
        }
      })
      .filter((p) => incluirPrueba || !p.esPrueba)
  },

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
   *
   * Ojo: el `*` es de `payments`. El embed de `consultations` lista columnas a
   * mano, así que todo dato de la consulta que quiera verse en el panel hay que
   * agregarlo ahí explícitamente — es el caso de la factura del profesional
   * (migración 119), que se muestra como columna en super-admin/Payments.jsx.
   */
  async getAllPayments(filters = {}) {
    let query = supabase
      .from('payments')
      .select(`
        *,
        consultation:consultations!consultation_id(id, status, scheduled_at, modality, invoice_url, invoice_uploaded_at),
        patient:profiles!patient_id(full_name, email),
        professional:profiles!professional_id(full_name, email)
      `)
      .order('created_at', { ascending: false })

    if (filters.dateFrom) query = query.gte('created_at', filters.dateFrom)
    if (filters.dateTo) query = query.lte('created_at', filters.dateTo)
    if (filters.status) query = query.eq('status', filters.status)
    if (filters.professionalId) query = query.eq('professional_id', filters.professionalId)
    if (filters.method) query = query.eq('method', filters.method)
    // Super admin: sin cuentas de prueba salvo que se pidan (migración 229).
    if (filters.incluirPrueba === false) query = sinPrueba(query)

    const { data, error } = await query
    if (error) throw error
    return toCamelCase(data)
  },

  /**
   * Payments with a pending refund request (cancellation → Healthy Credits),
   * awaiting manual super_admin review — refunds are NEVER automatic
   * (product rule, 2026-07-24). See mp-refund action=cancel-refund / approve-refund / reject-refund.
   */
  async getPendingRefundRequests({ incluirPrueba = true } = {}) {
    const { data, error } = await sinPrueba(supabase
      .from('payments')
      .select(`
        *,
        consultation:consultations!consultation_id(id, scheduled_at),
        patient:profiles!patient_id(full_name, email),
        professional:profiles!professional_id(full_name, email)
      `)
      .eq('refund_request_status', 'pending')
      .order('refund_requested_at', { ascending: true }), incluirPrueba)
    if (error) throw error
    return toCamelCase(data)
  },

  /** Payments with a pending "credits → MP refund" conversion request. */
  async getPendingConversionRequests({ incluirPrueba = true } = {}) {
    const { data, error } = await sinPrueba(supabase
      .from('payments')
      .select(`
        *,
        consultation:consultations!consultation_id(id, scheduled_at),
        patient:profiles!patient_id(full_name, email)
      `)
      .not('refund_conversion_requested_at', 'is', null)
      .is('refund_conversion_resolved_at', null)
      .order('refund_conversion_requested_at', { ascending: true }), incluirPrueba)
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
  async getPendingSettlements({ incluirPrueba = true } = {}) {
    const { data, error } = await sinPrueba(supabase
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
      .order('created_at', { ascending: true }), incluirPrueba)
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
  async getPaymentsSummary({ from, to, incluirPrueba = true } = {}) {
    let query = supabase
      .from('payments')
      .select('gross_amount, platform_fee, mp_fee_estimated, mp_fee_actual, net_to_professional, credits_used, charged_amount, status, created_at')
    if (from) query = query.gte('created_at', from)
    if (to) query = query.lte('created_at', to)
    query = sinPrueba(query, incluirPrueba)

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

  /**
   * Cuántos días tarda Mercado Pago en liberar la plata de un profesional
   * (pedido del CEO — B3). Se calcula, no se inventa: `mp_money_release_date`
   * es la fecha que informa MP y ya se guarda desde la 074; acá sólo se resta
   * contra el momento en que el cobro se capturó (`captured_at`, o
   * `authorized_at`/`created_at` si faltara) para expresarlo en días.
   *
   * Sólo entran pagos aprobados con `mp_money_release_date` cargado — un pago
   * rechazado o pendiente no tiene plazo de liberación que mostrar.
   *
   * @param {string} professionalId - profiles.id (NO professional_profiles.id)
   * @returns {{ data: { count: number, lastDays: number|null, minDays: number|null, maxDays: number|null } | null, error: string|null }}
   */
  async getSettlementPlazo(professionalId) {
    if (!professionalId) return { data: { count: 0, lastDays: null, minDays: null, maxDays: null }, error: null }
    try {
      const { data, error } = await supabase
        .from('payments')
        .select('mp_money_release_date, captured_at, authorized_at, created_at')
        .eq('professional_id', professionalId)
        .eq('status', 'approved')
        .not('mp_money_release_date', 'is', null)
        .order('created_at', { ascending: false })

      if (error) return { data: null, error: error.message }

      const dias = (data ?? []).map(r => {
        const base = new Date(r.captured_at ?? r.authorized_at ?? r.created_at)
        const release = new Date(r.mp_money_release_date)
        return Math.round((release - base) / 86400000)
      }).filter(n => Number.isFinite(n) && n >= 0)

      if (dias.length === 0) return { data: { count: 0, lastDays: null, minDays: null, maxDays: null }, error: null }

      return {
        data: {
          count: dias.length,
          lastDays: dias[0], // el más reciente — el plazo vigente hoy
          minDays: Math.min(...dias),
          maxDays: Math.max(...dias),
        },
        error: null,
      }
    } catch (err) {
      return { data: null, error: err.message }
    }
  },

  /** Borra uno o más pagos — super admin. */
  async deleteMany(ids) {
    const { error } = await supabase.from('payments').delete().in('id', ids)
    if (error) throw new Error(error.message || 'Error al eliminar')
  },
}
