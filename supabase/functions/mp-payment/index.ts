import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const MP_ACCESS_TOKEN = Deno.env.get('MP_ACCESS_TOKEN')! // Healthier marketplace owner token
const MP_API_BASE = 'https://api.mercadopago.com/v1'
const HEALTHIER_COMMISSION_RATE = 0.15 // 15% marketplace fee

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface PaymentRequest {
  consultationId: string
  amount: number
  currency?: string
  customerId: string       // MP payer id
  cardId: string           // card token or saved card id
  professionalId: string   // Healthier profile id (used to look up mp_accounts)
  description?: string
}

interface MpAccount {
  mp_user_id: string       // collector_id (professional's MP id)
  access_token: string     // professional's MP access token (stored, not used here — collector_id is enough)
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
        JSON.stringify({ error: 'Unauthorized' }),
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
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // --- Parse body ---
    const body: PaymentRequest = await req.json()
    const { consultationId, amount, currency, customerId, cardId, professionalId, description } = body

    if (!consultationId || !amount || !customerId || !cardId || !professionalId) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: consultationId, amount, customerId, cardId, professionalId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (amount <= 0) {
      return new Response(
        JSON.stringify({ error: 'amount must be greater than 0' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // --- Service-role client for privileged reads/writes ---
    const serviceSupabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // --- Verify caller is the patient on this consultation ---
    const { data: consultation, error: consErr } = await serviceSupabase
      .from('consultations')
      .select('id, patient_id, professional_id, payment_status, mp_payment_id')
      .eq('id', consultationId)
      .single()

    if (consErr || !consultation) {
      return new Response(
        JSON.stringify({ error: 'Consultation not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (consultation.patient_id !== user.id) {
      return new Response(
        JSON.stringify({ error: 'Forbidden: only the patient can pay for this consultation' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (consultation.payment_status === 'approved') {
      return new Response(
        JSON.stringify({ error: 'Consultation already paid', paymentId: consultation.mp_payment_id }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // --- Look up professional's MP account ---
    const { data: mpAccount, error: mpAccErr } = await serviceSupabase
      .from('mp_accounts')
      .select('mp_user_id, access_token')
      .eq('professional_id', professionalId)
      .eq('active', true)
      .single()

    if (mpAccErr || !mpAccount) {
      return new Response(
        JSON.stringify({ error: 'Professional does not have a linked MercadoPago account' }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { mp_user_id: collectorId } = mpAccount as MpAccount

    // --- Build MP payment payload ---
    const marketplaceFee = Math.round(amount * HEALTHIER_COMMISSION_RATE)

    const mpPayload = {
      transaction_amount: amount,
      currency_id: currency ?? 'ARS',
      description: description ?? 'Consulta médica — Healthier',
      payment_method_id: 'account_money', // overridden by token when present
      token: cardId,
      installments: 1,
      payer: {
        id: customerId,
      },
      collector_id: collectorId,
      marketplace: 'HEALTHIER',
      marketplace_fee: marketplaceFee,
      binary_mode: true, // no pending state — approved or rejected immediately
    }

    // --- Call MP API ---
    const mpRes = await fetch(`${MP_API_BASE}/payments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': consultationId,
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
      console.error('MP payment error:', JSON.stringify(mpData))
      return new Response(
        JSON.stringify({
          error: 'MercadoPago payment failed',
          detail: mpData.message ?? mpData.error ?? 'Unknown error',
          mpStatus: mpData.status,
          mpStatusDetail: mpData.status_detail,
        }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const paymentId = String(mpData.id)
    const status = mpData.status ?? 'unknown'
    const statusDetail = mpData.status_detail ?? ''
    const isApproved = status === 'approved'

    // --- Update consultation with payment result ---
    const updatePayload: Record<string, string> = {
      mp_payment_id: paymentId,
      payment_status: isApproved ? 'approved' : status,
    }

    const { error: updateErr } = await serviceSupabase
      .from('consultations')
      .update(updatePayload)
      .eq('id', consultationId)

    if (updateErr) {
      // Payment went through — log the DB failure but don't fail the response
      console.error('Failed to update consultation after payment:', updateErr.message)
    }

    return new Response(
      JSON.stringify({
        data: {
          paymentId,
          status,
          statusDetail,
          marketplaceFee,
          approved: isApproved,
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
