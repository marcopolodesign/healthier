import { Star, SealCheck, VideoCamera, MapPin, Lightning } from '@phosphor-icons/react'
import { SPECIALTY_LABELS } from '../../lib/verticals'

/**
 * ProfessionalCard
 *
 * Shows a professional's summary inside the BuscarProfesional list.
 * Mirrors mobile's "professional" step card in selecting-service.tsx.
 *
 * Props
 *   pro          – professional record from professionalService.search()
 *   onSelect     – called when the card/button is tapped
 *   isSelected   – highlights card with brand border when true
 *   modality     – 'video' | 'presencial' — determines which price to show
 */
export default function ProfessionalCard({ pro, onSelect, isSelected = false, modality }) {
  const name    = pro.profiles?.fullName || 'Profesional'
  const avatar  = pro.profiles?.avatarUrl || null
  const rating  = pro.averageRating ?? null
  const reviews = pro.totalReviews   ?? 0
  const label   = SPECIALTY_LABELS[pro.specialty] ?? pro.specialty ?? '—'

  // Price: prefer the modality-specific price; fall back to the other one
  const price = modality === 'presencial'
    ? (pro.pricePresencial ?? pro.priceVideo ?? null)
    : (pro.priceVideo ?? pro.pricePresencial ?? null)

  const initial = name.charAt(0).toUpperCase()

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={e => e.key === 'Enter' && onSelect?.()}
      className={`bg-bg-primary rounded-[24px] border p-4 flex gap-4 cursor-pointer transition-all group
        ${isSelected
          ? 'border-brand shadow-[0_0_0_2px_var(--color-brand)]'
          : 'border-border-default shadow-sm hover:border-brand/60'}`}
    >
      {/* Avatar */}
      <div className="shrink-0 relative">
        {avatar
          ? (
            <img
              src={avatar}
              alt={name}
              className="w-16 h-16 rounded-full object-cover border-2 border-white shadow-sm"
            />
          ) : (
            <div className="w-16 h-16 rounded-full border-2 border-white shadow-sm bg-brand-muted flex items-center justify-center text-[22px] font-serif text-brand">
              {initial}
            </div>
          )}
        {/* Verified badge */}
        {pro.isVerified && (
          <SealCheck
            className="absolute -bottom-0.5 -right-0.5 w-5 h-5 text-brand"
            weight="fill"
          />
        )}
      </div>

      {/* Info */}
      <div className="flex-1 flex flex-col justify-center min-w-0">
        <h4 className="font-bold text-[17px] text-text-primary leading-tight truncate">{name}</h4>
        <p className="text-[12px] text-text-tertiary font-medium mt-0.5 truncate">{label}</p>

        {/* Rating row */}
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          {rating != null && (
            <div className="flex items-center gap-1 bg-amber-50 border border-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full text-[11px]">
              <Star className="w-3 h-3 fill-amber-500 text-amber-500" />
              <span className="font-bold">{Number(rating).toFixed(1)}</span>
            </div>
          )}
          {reviews > 0 && (
            <span className="text-[11px] font-medium text-text-muted">
              {reviews} {reviews === 1 ? 'reseña' : 'reseñas'}
            </span>
          )}
        </div>

        {/* Walk-in available badge */}
        {pro.isAvailableWalkin && (
          <div className="flex items-center gap-1 bg-green-50 border border-green-200 text-green-700 px-2 py-0.5 rounded-full text-[10px] font-semibold mt-1.5 self-start">
            <Lightning className="w-2.5 h-2.5 fill-green-600" weight="fill" />
            Disponible ahora
          </div>
        )}

        {/* Price + modality hint */}
        {price != null && (
          <p className="text-[12px] font-semibold text-brand mt-1.5 flex items-center gap-1">
            {modality === 'presencial'
              ? <MapPin className="w-3 h-3" />
              : <VideoCamera className="w-3 h-3" />}
            ${Number(price).toLocaleString('es-AR')}/consulta
          </p>
        )}
      </div>

      {/* CTA pill */}
      <div className="flex items-center justify-center pr-1 shrink-0">
        <div className={`text-[11px] font-bold px-3 py-1.5 rounded-full border transition-colors
          ${isSelected
            ? 'bg-brand text-white border-brand'
            : 'bg-white border-border-default text-text-secondary group-hover:bg-brand group-hover:text-white group-hover:border-brand'}`}>
          {isSelected ? 'Elegido' : 'ELEGIR'}
        </div>
      </div>
    </div>
  )
}
