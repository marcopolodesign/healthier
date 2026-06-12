/**
 * mpService.js — Mercado Pago integration service for Healthier
 *
 * All public methods return { data, error } — never throw.
 * DB interactions use the Supabase JS client directly (service layer pattern).
 * Remote operations (card tokenization, charge) go through Edge Functions.
 *
 * IMPORTANT: @mercadopago/sdk-react must be installed before using
 * the React components that depend on this service:
 *   npm install @mercadopago/sdk-react
 */

import { supabase, toCamelCase } from '../lib/supabase'

// ─── helpers ─────────────────────────────────────────────────────────────────

/**
 * Get the current authenticated session's access token.
 * Returns null when there is no active session (avoids throwing).
 */
async function getAccessToken() {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ?? null
}

/**
 * Call a Supabase Edge Function with JSON body.
 * Returns the parsed JSON response or throws a structured error.
 */
async function callEdgeFunction(fnName, body, token) {
  const accessToken = token ?? await getAccessToken()
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${fnName}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(body),
    }
  )
  const json = await res.json().catch(() => ({ error: 'invalid_response' }))
  if (!res.ok) {
    throw new Error(json?.error ?? json?.message ?? `HTTP ${res.status}`)
  }
  return json
}

// ─── public API ──────────────────────────────────────────────────────────────

export const mpService = {
  /**
   * Returns the Mercado Pago public key for the CardPayment brick.
   *
   * Priority:
   *   1. VITE_MP_PUBLIC_KEY env var (local dev / Vercel env)
   *   2. mp_accounts row for any professional (Marketplace flow — we use
   *      the platform public key stored there)
   *   3. Returns null — UI should show a graceful disabled state.
   */
  async getPaymentPlatformConfig() {
    try {
      // 1. Environment variable (preferred for non-marketplace deployments)
      const envKey = import.meta.env.VITE_MP_PUBLIC_KEY
      if (envKey) {
        return { data: { publicKey: envKey }, error: null }
      }

      // 2. Fetch from mp_accounts — take the first connected professional
      const { data, error } = await supabase
        .from('mp_accounts')
        .select('public_key')
        .not('public_key', 'is', null)
        .limit(1)
        .single()

      if (error || !data?.public_key) {
        return { data: null, error: error?.message ?? 'No MP public key configured' }
      }

      return { data: { publicKey: data.public_key }, error: null }
    } catch (err) {
      return { data: null, error: err.message }
    }
  },

  /**
   * Save a tokenized card via the `mp-save-card` Edge Function.
   *
   * The Edge Function is responsible for:
   *   - Creating / finding the MP customer for this user
   *   - Associating the card token to that customer on the MP API
   *   - Inserting a row in `payment_methods` via the service-role client
   *
   * @param {Object} params
   * @param {string} params.cardToken       - MP card token from CardPayment brick
   * @param {string} params.payerEmail      - email entered in the brick
   * @param {string} [params.payerDocType]  - e.g. "DNI"
   * @param {string} [params.payerDocNumber]
   * @returns {{ data: { id, cardBrand, lastFour, mpCustomerId, mpCardId } | null, error: string | null }}
   */
  async saveCard({ cardToken, payerEmail, payerDocType, payerDocNumber }) {
    try {
      const result = await callEdgeFunction('mp-save-card', {
        cardToken,
        payerEmail,
        payerDocType: payerDocType ?? null,
        payerDocNumber: payerDocNumber ?? null,
      })
      return { data: toCamelCase(result), error: null }
    } catch (err) {
      return { data: null, error: err.message }
    }
  },

  /**
   * List the current user's saved payment methods.
   *
   * @returns {{ data: Array<{ id, cardBrand, lastFour, createdAt }> | null, error: string | null }}
   */
  async getMyCards() {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return { data: [], error: null }

      const { data, error } = await supabase
        .from('payment_methods')
        .select('id, card_brand, last_four, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      if (error) return { data: null, error: error.message }
      return { data: toCamelCase(data), error: null }
    } catch (err) {
      return { data: null, error: err.message }
    }
  },

  /**
   * Delete a saved payment method.
   * RLS policy ensures users can only delete their own rows.
   *
   * @param {string} id - UUID of the payment_methods row
   * @returns {{ data: true | null, error: string | null }}
   */
  async deleteCard(id) {
    try {
      const { error } = await supabase
        .from('payment_methods')
        .delete()
        .eq('id', id)

      if (error) return { data: null, error: error.message }
      return { data: true, error: null }
    } catch (err) {
      return { data: null, error: err.message }
    }
  },

  /**
   * Charge a consultation via the `mp-payment` Edge Function.
   *
   * The Edge Function handles:
   *   - Fetching the professional's MP access token (Marketplace split)
   *   - Creating the MP payment with the saved card
   *   - Writing mp_payment_id + payment_status to the consultation row
   *
   * @param {Object} params
   * @param {string} params.consultationId
   * @param {number} params.amount           - in ARS, integer cents-free
   * @param {string} [params.currency]       - defaults to "ARS"
   * @param {string} params.cardId           - payment_methods.id (UUID)
   * @param {string} params.professionalId   - profiles.id of the professional
   * @param {string} [params.description]    - MP payment description
   * @returns {{ data: { mpPaymentId, status, consultationId } | null, error: string | null }}
   */
  async createPayment({
    consultationId,
    amount,
    currency = 'ARS',
    cardId,
    professionalId,
    description = 'Consulta Healthier',
  }) {
    try {
      const result = await callEdgeFunction('mp-payment', {
        consultationId,
        amount,
        currency,
        cardId,
        professionalId,
        description,
      })
      return { data: toCamelCase(result), error: null }
    } catch (err) {
      return { data: null, error: err.message }
    }
  },

  /**
   * Returns the OAuth initiation URL for connecting a professional's MP account.
   * Points to the `mp-connect` Edge Function which redirects to MP OAuth.
   *
   * @param {string} professionalId
   * @returns {string}
   */
  getMpConnectUrl(professionalId) {
    return `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mp-connect?professional_id=${professionalId}`
  },
}
