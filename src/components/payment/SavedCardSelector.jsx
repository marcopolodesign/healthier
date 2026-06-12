/**
 * SavedCardSelector.jsx
 *
 * Lists the current patient's saved Mercado Pago cards and lets them:
 *   - Select one as the payment method for the current flow
 *   - Delete a saved card
 *   - Add a new card inline via MPCardHolder
 *
 * Props:
 *   selectedCardId   {string|null}       Currently selected payment_methods.id
 *   onCardSelected   {(id: string) => void}  Called when a card is selected
 *   publicKey        {string}            MP public key (pass down from parent)
 *   payerEmail       {string}            Pre-fills MPCardHolder for new cards
 */

import React, { useEffect, useState, useCallback } from 'react'
import {
  CreditCard,
  Plus,
  Trash,
  CheckCircle,
  Warning,
  SpinnerGap,
} from '@phosphor-icons/react'
import { mpService } from '../../services/mpService'
import MPCardHolder from './MPCardHolder'

// ── Brand icon map — map MP payment_method_id strings to readable labels ─────
const BRAND_LABEL = {
  visa: 'Visa',
  master: 'Mastercard',
  amex: 'American Express',
  naranja: 'Naranja',
  cabal: 'Cabal',
  diners: 'Diners',
  debvisa: 'Visa Débito',
  debmaster: 'Mastercard Débito',
  debcabal: 'Cabal Débito',
}

function brandLabel(raw) {
  if (!raw) return 'Tarjeta'
  return BRAND_LABEL[raw.toLowerCase()] ?? raw.charAt(0).toUpperCase() + raw.slice(1)
}

// ── Single card row ───────────────────────────────────────────────────────────
function CardRow({ card, selected, onSelect, onDelete, deleting }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(card.id)}
      className={[
        'w-full flex items-center gap-3 px-4 py-3 rounded-2xl border transition-all text-left',
        selected
          ? 'border-[#7CB38B] bg-[#7CB38B]/8 shadow-[0_0_0_2px_rgba(124,179,139,0.25)]'
          : 'border-[#D8D4CE] bg-white hover:border-[#7CB38B]/50 hover:bg-[#F6F5F0]',
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
        disabled={deleting}
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
export default function SavedCardSelector({
  selectedCardId,
  onCardSelected,
  publicKey,
  payerEmail = '',
}) {
  const [cards, setCards] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [showAddCard, setShowAddCard] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [deleteError, setDeleteError] = useState(null)

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

  // ── New card saved ─────────────────────────────────────────────────────────
  const handleNewCardSaved = async (cardData) => {
    setShowAddCard(false)
    // Reload from DB to get the persisted row with its UUID
    await loadCards()
    // Select the freshly-added card (it will be first after reload)
    // The reload triggers auto-select via the loadCards callback
    if (cardData?.id) {
      onCardSelected?.(cardData.id)
    }
  }

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
            />
          ))}
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
          onClick={() => setShowAddCard(true)}
          className="w-full flex items-center gap-2 px-4 py-3 rounded-2xl border border-dashed border-[#D8D4CE] text-[#6B6560] hover:border-[#7CB38B]/60 hover:text-[#7CB38B] hover:bg-[#7CB38B]/5 transition-all"
        >
          <Plus size={16} />
          <span className="text-sm font-medium">Agregar nueva tarjeta</span>
        </button>
      ) : (
        <div className="border border-[#D8D4CE] rounded-2xl p-4 bg-white space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-[#2D2A26]">Nueva tarjeta</p>
            <button
              type="button"
              onClick={() => setShowAddCard(false)}
              className="text-xs text-[#6B6560] hover:text-[#2D2A26] underline underline-offset-2 transition-colors"
            >
              Cancelar
            </button>
          </div>

          {publicKey ? (
            <MPCardHolder
              publicKey={publicKey}
              amount={1}
              payerEmail={payerEmail}
              submitLabel="Guardar tarjeta"
              onSuccess={handleNewCardSaved}
              onError={(err) => {
                // Surface error inline — MPCardHolder already shows its own banner
                console.error('[SavedCardSelector] save card error:', err)
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
}
