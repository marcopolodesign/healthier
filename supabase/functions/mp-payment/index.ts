/**
 * mp-payment — Charge a consultation (MP split payment + Healthy Credits)
 *
 * POST body: {
 *   consultationId: string,
 *   cardToken?: string,        // single-use MP card token — required if chargedAmount > 0
 *   paymentMethodId?: string,  // MP brand id ('visa' | 'master' | ...) — required with cardToken
 *   payerEmail?: string,       // required with cardToken
 *   savedCardId?: string,      // payment_methods.id — de acá sale el `payer.id`
 *                              // (customer de MP) que el cobro de una tarjeta
 *                              // guardada necesita sí o sí. NO es informativo.
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
import { ensureFreshPharmacyMpToken } from '../_shared/pharmacyMpRefresh.ts'

const MP_API_BASE = 'https://api.mercadopago.com/v1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface PaymentBody {
  consultationId?: string
  orderId?: string
  cardToken?: string
  paymentMethodId?: string
  payerEmail?: string
  savedCardId?: string
  useCredits?: boolean
  description?: string
  authorizeOnly?: boolean
  /** DNI del pagador tal como lo tipeó en el Brick (tarjeta nueva). */
  payerDocType?: string
  payerDocNumber?: string
  /** window.MP_DEVICE_SESSION_ID — lo genera el SDK de MP en el browser. */
  deviceId?: string
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
    const { consultationId, orderId, cardToken, paymentMethodId, payerEmail, savedCardId, useCredits, description, authorizeOnly, payerDocType, payerDocNumber, deviceId } = body

    // --- Medication order charge (mutually exclusive with consultationId) ---
    // Own, self-contained code path: no Healthy Credits, no pre-authorization,
    // always an immediate binary_mode charge against the pharmacy's own MP
    // OAuth token instead of a professional's. Kept separate from the
    // consultation flow below rather than threading order-awareness through
    // it, so the existing (production) consultation payment path is
    // untouched by this change.
    if (orderId) {
      if (consultationId) {
        return new Response(
          JSON.stringify({ data: null, error: 'orderId and consultationId are mutually exclusive' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      if (useCredits) {
        return new Response(
          JSON.stringify({ data: null, error: 'Los pedidos de medicamentos no admiten Healthy Credits' }),
          { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      if (!cardToken || !paymentMethodId || !payerEmail) {
        return new Response(
          JSON.stringify({ data: null, error: 'Missing required fields for card charge: cardToken, paymentMethodId, payerEmail' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const serviceSupabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      )

      const { data: order, error: orderErr } = await serviceSupabase
        .from('medication_orders')
        .select('id, patient_id, pharmacy_id, payment_status')
        .eq('id', orderId)
        .single()

      if (orderErr || !order) {
        return new Response(
          JSON.stringify({ data: null, error: 'Order not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      if (order.patient_id !== user.id) {
        return new Response(
          JSON.stringify({ data: null, error: 'Forbidden: only the patient can pay for this order' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      if (order.payment_status !== 'no_pagado') {
        return new Response(
          JSON.stringify({ data: null, error: `Order is not payable (payment_status=${order.payment_status})` }),
          { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // --- Amount comes from the DB, re-priced against the live catalog for
      //     items linked to a pharmacy_product_id — never trust a client-set
      //     unit_price on medication_order_items (its INSERT policy only
      //     checks ownership, not price). ---
      const { data: items, error: itemsErr } = await serviceSupabase
        .from('medication_order_items')
        .select('id, pharmacy_product_id, medication_name, quantity, unit_price')
        .eq('order_id', orderId)

      if (itemsErr || !items?.length) {
        return new Response(
          JSON.stringify({ data: null, error: 'Order has no items' }),
          { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const catalogIds = items.map((it) => it.pharmacy_product_id).filter(Boolean) as string[]
      const currentPrices = new Map<string, number>()
      if (catalogIds.length) {
        const { data: catalogRows } = await serviceSupabase
          .from('pharmacy_products')
          .select('id, price')
          .in('id', catalogIds)
        for (const row of catalogRows ?? []) currentPrices.set(row.id, Number(row.price))
      }

      let amount = 0
      for (const it of items) {
        const unitPrice = it.pharmacy_product_id && currentPrices.has(it.pharmacy_product_id)
          ? currentPrices.get(it.pharmacy_product_id)!
          : Number(it.unit_price)
        amount += unitPrice * it.quantity
      }
      amount = round2(amount)

      if (amount <= 0) {
        return new Response(
          JSON.stringify({ data: null, error: 'Order has no valid amount' }),
          { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const { data: pharmacy, error: pharmacyErr } = await serviceSupabase
        .from('pharmacies')
        .select('id, commission_rate')
        .eq('id', order.pharmacy_id)
        .single()

      if (pharmacyErr || !pharmacy) {
        return new Response(
          JSON.stringify({ data: null, error: 'Pharmacy not found' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const { data: pharmacyMpAccount, error: pharmAccErr } = await serviceSupabase
        .from('pharmacy_mp_accounts')
        .select('pharmacy_id, mp_user_id, access_token, refresh_token, expires_at, active')
        .eq('pharmacy_id', order.pharmacy_id)
        .eq('active', true)
        .single()

      if (pharmAccErr || !pharmacyMpAccount) {
        return new Response(
          JSON.stringify({ data: null, error: 'Pharmacy does not have a linked MercadoPago account' }),
          { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const refreshResult = await ensureFreshPharmacyMpToken(serviceSupabase, pharmacyMpAccount, PAYMENT_REFRESH_MARGIN_MS)
      if (refreshResult.invalidGrant) {
        return new Response(
          JSON.stringify({ data: null, error: 'MercadoPago connection expired — pharmacy must reconnect' }),
          { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      const sellerAccessToken = refreshResult.accessToken
      const commissionRate = Number(pharmacy.commission_rate)

      const applicationFee = Math.min(round2(amount * commissionRate), amount)
      const netToPharmacy = round2(amount * (1 - commissionRate))

      let mpCustomerId: string | null = null
      if (savedCardId) {
        const { data: metodo } = await serviceSupabase
          .from('payment_methods')
          .select('mp_customer_id')
          .eq('id', savedCardId)
          .eq('user_id', user.id)
          .maybeSingle()
        mpCustomerId = metodo?.mp_customer_id ?? null
        if (!mpCustomerId) {
          return new Response(
            JSON.stringify({ data: null, error: 'No encontramos la tarjeta guardada. Probá con otra tarjeta.' }),
            { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }
      }

      const { data: perfilPagador } = await serviceSupabase
        .from('profiles')
        .select('full_name, dni')
        .eq('id', user.id)
        .maybeSingle()

      const docNumber = payerDocNumber ?? perfilPagador?.dni ?? null
      const docType = docNumber ? (payerDocType ?? 'DNI') : null
      const nombreCompleto = (perfilPagador?.full_name ?? '').trim()
      const [firstName, ...restoNombre] = nombreCompleto.split(/\s+/)
      const lastName = restoNombre.join(' ') || null

      const idempotencyKey = await sha256Hex(`${orderId}:${cardToken}`)

      const mpPayload: Record<string, unknown> = {
        transaction_amount: amount,
        token: cardToken,
        description: description ? `Healthier — ${description}` : 'Healthier — Pedido de medicamentos',
        installments: 1,
        payment_method_id: paymentMethodId,
        payer: {
          ...(mpCustomerId ? { type: 'customer', id: mpCustomerId } : {}),
          email: payerEmail,
          ...(firstName ? { first_name: firstName } : {}),
          ...(lastName ? { last_name: lastName } : {}),
          ...(docNumber ? { identification: { type: docType, number: docNumber } } : {}),
        },
        additional_info: {
          payer: {
            ...(firstName ? { first_name: firstName } : {}),
            ...(lastName ? { last_name: lastName } : {}),
          },
          items: items.map((it) => ({
            id: it.pharmacy_product_id ?? it.id,
            title: it.medication_name,
            category_id: 'health',
            quantity: it.quantity,
            unit_price: it.pharmacy_product_id && currentPrices.has(it.pharmacy_product_id) ? currentPrices.get(it.pharmacy_product_id)! : Number(it.unit_price),
          })),
        },
        external_reference: orderId,
        binary_mode: true,
      }
      if (applicationFee > 0) mpPayload.application_fee = applicationFee

      const { data: existingPayment } = await serviceSupabase
        .from('payments')
        .select('id')
        .eq('order_id', orderId)
        .in('status', ['pending', 'rejected'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      async function upsertOrderPayment(row: Record<string, unknown>): Promise<string> {
        if (existingPayment) {
          const { error } = await serviceSupabase.from('payments').update(row).eq('id', existingPayment.id)
          if (error) throw new Error(`payments update failed: ${error.message}`)
          return existingPayment.id
        }
        const { data, error } = await serviceSupabase.from('payments').insert(row).select('id').single()
        if (error) throw new Error(`payments insert failed: ${error.message}`)
        return data.id
      }

      const mpRes = await fetch(`${MP_API_BASE}/payments`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sellerAccessToken}`,
          'Content-Type': 'application/json',
          'X-Idempotency-Key': idempotencyKey,
          ...(deviceId ? { 'X-meli-session-id': deviceId } : {}),
        },
        body: JSON.stringify(mpPayload),
      })

      const mpData = await mpRes.json() as { id?: number; status?: string; status_detail?: string; error?: string; message?: string }

      if (!mpRes.ok || !mpData.id) {
        console.error('mp-payment (order): MP payment error:', JSON.stringify(mpData))
        const paymentId = await upsertOrderPayment({
          order_id: orderId,
          pharmacy_id: order.pharmacy_id,
          patient_id: user.id,
          method: 'card',
          gross_amount: amount,
          credits_used: 0,
          charged_amount: amount,
          platform_fee: applicationFee,
          mp_fee_estimated: 0,
          net_to_professional: netToPharmacy,
          manual_settlement_amount: 0,
          currency: 'ARS',
          status: 'rejected',
          status_detail: mpData.status_detail ?? mpData.message ?? mpData.error ?? 'mp_request_failed',
          collector_id: pharmacyMpAccount.mp_user_id,
        })
        return new Response(
          JSON.stringify({
            data: { paymentId, status: 'rejected', approved: false, statusDetail: mpData.status_detail ?? null, chargedAmount: amount },
            error: mpData.message ?? mpData.error ?? 'MercadoPago payment failed',
          }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const mpPaymentId = String(mpData.id)
      const { paymentsStatus } = mapMpStatus(mpData.status ?? 'unknown')

      const paymentId = await upsertOrderPayment({
        order_id: orderId,
        pharmacy_id: order.pharmacy_id,
        patient_id: user.id,
        mp_payment_id: mpPaymentId,
        method: 'card',
        gross_amount: amount,
        credits_used: 0,
        charged_amount: amount,
        platform_fee: applicationFee,
        mp_fee_estimated: 0,
        net_to_professional: netToPharmacy,
        manual_settlement_amount: 0,
        currency: 'ARS',
        status: paymentsStatus,
        status_detail: mpData.status_detail ?? '',
        collector_id: pharmacyMpAccount.mp_user_id,
      })

      if (paymentsStatus === 'approved') {
        const { error: orderUpdateErr } = await serviceSupabase
          .from('medication_orders')
          .update({ payment_status: 'pagado', subtotal: amount, total: amount })
          .eq('id', orderId)
        if (orderUpdateErr) console.error('mp-payment (order): medication_orders update error:', orderUpdateErr.message)
      }

      return new Response(
        JSON.stringify({
          data: {
            paymentId,
            status: paymentsStatus,
            approved: paymentsStatus === 'approved',
            statusDetail: mpData.status_detail ?? null,
            chargedAmount: amount,
          },
          error: null,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

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

    /**
     * Tarjeta guardada: hay que decirle a MP DE QUIÉN es la tarjeta.
     *
     * Un token hecho a partir de un `cardId` pertenece a un *customer* de MP, y
     * el cobro tiene que declararlo en `payer.id` (con `payer.type: 'customer'`).
     * Sin eso MP responde **"Customer not found"**, que es exactamente el error
     * que devolvía este cobro — el payload sólo mandaba `payer: { email }`.
     *
     * El `customer_id` sale de nuestra fila de `payment_methods`, filtrada por
     * `user_id`: así el paciente sólo puede cobrar contra una tarjeta suya,
     * aunque mande el `savedCardId` de otro.
     */
    let mpCustomerId: string | null = null
    if (savedCardId) {
      const { data: metodo, error: metodoErr } = await serviceSupabase
        .from('payment_methods')
        .select('mp_customer_id')
        .eq('id', savedCardId)
        .eq('user_id', user.id)
        .maybeSingle()

      if (metodoErr) {
        console.error('mp-payment: no se pudo leer payment_methods:', metodoErr)
      }
      mpCustomerId = metodo?.mp_customer_id ?? null

      // Cobrar una tarjeta guardada SIN el customer no funciona: MP la rechaza.
      // Mejor cortar acá con un mensaje entendible que mandar el cobro a que
      // vuelva como "Customer not found".
      if (!mpCustomerId) {
        return new Response(
          JSON.stringify({ data: null, error: 'No encontramos la tarjeta guardada. Probá con otra tarjeta.' }),
          { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    /**
     * Identidad del pagador — recomendación explícita de MP para mejorar la
     * aprobación ("Recomendaciones para mejorar la aprobación de pagos"):
     * mandar identification, first_name/last_name y additional_info. El Brick
     * YA pide el DNI en el formulario y hasta ahora se descartaba acá.
     *
     * Prioridad: lo que tipeó el pagador en el Brick (es el titular de la
     * tarjeta) → el perfil del paciente como fallback (tarjeta guardada, donde
     * no hay formulario).
     */
    const { data: perfilPagador } = await serviceSupabase
      .from('profiles')
      .select('full_name, dni')
      .eq('id', user.id)
      .maybeSingle()

    const docNumber = payerDocNumber ?? perfilPagador?.dni ?? null
    const docType = docNumber ? (payerDocType ?? 'DNI') : null
    const nombreCompleto = (perfilPagador?.full_name ?? '').trim()
    // Split simple: primera palabra = nombre, el resto = apellido. Para el
    // antifraude alcanza; no intentamos adivinar apellidos compuestos.
    const [firstName, ...restoNombre] = nombreCompleto.split(/\s+/)
    const lastName = restoNombre.join(' ') || null

    const mpPayload: Record<string, unknown> = {
      transaction_amount: chargedAmount,
      token: cardToken,
      // El único texto de este cobro que controlamos: MP rotula su propia línea
      // de comisión como "cargo por uso de plataforma de terceros" y no expone
      // ningún campo para cambiarlo.
      description: description ? `Healthier — ${description}` : 'Healthier — Consulta médica',
      installments: 1,
      payment_method_id: paymentMethodId,
      payer: {
        ...(mpCustomerId ? { type: 'customer', id: mpCustomerId } : {}),
        email: payerEmail,
        ...(firstName ? { first_name: firstName } : {}),
        ...(lastName ? { last_name: lastName } : {}),
        ...(docNumber ? { identification: { type: docType, number: docNumber } } : {}),
      },
      // Más contexto = mejor evaluación del antifraude, según la doc de MP.
      additional_info: {
        payer: {
          ...(firstName ? { first_name: firstName } : {}),
          ...(lastName ? { last_name: lastName } : {}),
        },
        items: [{
          id: consultationId,
          title: description ?? 'Consulta médica',
          category_id: 'services',
          quantity: 1,
          unit_price: chargedAmount,
        }],
      },
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
        // Device ID del browser del pagador (window.MP_DEVICE_SESSION_ID).
        // La doc de MP pide reenviarlo así cuando el pago se crea del lado
        // del servidor; ayuda al antifraude a reconocer el dispositivo — el
        // rechazo que venimos viendo (`cc_rejected_high_risk`) es justo el
        // caso que este dato mejora.
        ...(deviceId ? { 'X-meli-session-id': deviceId } : {}),
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
