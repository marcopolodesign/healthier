/**
 * mp-payment — Charge a consultation (MP split payment + Healthy Credits)
 *
 * POST body: {
 *   consultationId: string,
 *   cardToken?: string,        // single-use MP card token — required if chargedAmount > 0
 *   paymentMethodId?: string,  // MP brand id ('visa' | 'master' | ...) — required with cardToken
 *   payerEmail?: string,       // required with cardToken
 *   savedCardId?: string,      // payment_methods.id — informational only, not persisted
 *   useCredits?: boolean,
 *   description?: string,
 *   authorizeOnly?: boolean,   // on-demand pre-authorization (SECCIÓN C1, 2026-07-27) —
 *                              // capture:false, credit-card only, no Healthy Credits.
 * }
 *
 * The server derives amount, professional, fees — NEVER trusts amount/professionalId
 * from the client. See SECCIÓN C2 of the MP split-payments spec.
 *
 * On-demand pre-authorization (authorizeOnly=true): reserves the amount on the
 * patient's credit card (MP `capture: false`) instead of charging it immediately.
 * `binary_mode` is intentionally omitted — it is incompatible with two-step
 * authorization. The reservation is later captured (mp-capture action=capture)
 * when the consultation completes, or released (mp-capture action=cancel-auth)
 * on abandonment/timeout — see SECCIÓN C2.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { ensureFreshMpToken, PAYMENT_REFRESH_MARGIN_MS } from '../_shared/mpRefresh.ts'

const MP_API_BASE = 'https://api.mercadopago.com/v1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface PaymentBody {
  consultationId: string
  cardToken?: string
  paymentMethodId?: string
  payerEmail?: string
  savedCardId?: string
  useCredits?: boolean
  description?: string
  authorizeOnly?: boolean
}

interface PlatformSettings {
  commission_rate: number
  mp_fee_estimate_rate: number
}

interface MpAccountRow {
  professional_id: string
  mp_user_id: string
  access_token: string
  refresh_token: string | null
  expires_at: string | null
  active: boolean
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Pagar un turno agendado es lo que lo confirma.
 *
 * `consultations.status` y `consultations.payment_status` son columnas
 * distintas y hasta acá el pago sólo movía la segunda: el turno se cobraba bien
 * y le seguía apareciendo "Pendiente" al profesional, porque el badge de la
 * agenda lee `status`. Confirmar quedaba como un click manual que nadie sabía
 * que hacía falta.
 *
 * Sólo se toca cuando está en `pending`, que es el estado con el que nace un
 * turno pago en PaymentPage. Un turno ya `in_progress` / `completed` /
 * `cancelled` no se pisa — el webhook de MP puede llegar tarde o repetido, y en
 * on-demand la fila nace `confirmed` mucho antes del cobro.
 */
function confirmedPatch(currentStatus: string | null | undefined): Record<string, unknown> {
  return currentStatus === 'pending' ? { status: 'confirmed' } : {}
}

/** Maps an MP payment status to the `payments`/`consultations` vocabulary. */
function mapMpStatus(mpStatus: string): { paymentsStatus: 'pending' | 'authorized' | 'approved' | 'rejected'; consultationStatus: 'in_process' | 'paid' | 'rejected' | 'pending_payment' } {
  if (mpStatus === 'approved') return { paymentsStatus: 'approved', consultationStatus: 'paid' }
  // On-demand pre-authorization (authorizeOnly): reserved on the card, not captured yet.
  if (mpStatus === 'authorized') return { paymentsStatus: 'authorized', consultationStatus: 'in_process' }
  if (mpStatus === 'rejected' || mpStatus === 'cancelled') return { paymentsStatus: 'rejected', consultationStatus: 'rejected' }
  /*
   * in_process, pending, in_mediation, etc. — MP TODAVÍA NO DIJO QUE SÍ.
   *
   * Esto mapeaba a `in_process`, el mismo valor que usa una pre-autorización ya
   * aprobada, así que la consulta quedaba indistinguible de una pagada. Pasó de
   * verdad el 2026-07-31: MP contestó `pending / pending_review_manual`, después
   * resolvió `rejected / cc_rejected_high_risk`, y el paciente se quedó con una
   * consulta confirmada y con acceso a la videollamada sin haber pagado nada.
   *
   * `pending_payment` es el estado con el que la consulta ya nace y es el que
   * habilita reintentar el cobro (ver el chequeo de "is not payable"), así que
   * "en revisión" vuelve a ser lo que es: todavía no está paga.
   */
  return { paymentsStatus: 'pending', consultationStatus: 'pending_payment' }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // --- Auth: verify caller is a logged-in Supabase user ---
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ data: null, error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) {
      return new Response(
        JSON.stringify({ data: null, error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // --- Parse body ---
    const body: PaymentBody = await req.json()
    const { consultationId, cardToken, paymentMethodId, payerEmail, useCredits, description, authorizeOnly } = body

    if (!consultationId) {
      return new Response(
        JSON.stringify({ data: null, error: 'Missing required field: consultationId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // --- On-demand pre-authorization: credit card only, no Healthy Credits ---
    if (authorizeOnly) {
      if (useCredits) {
        return new Response(
          JSON.stringify({ data: null, error: 'Las consultas inmediatas no admiten Healthy Credits' }),
          { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      const normalizedMethodId = (paymentMethodId ?? '').toLowerCase()
      if (normalizedMethodId.startsWith('deb') || normalizedMethodId === 'account_money') {
        return new Response(
          JSON.stringify({ data: null, error: 'Las consultas inmediatas se pagan con tarjeta de crédito' }),
          { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    // --- Service-role client for privileged reads/writes ---
    const serviceSupabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // --- 1. Load + validate the consultation ---
    const { data: consultation, error: consErr } = await serviceSupabase
      .from('consultations')
      .select('id, patient_id, professional_id, status, payment_status, price_at_booking')
      .eq('id', consultationId)
      .single()

    if (consErr || !consultation) {
      return new Response(
        JSON.stringify({ data: null, error: 'Consultation not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (consultation.patient_id !== user.id) {
      return new Response(
        JSON.stringify({ data: null, error: 'Forbidden: only the patient can pay for this consultation' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!['pending_payment', 'rejected'].includes(consultation.payment_status)) {
      return new Response(
        JSON.stringify({ data: null, error: `Consultation is not payable (payment_status=${consultation.payment_status})` }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // --- 2. Amount comes ONLY from the DB ---
    const amount = consultation.price_at_booking
    if (!amount || amount <= 0) {
      return new Response(
        JSON.stringify({ data: null, error: 'Consultation has no valid price_at_booking' }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // --- 3. Platform settings ---
    const { data: settings, error: settingsErr } = await serviceSupabase
      .from('platform_settings')
      .select('commission_rate, mp_fee_estimate_rate')
      .eq('id', 1)
      .single()

    if (settingsErr || !settings) {
      console.error('mp-payment: failed to load platform_settings:', settingsErr?.message)
      return new Response(
        JSON.stringify({ data: null, error: 'Platform settings unavailable' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    const { commission_rate: commissionRate, mp_fee_estimate_rate: mpFeeEstimateRate } = settings as PlatformSettings

    // --- 4. Credits ---
    let creditsUsed = 0
    if (useCredits) {
      const { data: balance, error: balErr } = await serviceSupabase.rpc('get_credit_balance', { p_patient: user.id })
      if (balErr) {
        console.error('mp-payment: get_credit_balance error:', balErr.message)
        return new Response(
          JSON.stringify({ data: null, error: 'Failed to read credit balance' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      creditsUsed = Math.max(0, Math.min(Number(balance) || 0, amount))
    }
    const chargedAmount = round2(amount - creditsUsed)

    // Find any prior pending/rejected payment attempt for this consultation to reuse the row.
    const { data: existingPayment } = await serviceSupabase
      .from('payments')
      .select('id')
      .eq('consultation_id', consultationId)
      .in('status', ['pending', 'rejected'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    async function upsertPayment(row: Record<string, unknown>): Promise<string> {
      if (existingPayment) {
        const { error } = await serviceSupabase.from('payments').update(row).eq('id', existingPayment.id)
        if (error) throw new Error(`payments update failed: ${error.message}`)
        return existingPayment.id
      }
      const { data, error } = await serviceSupabase.from('payments').insert(row).select('id').single()
      if (error) throw new Error(`payments insert failed: ${error.message}`)
      return data.id
    }

    // --- 5. Fully covered by credits — no MP call ---
    if (chargedAmount === 0) {
      const netToProfessional = round2(amount * (1 - commissionRate))

      const paymentId = await upsertPayment({
        consultation_id: consultationId,
        patient_id: user.id,
        professional_id: consultation.professional_id,
        method: 'credits',
        gross_amount: amount,
        credits_used: creditsUsed,
        charged_amount: 0,
        platform_fee: 0,
        mp_fee_estimated: 0,
        net_to_professional: netToProfessional,
        manual_settlement_amount: netToProfessional,
        currency: 'ARS',
        status: 'approved',
        status_detail: 'credits_full_cover',
      })

      if (creditsUsed > 0) {
        const { error: ledgerErr } = await serviceSupabase.from('patient_credits').insert({
          patient_id: user.id,
          amount: -creditsUsed,
          reason: 'redeem',
          consultation_id: consultationId,
          payment_id: paymentId,
          note: 'Consumo total en pago de consulta (100% créditos)',
        })
        if (ledgerErr) console.error('mp-payment: credits ledger insert error:', ledgerErr.message)
      }

      const { error: updateConsErr } = await serviceSupabase
        .from('consultations')
        .update({
          payment_status: 'paid',
          paid_at: new Date().toISOString(),
          // Pagar es lo que confirma el turno. Ver el comentario de `confirmedPatch`.
          ...confirmedPatch(consultation.status),
        })
        .eq('id', consultationId)
      if (updateConsErr) console.error('mp-payment: consultation update error:', updateConsErr.message)

      return new Response(
        JSON.stringify({
          data: { paymentId, status: 'approved', approved: true, creditsUsed, chargedAmount: 0 },
          error: null,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // --- 6. Charge remainder via MP (seller's own OAuth token) ---
    if (!cardToken || !paymentMethodId || !payerEmail) {
      return new Response(
        JSON.stringify({ data: null, error: 'Missing required fields for card charge: cardToken, paymentMethodId, payerEmail' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { data: mpAccount, error: mpAccErr } = await serviceSupabase
      .from('mp_accounts')
      .select('professional_id, mp_user_id, access_token, refresh_token, expires_at, active')
      .eq('professional_id', consultation.professional_id)
      .eq('active', true)
      .single()

    if (mpAccErr || !mpAccount) {
      return new Response(
        JSON.stringify({ data: null, error: 'Professional does not have a linked MercadoPago account' }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const account = mpAccount as MpAccountRow
    const refreshResult = await ensureFreshMpToken(serviceSupabase, account, PAYMENT_REFRESH_MARGIN_MS)
    if (refreshResult.invalidGrant) {
      return new Response(
        JSON.stringify({ data: null, error: 'MercadoPago connection expired — professional must reconnect' }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    const sellerAccessToken = refreshResult.accessToken

    // ── Split 20/80 flat (decisión de Mateo, 2026-07-29) ──────────────────────
    //
    // Healthier cobra su comisión COMPLETA sobre el bruto. El fee de Mercado
    // Pago lo paga el profesional: en un marketplace el que cobra es el
    // vendedor y MP le descuenta a él — no hay forma de que se lo cobre a la
    // plataforma.
    //
    // Modelo anterior (22/78, hasta 2026-07-29): la comisión era
    // `22% − fee_de_MP_estimado`, para que el profesional cobrara 78% clavado y
    // Healthier absorbiera el fee. Se descartó porque la estimación es a ciegas
    // — `application_fee` viaja CON el pago, antes de que MP diga cuánto va a
    // cobrar — y estaba en 7,99% contra un real de 4,1%: en el primer cobro
    // real Healthier se llevó $140,10 en vez de $179 y el profesional 81,9% en
    // lugar del 78% pactado.
    //
    // Con el flat la incertidumbre sale del lado de Healthier, que cobra 20%
    // siempre. Lo que ahora varía es el neto del profesional, porque el fee de
    // MP depende del plazo de acreditación que cada uno tenga configurado en SU
    // cuenta. Por eso lo que se le muestra es `mp_net_received_amount`, que
    // reconcilia mp-capture con el valor real.
    const applicationFee = Math.min(
      round2(amount * commissionRate),
      // Nunca más que lo efectivamente cobrado: con créditos parciales el bruto
      // puede superar lo que pasa por la tarjeta.
      Math.max(0, chargedAmount),
    )

    // La PARTE del profesional sobre el bruto, no lo que MP le deposita: de acá
    // MP todavía descuenta su fee.
    const netToProfessional = round2(amount * (1 - commissionRate))
    // Sólo para estimar el depósito mientras la captura no trajo el fee real.
    // Ya no interviene en el split.
    const mpFeeEstimated = round2(chargedAmount * mpFeeEstimateRate)
    const manualSettlementAmount = round2(creditsUsed * (1 - commissionRate))

    const idempotencyKey = await sha256Hex(`${consultationId}:${cardToken}`)

    const mpPayload: Record<string, unknown> = {
      transaction_amount: chargedAmount,
      token: cardToken,
      // El único texto de este cobro que controlamos: MP rotula su propia línea
      // de comisión como "cargo por uso de plataforma de terceros" y no expone
      // ningún campo para cambiarlo.
      description: description ? `Healthier — ${description}` : 'Healthier — Consulta médica',
      installments: 1,
      payment_method_id: paymentMethodId,
      payer: { email: payerEmail },
      external_reference: consultationId,
    }
    // MP rechaza application_fee=0; omitirla cuando no hay comisión que cobrar.
    if (applicationFee > 0) {
      mpPayload.application_fee = applicationFee
    }
    if (authorizeOnly) {
      // Two-step authorization: reserve on the card, capture later (mp-capture).
      // binary_mode is intentionally omitted — incompatible with capture:false.
      mpPayload.capture = false
    } else {
      mpPayload.binary_mode = true
    }

    const mpRes = await fetch(`${MP_API_BASE}/payments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sellerAccessToken}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(mpPayload),
    })

    const mpData = await mpRes.json() as {
      id?: number
      status?: string
      status_detail?: string
      error?: string
      message?: string
    }

    if (!mpRes.ok || !mpData.id) {
      console.error('mp-payment: MP payment error:', JSON.stringify(mpData))

      const method = creditsUsed > 0 ? 'mixed' : 'card'
      const paymentId = await upsertPayment({
        consultation_id: consultationId,
        patient_id: user.id,
        professional_id: consultation.professional_id,
        method,
        gross_amount: amount,
        credits_used: creditsUsed,
        charged_amount: chargedAmount,
        platform_fee: applicationFee,
        mp_fee_estimated: mpFeeEstimated,
        net_to_professional: netToProfessional,
        manual_settlement_amount: manualSettlementAmount,
        currency: 'ARS',
        status: 'rejected',
        status_detail: mpData.status_detail ?? mpData.message ?? mpData.error ?? 'mp_request_failed',
        collector_id: account.mp_user_id,
      })

      await serviceSupabase
        .from('consultations')
        .update({ payment_status: 'rejected' })
        .eq('id', consultationId)

      return new Response(
        JSON.stringify({
          data: { paymentId, status: 'rejected', approved: false, statusDetail: mpData.status_detail ?? null, creditsUsed, chargedAmount },
          error: mpData.message ?? mpData.error ?? 'MercadoPago payment failed',
        }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const mpPaymentId = String(mpData.id)
    const mpStatus = mpData.status ?? 'unknown'
    const { paymentsStatus, consultationStatus } = mapMpStatus(mpStatus)
    const method = creditsUsed > 0 ? 'mixed' : 'card'

    const paymentId = await upsertPayment({
      consultation_id: consultationId,
      patient_id: user.id,
      professional_id: consultation.professional_id,
      mp_payment_id: mpPaymentId,
      method,
      gross_amount: amount,
      credits_used: creditsUsed,
      charged_amount: chargedAmount,
      platform_fee: applicationFee,
      mp_fee_estimated: mpFeeEstimated,
      net_to_professional: netToProfessional,
      manual_settlement_amount: manualSettlementAmount,
      currency: 'ARS',
      status: paymentsStatus,
      status_detail: mpData.status_detail ?? '',
      collector_id: account.mp_user_id,
      ...(paymentsStatus === 'authorized' ? { authorized_at: new Date().toISOString() } : {}),
    })

    if (creditsUsed > 0) {
      const { error: ledgerErr } = await serviceSupabase.from('patient_credits').insert({
        patient_id: user.id,
        amount: -creditsUsed,
        reason: 'redeem',
        consultation_id: consultationId,
        payment_id: paymentId,
        note: 'Consumo parcial en pago mixto (créditos + tarjeta)',
      })
      if (ledgerErr) console.error('mp-payment: credits ledger insert error:', ledgerErr.message)
    }

    const consUpdate: Record<string, unknown> = {
      payment_status: consultationStatus,
      mp_payment_id: mpPaymentId,
    }
    if (consultationStatus === 'paid') {
      consUpdate.paid_at = new Date().toISOString()
      Object.assign(consUpdate, confirmedPatch(consultation.status))
    }
    // Una pre-autorización aprobada también confirma el turno: la plata está
    // reservada en la tarjeta y sólo falta capturarla al cerrar la consulta.
    if (paymentsStatus === 'authorized') {
      Object.assign(consUpdate, confirmedPatch(consultation.status))
    }

    const { error: updateConsErr } = await serviceSupabase
      .from('consultations')
      .update(consUpdate)
      .eq('id', consultationId)
    if (updateConsErr) console.error('mp-payment: consultation update error:', updateConsErr.message)

    return new Response(
      JSON.stringify({
        data: {
          paymentId,
          status: paymentsStatus,
          approved: paymentsStatus === 'approved',
          // El motivo que da MP (`cc_rejected_high_risk`, `pending_review_manual`,
          // …) es lo único que le permite al front decirle al paciente qué pasó
          // y qué hacer. Sin esto sólo se puede mostrar un genérico.
          statusDetail: mpData.status_detail ?? null,
          creditsUsed,
          chargedAmount,
        },
        error: null,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('mp-payment error:', err)
    return new Response(
      JSON.stringify({
        data: null,
        error: err instanceof Error ? err.message : 'Internal server error',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
