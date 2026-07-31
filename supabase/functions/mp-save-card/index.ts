import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const IS_PROD = Deno.env.get('MP_IS_PROD') === 'true'
const MP_ACCESS_TOKEN = IS_PROD
  ? Deno.env.get('MP_ACCESS_TOKEN_PROD')!
  : Deno.env.get('MP_ACCESS_TOKEN_SANDBOX')!
const MP_API_BASE = 'https://api.mercadopago.com/v1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface SaveCardBody {
  cardToken: string
  payerEmail: string
  payerDocType?: string
  payerDocNumber?: string
  /** Opcional: si no viene, se toma del JWT. Ver el comentario del handler. */
  userId?: string
}

interface MpCustomer {
  id: string
  email: string
  results?: MpCustomer[]
  status?: number
  message?: string
}

interface MpCard {
  id: string
  last_four_digits: string
  payment_method: {
    id: string
  }
  status?: number
  message?: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  try {
    // Verify Supabase JWT
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

    // Parse and validate body
    const body: SaveCardBody = await req.json()
    const { cardToken, payerEmail, payerDocType, payerDocNumber, userId } = body

    // `userId` sale del JWT cuando el cliente no lo manda: es el mismo dato y
    // ya está verificado acá arriba. Pedirlo por body hacía que un cliente que
    // lo olvidara fallara con un 400 después de que el paciente cargara la
    // tarjeta entera — que es exactamente lo que pasaba desde el Perfil.
    const dueño = userId ?? user.id

    // Enumerar SÓLO lo que falta: el mensaje anterior listaba los tres campos
    // siempre, así que no se podía saber cuál era el que faltaba de verdad.
    const faltantes = [
      !cardToken && 'cardToken',
      !payerEmail && 'payerEmail',
      !dueño && 'userId',
    ].filter(Boolean)

    if (faltantes.length) {
      return new Response(
        JSON.stringify({ error: `Missing required fields: ${faltantes.join(', ')}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Caller can only save a card for themselves
    if (dueño !== user.id) {
      return new Response(
        JSON.stringify({ error: 'Forbidden' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Step 1: Search for existing MP customer by email to avoid duplicates
    const searchRes = await fetch(
      `${MP_API_BASE}/customers/search?email=${encodeURIComponent(payerEmail)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    )

    if (!searchRes.ok) {
      const txt = await searchRes.text()
      throw new Error(`MP customer search failed: ${txt}`)
    }

    const searchData = await searchRes.json() as { results: MpCustomer[]; paging: { total: number } }
    let customerId: string

    if (searchData.paging.total > 0) {
      // Reuse existing customer
      customerId = searchData.results[0].id
    } else {
      // Step 2a: Create new MP customer
      const customerPayload: Record<string, string> = { email: payerEmail }
      if (payerDocType) customerPayload.identification_type = payerDocType
      if (payerDocNumber) customerPayload.identification_number = payerDocNumber

      const createRes = await fetch(`${MP_API_BASE}/customers`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(customerPayload),
      })

      if (!createRes.ok) {
        const txt = await createRes.text()
        throw new Error(`MP customer creation failed: ${txt}`)
      }

      const customer = await createRes.json() as MpCustomer
      if (customer.status && customer.status >= 400) {
        throw new Error(`MP customer creation error: ${customer.message}`)
      }

      customerId = customer.id
    }

    // Step 2b: Save card to customer
    const cardRes = await fetch(`${MP_API_BASE}/customers/${customerId}/cards`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token: cardToken }),
    })

    if (!cardRes.ok) {
      const txt = await cardRes.text()
      throw new Error(`MP card save failed: ${txt}`)
    }

    const card = await cardRes.json() as MpCard
    if (card.status && card.status >= 400) {
      throw new Error(`MP card save error: ${card.message}`)
    }

    return new Response(
      JSON.stringify({
        data: {
          customerId,
          cardId: card.id,
          lastFourDigits: card.last_four_digits,
          cardBrand: card.payment_method?.id ?? null,
        },
        error: null,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('mp-save-card error:', err)
    return new Response(
      JSON.stringify({
        data: null,
        error: err instanceof Error ? err.message : 'Internal error',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
