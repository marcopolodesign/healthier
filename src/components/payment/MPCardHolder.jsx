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
 *   amount      {number}            Monto en ARS que el brick usa SÓLO para pedir cuotas —
 *                                   nunca es lo que se cobra. Se clampea a
 *                                   MP_MONTO_MINIMO_ARS (lib/mercadoPago.js).
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

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { CardPayment, initMercadoPago } from '@mercadopago/sdk-react'
import { CheckCircle, Warning } from '@phosphor-icons/react'
import { mpService } from '../../services/mpService'
import { MP_MONTO_MINIMO_ARS, MP_MONTO_TOKENIZACION_ARS } from '../../lib/mercadoPago'

// ─── Design-token colours consumed as CSS custom variables ────────────────────
// bg-primary  : #F6F5F0   (--color-bg-primary)
// bg-surface  : #FFFFFF   (--color-bg-surface)
// text-primary: #2D2A26   (--color-text-primary)
// brand       : #7CB38B   (--color-brand / sage)
// border      : #D8D4CE   (--color-border-default)

export default function MPCardHolder({
  publicKey,
  amount = MP_MONTO_MINIMO_ARS,
  payerEmail = '',
  submitLabel = 'Guardar tarjeta',
  mode = 'save',
  onSuccess,
  onError,
}) {
  const [brickReady, setBrickReady] = useState(false)
  const [saving, setSaving] = useState(false)
  /**
   * El Brick no se monta hasta que su contenedor está REALMENTE en pantalla.
   *
   * Es la segunda mitad de la misma lección que el `display: none` (ver el
   * comentario grande más abajo): Mercado Pago pide que, al renderizar el Brick,
   * su contenedor ya esté renderizado en pantalla, y WebKit es el que aplica esa
   * regla en serio — los iframes de los campos sensibles no se attachean si el
   * contenedor no está visible, y después ya no aparecen.
   *
   * `display: none` era una forma de incumplirlo. Estar fuera de la pantalla es
   * otra, y es la que rompía el perfil: ahí el Brick vive dentro de
   * `PatientSheet`, que en mobile entra con `animate-slide-up-spring` desde
   * `translateY(100%)` — o sea que se montaba mientras el contenedor todavía
   * estaba fuera del viewport. En on-demand el mismo componente anda porque se
   * monta inline, en una página ya pintada y quieta.
   *
   * Se resuelve acá adentro y no en cada pantalla a propósito: cualquier lugar
   * que monte el Brick hereda la garantía sin tener que saber nada de esto.
   */
  const contenedorRef = useRef(null)
  const [contenedorVisible, setContenedorVisible] = useState(false)
  const [savedCard, setSavedCard] = useState(null) // { lastFour, cardBrand }
  const [brickError, setBrickError] = useState(null)

  /**
   * Piso del monto que recibe el Brick — NO es lo que se cobra.
   *
   * Por qué existe: `MP_MONTO_MINIMO_ARS` (lib/mercadoPago.js). Sin este clamp,
   * un monto de $1 hace que MP devuelva cero cuotas y el Brick ni siquiera
   * tokenice.
   *
   * Clampear acá es inocuo y a propósito no está en cada pantalla: `mp-payment`
   * deriva el monto de `consultation.price_at_booking` en el servidor y nunca
   * confía en el cliente, así que este número no llega a ningún cobro — sólo
   * sirve para que MP devuelva un plan de cuotas. Con `maxInstallments: 1`
   * tampoco hay cuotas que mostrar mal, y lo que ve el paciente es
   * `submitLabel`, que lleva el precio real.
   *
   * `Number(...) || 0` porque el precio puede llegar como string desde la DB, y
   * un NaN acá dejaría al Brick sin cuotas igual.
   */
  const montoBrick = mode === 'save'
    // Guardar tarjeta no cobra nada: el monto es puro trámite del Brick, así que
    // se usa el mismo valor probado que BIGG Eye en vez de uno inventado.
    ? MP_MONTO_TOKENIZACION_ARS
    : Math.max(Number(amount) || 0, MP_MONTO_MINIMO_ARS)

  /**
   * El Brick se monta UNA sola vez y no se vuelve a crear.
   *
   * Antes el `useMemo` dependía de `payerEmail`, `submitLabel`, `amount` y
   * `mode`: si cualquiera cambiaba de identidad mientras el paciente tipeaba —y
   * el email del perfil puede llegar tarde— React reemplazaba el `<CardPayment>`,
   * MP re-inicializaba sus iframes y **el formulario se vaciaba solo**, dejando
   * los campos en rojo como si el paciente no hubiera cargado nada. BIGG Eye,
   * que anda hace meses contra el mismo Brick, lo memoiza con `[]` por esto.
   *
   * Los valores de arranque se congelan en la primera vez que hay `publicKey`;
   * el handler de submit va por ref para que igual sea siempre el actual y no
   * quede capturado el del primer render.
   */
  const inicialRef = useRef(null)
  if (publicKey && !inicialRef.current) {
    inicialRef.current = { amount: montoBrick, payerEmail, submitLabel }
  }
  const inicial = inicialRef.current

  // initMercadoPago is idempotent — safe to call on every render when publicKey is present
  if (publicKey) {
    initMercadoPago(publicKey, { locale: 'es-AR' })
  }

  useEffect(() => {
    const el = contenedorRef.current
    // Sin IntersectionObserver no se bloquea el pago: se monta como antes.
    if (!el || typeof IntersectionObserver === 'undefined') {
      setContenedorVisible(true)
      return
    }
    const obs = new IntersectionObserver(
      entradas => {
        if (entradas.some(e => e.isIntersecting)) {
          setContenedorVisible(true)
          obs.disconnect()
        }
      },
      // Margen generoso: que en una página larga el Brick ya esté listo cuando
      // el usuario llega scrolleando, en vez de arrancar a cargar recién ahí.
      { rootMargin: '200px' }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

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
      // `mp-save-card` devuelve el JSON crudo de MP ("MP card save failed:
      // {...}"), que como mensaje al paciente no significa nada. Se traduce lo
      // conocido y el resto se muestra igual, nunca en silencio.
      const legible = /card data is invalid|invalid_card|122/.test(error)
        ? 'Los datos de la tarjeta no son válidos. Revisá el número, el vencimiento y el código de seguridad.'
        : /already exists|duplicate/i.test(error)
          ? 'Esa tarjeta ya está guardada en tu cuenta.'
          : error
      setBrickError(legible)
      onError?.(legible)
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

  // El handler siempre el actual, aunque el elemento sea el del primer render.
  const submitRef = useRef(handleSubmit)
  submitRef.current = handleSubmit

  // Memoised to prevent brick re-mount on parent re-renders — ver `inicialRef`.
  const cardBrick = useMemo(
    () => (
      <CardPayment
        initialization={{
          amount: inicial?.amount ?? montoBrick,
          payer: { email: inicial?.payerEmail || undefined },
        }}
        customization={{
          paymentMethods: {
            maxInstallments: 1,
          },
          visual: {
            hideFormTitle: true,
            texts: {
              formSubmit: inicial?.submitLabel ?? submitLabel,
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
            // Decir qué pasó, no "ocurrió un error": los dos casos frecuentes
            // tienen causa conocida y el genérico deja al paciente creyendo que
            // cargó mal la tarjeta.
            const mensajes = {
              missing_payment_information: 'Mercado Pago no puede procesar este monto con esta tarjeta. Probá con otra.',
              invalid_card_number: 'El número de tarjeta no es válido. Revisalo y volvé a intentar.',
            }
            setBrickError(mensajes[err?.cause] ?? 'Ocurrió un error con el formulario de pago. Volvé a intentar.')
            onError?.(err?.message ?? 'brick_error')
          }
        }}
        onSubmit={(cardFormData, additionalData) => submitRef.current(cardFormData, additionalData)}
      />
    ),
    // Sólo `publicKey`: llega async y sin ella el Brick no puede montar. Todo
    // lo demás está congelado a propósito (ver `inicialRef`) — agregar una
    // dependencia acá es volver a vaciarle el formulario al paciente.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [publicKey]
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
    <div ref={contenedorRef} className={`relative ${brickReady ? '' : 'min-h-[320px]'}`}>
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
       *
       * La otra mitad de la regla —no montarlo mientras el contenedor está
       * FUERA de la pantalla— vive arriba, en `contenedorVisible`.
       */}
      <div className={brickReady ? 'opacity-100 transition-opacity' : 'opacity-0 pointer-events-none'}>
        {contenedorVisible ? cardBrick : null}
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
