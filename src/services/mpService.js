/**
 * mpService.js — Mercado Pago split-payments integration service for Healthier
 *
 * All public methods return { data, error } — never throw.
 * DB reads use the Supabase JS client directly (service layer pattern).
 * Remote operations (tokenization, charges, refunds, OAuth) go through Edge
 * Functions — see /private/tmp .../scratchpad/spec-mp-split.md Sección C for
 * the exact contracts.
 *
 * IMPORTANT: @mercadopago/sdk-react must be installed before using the React
 * components that depend on this service:
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
 * Call a Supabase Edge Function with a JSON body (POST).
 * `path` may include a query string (e.g. 'mp-connect?action=disconnect').
 * Returns the parsed JSON response or throws a structured error.
 *
 * The newer split-payments functions (mp-payment, mp-refund) respond with
 * `{ data, error }` directly — this unwraps that envelope so callers always
 * get the inner payload. Older functions (mp-save-card) return a flat object
 * and pass through unchanged.
 */
async function callEdgeFunction(path, body, token) {
  const accessToken = token ?? await getAccessToken()
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${path}`,
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
  if (json && typeof json === 'object' && ('data' in json || 'error' in json)) {
    if (json.error) throw new Error(json.error)
    return json.data
  }
  return json
}

// ─── public API ──────────────────────────────────────────────────────────────

export const mpService = {
  /**
   * Returns the Mercado Pago public key for the CardPayment brick.
   * Always the PLATFORM's public key — the split-payments model tokenizes
   * client-side with the integrator's key and charges server-side with the
   * professional's OAuth access token (see spec Sección A.2).
   *
   * Priority:
   *   1. VITE_MP_PUBLIC_KEY env var (local dev / Vercel env)
   *   2. mp_accounts row for any professional (legacy fallback)
   *   3. Returns null — UI should show a graceful disabled state.
   */
  async getPaymentPlatformConfig() {
    try {
      const isProd = import.meta.env.VITE_MP_IS_PROD === 'true'
      const envKey = isProd
        ? import.meta.env.VITE_MP_PUBLIC_KEY_PROD
        : import.meta.env.VITE_MP_PUBLIC_KEY_SANDBOX
      const legacyKey = import.meta.env.VITE_MP_PUBLIC_KEY
      const resolvedKey = envKey || legacyKey
      if (resolvedKey) {
        return { data: { publicKey: resolvedKey, isProd }, error: null }
      }

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
   * (Unchanged by the split-payments migration — see spec Sección C6.)
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
   * Includes `mpCardId` — required client-side to re-tokenize with the CVV
   * before charging a saved card (spec Sección A.3 / D3).
   *
   * @returns {{ data: Array<{ id, cardBrand, lastFour, mpCardId, createdAt }> | null, error: string | null }}
   */
  async getMyCards() {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return { data: [], error: null }

      const { data, error } = await supabase
        .from('payment_methods')
        .select('id, card_brand, last_four, mp_card_id, created_at')
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
   * Charge a consultation via the `mp-payment` Edge Function (contract C2).
   * The server ALWAYS derives amount/professional/fees from the consultation
   * row — never trust client-supplied amounts. The client only supplies the
   * single-use card token (or nothing, for a 100%-credits payment).
   *
   * @param {Object} params
   * @param {string} params.consultationId
   * @param {string} [params.cardToken]       - MP single-use card token (new card, or a saved card re-tokenized with the CVV)
   * @param {string} [params.paymentMethodId] - MP brand id ('visa'/'master'/...) — required together with cardToken
   * @param {string} [params.payerEmail]
   * @param {string} [params.savedCardId]     - payment_methods.id, for record-keeping only
   * @param {boolean} [params.useCredits]     - apply the patient's Healthy Credits balance first
   * @param {boolean} [params.authorizeOnly]  - on-demand pre-authorization (spec Sección D1): `capture:false`
   *                                            on MP's side — the card is only held, not charged, until
   *                                            `capturePayment` runs (or the `mp-capture` sweep cron does, as
   *                                            a backstop). Credit cards only — the server rejects debit /
   *                                            account_money and useCredits with a 422 when this is true.
   * @param {string} [params.description]
   * @returns {{ data: { paymentId, status, approved, creditsUsed, chargedAmount } | null, error: string | null }}
   */
  async createPayment({ consultationId, cardToken, paymentMethodId, payerEmail, savedCardId, useCredits = false, authorizeOnly = false, description }) {
    try {
      const result = await callEdgeFunction('mp-payment', {
        consultationId,
        cardToken: cardToken ?? null,
        paymentMethodId: paymentMethodId ?? null,
        payerEmail: payerEmail ?? null,
        savedCardId: savedCardId ?? null,
        useCredits,
        authorizeOnly,
        description: description ?? 'Consulta Healthier',
      })
      return { data: toCamelCase(result), error: null }
    } catch (err) {
      return { data: null, error: err.message }
    }
  },

  /**
   * Captures a previously authorized pre-auth hold (mp-capture action=capture).
   * Called right after a professional finalizes an on-demand consultation
   * (spec Sección D2 — see consultationsService.finalize). Idempotent
   * server-side: safe to call even if the payment was already captured
   * (e.g. by the sweep cron backstop racing with this call).
   *
   * @param {string} consultationId
   * @returns {{ data: { status, capturedAt } | null, error: string | null }}
   */
  async capturePayment(consultationId) {
    try {
      const result = await callEdgeFunction('mp-capture', { action: 'capture', consultationId })
      return { data: toCamelCase(result), error: null }
    } catch (err) {
      return { data: null, error: err.message }
    }
  },

  /**
   * Cancels a pre-authorization hold without charging anything
   * (mp-capture action=cancel-auth). Used when the patient cancels an
   * on-demand request, the 10-minute matching window expires, or no
   * professional was available. Nothing is refunded because nothing was
   * ever captured — the card issuer releases the hold on its own.
   *
   * @param {string} consultationId
   * @returns {{ data: { status } | null, error: string | null }}
   */
  async cancelAuthorization(consultationId) {
    try {
      const result = await callEdgeFunction('mp-capture', { action: 'cancel-auth', consultationId })
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
    return `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mp-connect?action=authorize&professionalId=${professionalId}`
  },

  /**
   * Disconnects the current professional's MercadoPago account
   * (mp-connect?action=disconnect — spec C1). Marks mp_accounts.active=false
   * and professional_profiles.mp_connected=false server-side.
   */
  async disconnectMp(professionalId) {
    try {
      await callEdgeFunction('mp-connect?action=disconnect', { professionalId })
      return { data: true, error: null }
    } catch (err) {
      return { data: null, error: err.message }
    }
  },

  /**
   * Check whether a professional can receive paid bookings.
   * Source of truth: professional_profiles.mp_connected (denormalized by
   * mp-connect / disconnect — avoids exposing mp_accounts via RLS to the
   * booking UI). Falls back to mp_accounts.active if the column read fails.
   *
   * Returns { data: { connected: boolean, email: string|null }, error }
   */
  async getConnectionStatus(professionalId) {
    try {
      const { data, error } = await supabase
        .from('professional_profiles')
        .select('mp_connected')
        .eq('user_id', professionalId)
        .maybeSingle()

      if (!error && data) {
        return { data: { connected: !!data.mp_connected, email: null }, error: null }
      }

      // Fallback for environments where the column isn't populated yet
      const { data: acc, error: accErr } = await supabase
        .from('mp_accounts')
        .select('id, active')
        .eq('professional_id', professionalId)
        .maybeSingle()
      if (accErr) return { data: { connected: false, email: null }, error: accErr.message }
      return { data: { connected: !!(acc && acc.active !== false), email: null }, error: null }
    } catch (err) {
      return { data: { connected: false, email: null }, error: err.message }
    }
  },

  /**
   * Current patient's Healthy Credits balance (patient_credits ledger,
   * via the get_credit_balance() SECURITY DEFINER function).
   * @returns {{ data: number, error: string|null }}
   */
  async getCreditBalance() {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return { data: 0, error: null }
      const { data, error } = await supabase.rpc('get_credit_balance', { p_patient: user.id })
      if (error) return { data: 0, error: error.message }
      return { data: Number(data) || 0, error: null }
    } catch (err) {
      return { data: 0, error: err.message }
    }
  },

  /**
   * Requests a refund-to-credits for a cancelled consultation, only if the
   * cancellation happens ≥ platform_settings.refund_window_business_hours
   * before scheduled_at (mp-refund action=cancel-refund).
   *
   * IMPORTANT: refunds are NEVER automatic (product rule, 2026-07-24). This
   * only creates a pending request (payments.refund_request_status='pending')
   * — no Healthy Credits are issued yet. A super_admin must review it via
   * `approveRefund` / `rejectRefund`. Callers should also call
   * consultationsService.cancel() for the booking status itself — this only
   * handles the financial side.
   */
  async requestCancelRefund(consultationId) {
    try {
      const result = await callEdgeFunction('mp-refund', { action: 'cancel-refund', consultationId })
      return { data: toCamelCase(result), error: null }
    } catch (err) {
      return { data: null, error: err.message }
    }
  },

  /**
   * Super admin approves a pending refund request — issues Healthy Credits
   * and marks the payment/consultation as refunded
   * (mp-refund action=approve-refund).
   */
  async approveRefund(paymentId) {
    try {
      const result = await callEdgeFunction('mp-refund', { action: 'approve-refund', paymentId })
      return { data: toCamelCase(result), error: null }
    } catch (err) {
      return { data: null, error: err.message }
    }
  },

  /**
   * Super admin rejects a pending refund request — no credits issued
   * (mp-refund action=reject-refund).
   */
  async rejectRefund(paymentId, reason) {
    try {
      const result = await callEdgeFunction('mp-refund', { action: 'reject-refund', paymentId, reason: reason ?? null })
      return { data: toCamelCase(result), error: null }
    } catch (err) {
      return { data: null, error: err.message }
    }
  },

  /**
   * Patient asks to convert an already-approved Healthy Credits refund into
   * a real Mercado Pago refund (mp-refund action=request-mp-conversion).
   */
  async requestMpConversion(consultationId) {
    try {
      const result = await callEdgeFunction('mp-refund', { action: 'request-mp-conversion', consultationId })
      return { data: toCamelCase(result), error: null }
    } catch (err) {
      return { data: null, error: err.message }
    }
  },

  /**
   * Super admin approves a pending "convert credits → MP refund" request
   * (mp-refund action=approve-mp-conversion).
   */
  async approveMpConversion(paymentId) {
    try {
      const result = await callEdgeFunction('mp-refund', { action: 'approve-mp-conversion', paymentId })
      return { data: toCamelCase(result), error: null }
    } catch (err) {
      return { data: null, error: err.message }
    }
  },
}
