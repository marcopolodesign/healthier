/**
 * MPCardHolder.jsx
 *
 * Wraps the Mercado Pago CardPayment brick (from @mercadopago/sdk-react).
 * Adapted from BIGG's MPCardHolder.jsx with Healthier's design system.
 *
 * PREREQUISITE: @mercadopago/sdk-react must be installed:
 *   npm install @mercadopago/sdk-react
 *
 * Props:
 *   publicKey   {string}            MP public key — call mpService.getPaymentPlatformConfig() first
 *   amount      {number}            Amount in ARS (required by the brick; we use 1 for card-save flows)
 *   payerEmail  {string}            Pre-fills the payer email field
 *   submitLabel {string}            CTA label inside the brick form
 *   mode        {'save'|'charge'}   'save' (default) persists the card via mp-save-card.
 *                                   'charge' skips persistence and hands the raw single-use
 *                                   token straight to the caller — used when a brand-new card
 *                                   is entered at checkout time and charged directly (spec
 *                                   Sección D3 — MP tokens are single-use, so a token spent on
 *                                   mp-save-card can't also be spent on mp-payment).
 *   onSuccess   {(cardData) => void} 'save' mode: { cardToken, payerEmail, payerDocType, payerDocNumber, lastFour }.
 *                                    'charge' mode: { cardToken, paymentMethodId, payerEmail }.
 *   onError     {(err) => void}     Called with the error message string
 */

import React, { useMemo, useState } from 'react'
import { CardPayment, initMercadoPago } from '@mercadopago/sdk-react'
import { CheckCircle, Warning } from '@phosphor-icons/react'
import { mpService } from '../../services/mpService'

// ─── Design-token colours consumed as CSS custom variables ────────────────────
// bg-primary  : #F6F5F0   (--color-bg-primary)
// bg-surface  : #FFFFFF   (--color-bg-surface)
// text-primary: #2D2A26   (--color-text-primary)
// brand       : #7CB38B   (--color-brand / sage)
// border      : #D8D4CE   (--color-border-default)

export default function MPCardHolder({
  publicKey,
  amount = 1,
  payerEmail = '',
  submitLabel = 'Guardar tarjeta',
  mode = 'save',
  onSuccess,
  onError,
}) {
  const [brickReady, setBrickReady] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedCard, setSavedCard] = useState(null) // { lastFour, cardBrand }
  const [brickError, setBrickError] = useState(null)

  // initMercadoPago is idempotent — safe to call on every render when publicKey is present
  if (publicKey) {
    initMercadoPago(publicKey, { locale: 'es-AR' })
  }

  const handleSubmit = async (cardFormData, additionalData) => {
    if (mode === 'charge') {
      // Hand the single-use token straight to the caller — do NOT also
      // spend it on mp-save-card (MP tokens can only be used once).
      onSuccess?.({
        cardToken: cardFormData.token,
        paymentMethodId: cardFormData.payment_method_id,
        payerEmail: cardFormData.payer?.email ?? payerEmail,
      })
      return
    }

    setSaving(true)
    setBrickError(null)

    const { data, error } = await mpService.saveCard({
      cardToken: cardFormData.token,
      payerEmail: cardFormData.payer?.email ?? payerEmail,
      payerDocType: cardFormData.payer?.identification?.type ?? null,
      payerDocNumber: cardFormData.payer?.identification?.number ?? null,
    })

    setSaving(false)

    if (error) {
      setBrickError(error)
      onError?.(error)
      return
    }

    const result = {
      ...data,
      lastFour: additionalData?.lastFourDigits ?? data?.lastFour ?? '????',
      cardBrand: cardFormData.payment_method_id ?? data?.cardBrand ?? '',
    }

    setSavedCard(result)
    onSuccess?.(result)
  }

  // Memoised to prevent brick re-mount on parent re-renders
  const cardBrick = useMemo(
    () => (
      <CardPayment
        initialization={{
          amount,
          payer: { email: payerEmail || undefined },
        }}
        customization={{
          paymentMethods: {
            maxInstallments: 1,
          },
          visual: {
            hideFormTitle: true,
            texts: {
              formSubmit: submitLabel,
            },
            style: {
              customVariables: {
                // Map to Healthier design tokens
                formBackgroundColor: '#FFFFFF',
                inputBackgroundColor: '#F6F5F0',
                textPrimaryColor: '#2D2A26',
                outlinePrimaryColor: '#7CB38B',   // brand sage
                outlineSecondaryColor: '#7CB38B',
                fontSizeMedium: '16px',
                fontSizeSmall: '14px',
                inputVerticalPadding: '14px',
                formPadding: '0px',
                inputBorderWidth: '1px',
                baseColor: '#7CB38B',
              },
            },
          },
        }}
        onReady={() => setBrickReady(true)}
        onError={(err) => {
          console.error('[MPCardHolder] brick error:', err)
          // Only surface user-relevant errors (not transient init noise)
          if (err?.cause !== 'already_initialized') {
            setBrickError('Ocurrió un error con el formulario de pago.')
            onError?.(err?.message ?? 'brick_error')
          }
        }}
        onSubmit={handleSubmit}
      />
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [publicKey, payerEmail, submitLabel, amount, mode]
  )

  // ── Happy path — card just saved ───────────────────────────────────────────
  if (savedCard) {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <CheckCircle size={48} weight="fill" className="text-[#7CB38B]" />
        <p className="text-[#2D2A26] font-semibold text-lg">
          Tarjeta guardada
        </p>
        <p className="text-[#6B6560] text-sm">
          {savedCard.cardBrand
            ? `${savedCard.cardBrand.toUpperCase()} `
            : ''}
          terminada en{' '}
          <span className="font-mono font-semibold text-[#2D2A26]">
            {savedCard.lastFour}
          </span>
        </p>
      </div>
    )
  }

  return (
    <div className={`relative ${brickReady ? '' : 'min-h-[320px]'}`}>
      {/* Esqueleto ENCIMA del brick, no en su lugar — ver el comentario de abajo. */}
      {!brickReady && (
        <div className="absolute inset-0 z-10 bg-bg-secondary space-y-3 animate-pulse px-1">
          <div className="h-12 bg-[#F6F5F0] rounded-xl" />
          <div className="h-12 bg-[#F6F5F0] rounded-xl" />
          <div className="flex gap-3">
            <div className="h-12 bg-[#F6F5F0] rounded-xl flex-1" />
            <div className="h-12 bg-[#F6F5F0] rounded-xl flex-1" />
          </div>
          <div className="h-12 bg-[#7CB38B]/20 rounded-full" />
        </div>
      )}

      {/* ⚠️ NUNCA `display: none` acá.
       *
       * Los campos sensibles del brick (número, vencimiento, CVV) son iframes
       * que MP inyecta en el DOM. **Safari no agrega al DOM los iframes que
       * nacen con `display: none`**, y cuando después se revelan ya no están
       * disponibles — así que el brick queda a medio inicializar y sus campos
       * se validan como vacíos aunque el paciente los haya completado.
       * (WebKit-only: en Blink el mismo código anda, que es por qué esto solo
       * se veía en Safari.)
       *
       * La doc de MP lo pide explícitamente por otro lado: al renderizar el
       * Brick, su contenedor tiene que estar ya renderizado en pantalla.
       *
       * Por eso se oculta con opacidad, que mantiene el layout y deja que
       * Safari lo attachee y cargue. El esqueleto va absoluto por encima.
       */}
      <div className={brickReady ? 'opacity-100 transition-opacity' : 'opacity-0 pointer-events-none'}>
        {cardBrick}
      </div>

      {/* Inline overlay shown while calling saveCard Edge Function */}
      {saving && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/70 rounded-xl z-10">
          <div className="flex flex-col items-center gap-2">
            <div className="w-8 h-8 border-2 border-[#7CB38B] border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-[#6B6560]">Guardando tarjeta…</span>
          </div>
        </div>
      )}

      {/* Error banner */}
      {brickError && (
        <div className="mt-3 flex items-start gap-2 bg-[#D9534F]/10 border border-[#D9534F]/30 rounded-xl px-4 py-3">
          <Warning size={18} weight="fill" className="text-[#D9534F] mt-0.5 shrink-0" />
          <p className="text-sm text-[#D9534F]">{brickError}</p>
        </div>
      )}
    </div>
  )
}
