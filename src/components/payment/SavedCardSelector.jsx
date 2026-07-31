/**
 * SavedCardSelector.jsx
 *
 * Lists the current patient's saved Mercado Pago cards and lets them:
 *   - Select one as the payment method for the current flow (requires CVV
 *     re-tokenization before charging — MP doesn't allow charging a saved
 *     card_id directly, spec Sección A.3)
 *   - Delete a saved card
 *   - Pay with a brand-new card entered inline (charged directly with the
 *     Brick's own single-use token — not saved, since that token can't also
 *     be spent on mp-save-card)
 *
 * Props:
 *   selectedCardId      {string|null}       Currently selected payment_methods.id
 *   onCardSelected      {(id: string) => void}
 *   publicKey           {string}            MP public key (pass down from parent)
 *   payerEmail          {string}            Pre-fills the brick + used for saved-card charges
 *   amount              {number|null}       Real amount to charge — shown on the new-card brick's own submit button
 *   disabled            {boolean}           Disables selection/CVV while a payment is in flight
 *   onNewCardCharge     {(info) => void}    Fired when a brand-new card's own submit button charges it.
 *                                           info = { cardToken, paymentMethodId, payerEmail }
 *   onAddCardModeChange {(isAdding) => void} Fired when the "add new card" panel opens/closes — the
 *                                           parent should hide its own "Confirmar y Pagar" button while
 *                                           true, since the new-card Brick has its own submit button.
 *
 * Imperative handle (via ref) — used by the parent's "Confirmar y Pagar"
 * button when a SAVED card is selected:
 *   getSavedCardCharge() → Promise<{ cardToken, paymentMethodId, payerEmail, savedCardId }>
 *   Throws a user-readable Error if the CVV is missing/invalid or tokenization fails.
 */

import React, { forwardRef, useEffect, useState, useCallback, useImperativeHandle } from 'react'
import {
  CreditCard,
  Plus,
  Trash,
  CheckCircle,
  Warning,
  SpinnerGap,
  LockKey,
} from '@phosphor-icons/react'
import { createCardToken, initMercadoPago, SecurityCode } from '@mercadopago/sdk-react'
import { mpService } from '../../services/mpService'
import MPCardHolder from './MPCardHolder'
import { brandLabel } from './cardBrand'

// ── Single card row ───────────────────────────────────────────────────────────
function CardRow({ card, selected, onSelect, onDelete, deleting, disabled }) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onSelect(card.id)}
      disabled={disabled}
      className={[
        'w-full flex items-center gap-3 px-4 py-3 rounded-2xl border transition-all text-left',
        selected
          ? 'border-[#7CB38B] bg-[#7CB38B]/8 shadow-[0_0_0_2px_rgba(124,179,139,0.25)]'
          : 'border-[#D8D4CE] bg-white hover:border-[#7CB38B]/50 hover:bg-[#F6F5F0]',
        disabled ? 'opacity-60 cursor-not-allowed' : '',
      ].join(' ')}
    >
      {/* Card icon */}
      <div
        className={[
          'w-9 h-9 rounded-xl flex items-center justify-center shrink-0',
          selected ? 'bg-[#7CB38B]/15' : 'bg-[#F6F5F0]',
        ].join(' ')}
      >
        <CreditCard
          size={18}
          weight="fill"
          className={selected ? 'text-[#7CB38B]' : 'text-[#6B6560]'}
        />
      </div>

      {/* Card info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-[#2D2A26] truncate">
          {brandLabel(card.cardBrand)}
        </p>
        <p className="text-xs text-[#6B6560]">
          •••• •••• •••• {card.lastFour ?? '????'}
        </p>
      </div>

      {/* Selection indicator */}
      {selected && (
        <CheckCircle size={20} weight="fill" className="text-[#7CB38B] shrink-0" />
      )}

      {/* Delete button */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onDelete(card.id)
        }}
        disabled={deleting || disabled}
        className="ml-auto shrink-0 p-1.5 rounded-lg text-[#A8A29E] hover:text-[#D9534F] hover:bg-[#D9534F]/8 transition-colors disabled:opacity-40"
        aria-label="Eliminar tarjeta"
      >
        {deleting
          ? <SpinnerGap size={16} className="animate-spin" />
          : <Trash size={16} />}
      </button>
    </button>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
const SavedCardSelector = forwardRef(function SavedCardSelector({
  selectedCardId,
  onCardSelected,
  publicKey,
  payerEmail = '',
  amount = null,
  disabled = false,
  onNewCardCharge,
  onAddCardModeChange,
}, ref) {
  const [cards, setCards] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [showAddCard, setShowAddCard] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [deleteError, setDeleteError] = useState(null)
  /**
   * El CVV lo tipea el paciente DENTRO de un iframe de Mercado Pago, así que
   * este componente nunca ve el valor — sólo si MP lo considera válido.
   *
   * Antes era un `<input>` normal y el valor se pasaba a `createCardToken`
   * como `securityCode`. Eso NO PODÍA funcionar: el `createCardToken` que
   * exporta la raíz del SDK es el de **Secure Fields** — su tipo de
   * parámetros (`FieldsCardTokenParams`) ni siquiera tiene `securityCode`, y
   * por dentro llama a `instance.fields.createCardToken()`, que lee el código
   * del iframe montado. Con el campo sin montar tiraba antes de pegarle a MP,
   * y por eso no se veía NINGUNA request de tokenización en la pestaña Network.
   */
  const [cvvValido, setCvvValido] = useState(false)
  const [cvvListo, setCvvListo] = useState(false)
  const [cvvError, setCvvError] = useState(null)

  // El campo seguro no monta sin esto. `initMercadoPago` es idempotente.
  if (publicKey) {
    initMercadoPago(publicKey, { locale: 'es-AR' })
  }

  // ── Load saved cards ───────────────────────────────────────────────────────
  const loadCards = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    const { data, error } = await mpService.getMyCards()
    setLoading(false)
    if (error) {
      setLoadError('No pudimos cargar tus tarjetas guardadas.')
      return
    }
    setCards(data ?? [])
    // Auto-select the first card if none is selected and we have cards
    if (!selectedCardId && data?.length > 0) {
      onCardSelected?.(data[0].id)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadCards()
  }, [loadCards])

  // CVV must be re-entered whenever the selection changes — never carry it over
  useEffect(() => {
    setCvvValido(false)
    setCvvListo(false)
    setCvvError(null)
  }, [selectedCardId])

  const setAddCardMode = (next) => {
    setShowAddCard(next)
    onAddCardModeChange?.(next)
  }

  // ── Delete card ────────────────────────────────────────────────────────────
  const handleDelete = async (id) => {
    setDeletingId(id)
    setDeleteError(null)
    const { error } = await mpService.deleteCard(id)
    setDeletingId(null)

    if (error) {
      setDeleteError('No pudimos eliminar la tarjeta. Intentá de nuevo.')
      return
    }

    // Remove from local list; if it was selected, clear selection
    setCards((prev) => prev.filter((c) => c.id !== id))
    if (selectedCardId === id) {
      const remaining = cards.filter((c) => c.id !== id)
      onCardSelected?.(remaining[0]?.id ?? null)
    }
  }

  // ── New card — charged directly with the Brick's own single-use token ─────
  const handleNewCardCharge = (chargeInfo) => {
    setAddCardMode(false)
    onNewCardCharge?.(chargeInfo)
  }

  // ── Imperative API for the parent's "Confirmar y Pagar" button ────────────
  useImperativeHandle(ref, () => ({
    async getSavedCardCharge() {
      const card = cards.find((c) => c.id === selectedCardId)
      if (!card) throw new Error('Seleccioná una tarjeta guardada.')
      if (!publicKey) throw new Error('El pago con tarjeta no está disponible en este momento.')

      // Quién valida el largo del CVV es MP, adentro del iframe: acá no hay
      // valor que medir. `cvvValido` viene de su `onValidityChange`.
      if (!cvvListo) {
        const aun = 'Esperá un segundo a que cargue el campo del código de seguridad.'
        setCvvError(aun)
        throw new Error(aun)
      }
      if (!cvvValido) {
        const falta = 'Ingresá el código de seguridad de la tarjeta.'
        setCvvError(falta)
        throw new Error(falta)
      }

      // Sin `securityCode`: lo toma del campo seguro montado abajo.
      let token
      try {
        token = await createCardToken({ cardId: card.mpCardId })
      } catch (err) {
        // Tragarse el error de MP acá es lo que hacía que esto fuera imposible
        // de diagnosticar: la pantalla decía "revisá el código de seguridad" y
        // la consola quedaba limpia, aunque el problema no tuviera nada que ver
        // con lo que el paciente había tipeado.
        console.error('[SavedCardSelector] createCardToken falló:', err)
        const detalle = err?.message ?? err?.cause?.[0]?.description ?? null
        const legible = detalle && !/undefined|\[object/i.test(detalle)
          ? `No pudimos validar la tarjeta: ${detalle}`
          : 'No pudimos validar la tarjeta. Revisá el código de seguridad.'
        setCvvError(legible)
        throw new Error(legible)
      }
      if (!token?.id) {
        setCvvError('No pudimos validar la tarjeta. Revisá el código de seguridad.')
        throw new Error('No pudimos validar la tarjeta. Revisá el código de seguridad.')
      }
      return {
        cardToken: token.id,
        paymentMethodId: card.cardBrand,
        payerEmail,
        savedCardId: card.id,
      }
    },
  }), [cards, selectedCardId, cvvValido, cvvListo, publicKey, payerEmail])

  const selectedCard = cards.find((c) => c.id === selectedCardId)

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-[#6B6560]">
        <SpinnerGap size={20} className="animate-spin text-[#7CB38B]" />
        <span className="text-sm">Cargando tarjetas…</span>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="flex items-start gap-2 bg-[#D9534F]/10 border border-[#D9534F]/30 rounded-xl px-4 py-3">
        <Warning size={18} weight="fill" className="text-[#D9534F] mt-0.5 shrink-0" />
        <div className="flex-1">
          <p className="text-sm text-[#D9534F]">{loadError}</p>
          <button
            type="button"
            onClick={loadCards}
            className="mt-1 text-xs font-semibold text-[#D9534F] underline underline-offset-2"
          >
            Reintentar
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Saved card list */}
      {cards.length > 0 && (
        <div className="space-y-2">
          {cards.map((card) => (
            <CardRow
              key={card.id}
              card={card}
              selected={card.id === selectedCardId}
              onSelect={(id) => onCardSelected?.(id)}
              onDelete={handleDelete}
              deleting={deletingId === card.id}
              disabled={disabled}
            />
          ))}
        </div>
      )}

      {/* CVV re-tokenization — required to charge a saved card (spec A.3).
        *
        * Se espera a `publicKey` a propósito: el campo seguro monta en un
        * `useEffect` con debounce que NO depende de la key, así que si se
        * renderiza antes de que `initMercadoPago` haya corrido con una key de
        * verdad (llega async) monta contra nada y no se recupera solo. */}
      {selectedCard && !showAddCard && publicKey && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-2xl border border-[#D8D4CE] bg-[#F6F5F0]">
          <LockKey size={18} className="text-[#6B6560] shrink-0" />
          <div className="flex-1 min-w-0">
            <label className="text-xs font-semibold text-[#2D2A26] block mb-1">Código de seguridad (CVV)</label>
            {/* Campo seguro de MP: es un iframe de ellos, no un input nuestro.
              *
              * El `style` de abajo NO es un inline style de React — es config
              * que viaja a MP para pintar el input que vive DENTRO del iframe,
              * al que Tailwind no llega por definición. Mismo caso que los
              * `customVariables` del Brick en MPCardHolder.
              *
              * Vale acá la misma regla que el Brick: nunca `display: none` ni
              * montarlo fuera de pantalla, o WebKit no attachea el iframe. Este
              * bloque se monta/desmonta de verdad (condicional), que sí está
              * bien — lo que rompe es esconderlo con CSS.
              */}
            <div className="w-28 h-[38px] px-3 rounded-lg border border-[#D8D4CE] bg-white flex items-center">
              <SecurityCode
                placeholder="•••"
                style={{
                  height: '100%',
                  width: '100%',
                  fontSize: '14px',
                  color: '#2D2A26',
                  placeholderColor: '#B5AFA8',
                  letterSpacing: '2px',
                }}
                onReady={() => setCvvListo(true)}
                onValidityChange={(estado) => {
                  // MP avisa acá si el largo del código corresponde a la marca
                  // (3 dígitos, 4 en Amex). No hace falta saberlo de este lado:
                  // el único dato que da es `errorMessages` (no hay `isValid`).
                  setCvvValido(!estado?.errorMessages?.length)
                  setCvvError(null)
                }}
                onError={(err) => {
                  console.error('[SavedCardSelector] campo CVV:', err)
                  setCvvError('No pudimos cargar el campo del código de seguridad. Recargá la página.')
                }}
              />
            </div>
          </div>
        </div>
      )}
      {cvvError && (
        <div className="flex items-start gap-2 bg-[#D9534F]/10 border border-[#D9534F]/30 rounded-xl px-3 py-2">
          <Warning size={16} weight="fill" className="text-[#D9534F] mt-0.5 shrink-0" />
          <p className="text-xs text-[#D9534F]">{cvvError}</p>
        </div>
      )}

      {/* Delete error */}
      {deleteError && (
        <div className="flex items-start gap-2 bg-[#D9534F]/10 border border-[#D9534F]/30 rounded-xl px-3 py-2">
          <Warning size={16} weight="fill" className="text-[#D9534F] mt-0.5 shrink-0" />
          <p className="text-xs text-[#D9534F]">{deleteError}</p>
        </div>
      )}

      {/* Add new card — toggle section */}
      {!showAddCard ? (
        <button
          type="button"
          onClick={() => setAddCardMode(true)}
          disabled={disabled}
          className="w-full flex items-center gap-2 px-4 py-3 rounded-2xl border border-dashed border-[#D8D4CE] text-[#6B6560] hover:border-[#7CB38B]/60 hover:text-[#7CB38B] hover:bg-[#7CB38B]/5 transition-all disabled:opacity-50"
        >
          <Plus size={16} />
          <span className="text-sm font-medium">Pagar con una tarjeta nueva</span>
        </button>
      ) : (
        <div className="border border-[#D8D4CE] rounded-2xl p-4 bg-white space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-[#2D2A26]">Nueva tarjeta</p>
            <button
              type="button"
              onClick={() => setAddCardMode(false)}
              className="text-xs text-[#6B6560] hover:text-[#2D2A26] underline underline-offset-2 transition-colors"
            >
              Cancelar
            </button>
          </div>

          {publicKey ? (
            <MPCardHolder
              publicKey={publicKey}
              // El monto real sólo se usa para pedir cuotas; el Brick le pone
              // su propio piso (MP_MONTO_MINIMO_ARS). Lo que se le cobra al
              // paciente lo decide el servidor, y lo que ve es `submitLabel`.
              amount={amount ?? undefined}
              mode="charge"
              payerEmail={payerEmail}
              submitLabel={amount ? `Pagar $${amount.toLocaleString('es-AR')}` : 'Pagar'}
              onSuccess={handleNewCardCharge}
              onError={(err) => {
                console.error('[SavedCardSelector] new card charge error:', err)
              }}
            />
          ) : (
            <div className="flex items-start gap-2 bg-[#E4A853]/10 border border-[#E4A853]/30 rounded-xl px-4 py-3">
              <Warning size={18} weight="fill" className="text-[#E4A853] mt-0.5 shrink-0" />
              <p className="text-sm text-[#6B6560]">
                El método de pago con tarjeta no está disponible en este momento.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {cards.length === 0 && !showAddCard && (
        <p className="text-xs text-[#A8A29E] text-center pt-1">
          No tenés tarjetas guardadas aún.
        </p>
      )}
    </div>
  )
})

export default SavedCardSelector
