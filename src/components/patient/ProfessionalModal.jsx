import { Star, SealCheck, VideoCamera, MapPin, CalendarPlus, X, ChatCircle, Phone, Lightning } from '@phosphor-icons/react'
import { SPECIALTY_LABELS } from '../../lib/verticals'
import PatientSheet from './PatientSheet'

/**
 * ProfessionalModal
 *
 * Web equivalent of mobile's ProfessionalBottomSheet.
 * Renders as a PatientSheet (bottom sheet on mobile, centered modal on desktop).
 *
 * Props
 *   pro       – professional record (from professionalService.search())
 *   open      – boolean
 *   onClose   – close callback
 *   modality  – 'video' | 'presencial' — determines price to highlight
 *   onBook    – called when "Reservar ahora" is pressed; receives (pro)
 *   vertical  – the vertical object { nombre, color, bg, icon: Icon } (optional, for accent)
 */
export default function ProfessionalModal({ pro, open, onClose, modality, onBook, vertical }) {
  if (!pro) return null

  const name    = pro.profiles?.fullName || 'Profesional'
  const avatar  = pro.profiles?.avatarUrl || null
  const bio     = pro.profiles?.bio || pro.bio || null
  const rating  = pro.averageRating ?? null
  const reviews = pro.totalReviews   ?? 0
  const label   = SPECIALTY_LABELS[pro.specialty] ?? pro.specialty ?? '—'
  const phone   = pro.profiles?.phone || null

  const price = modality === 'presencial'
    ? (pro.pricePresencial ?? pro.priceVideo ?? null)
    : (pro.priceVideo ?? pro.pricePresencial ?? null)

  const accentColor = vertical?.color ?? 'var(--color-brand)'
  const accentBg    = vertical?.bg    ?? 'var(--color-brand-muted)'
  const VertIcon    = vertical?.icon  ?? null
  const initial     = name.charAt(0).toUpperCase()

  // First + last initial for the avatar fallback (matches mobile pattern)
  const parts    = name.trim().split(/\s+/)
  const initials = (parts.length >= 2
    ? parts[0][0] + parts[parts.length - 1][0]
    : parts[0].substring(0, 2)
  ).toUpperCase()

  const handleBook = () => {
    onClose()
    onBook?.(pro)
  }

  const handleWhatsApp = () => {
    if (!phone) return
    const num = phone.replace(/\D/g, '')
    window.open(`https://wa.me/${num}`, '_blank', 'noopener')
  }

  const handlePhone = () => {
    if (!phone) return
    window.location.href = `tel:${phone}`
  }

  return (
    <PatientSheet open={open} onClose={onClose} maxWidth="max-w-md">
      {/* Header */}
      <div className="px-6 pt-2 pb-4 flex-shrink-0">
        <div className="flex items-start gap-4 mt-2">
          {/* Avatar */}
          <div className="relative shrink-0">
            {avatar
              ? (
                <img
                  src={avatar}
                  alt={name}
                  className="w-[72px] h-[72px] rounded-full object-cover border-2 border-white shadow-md"
                />
              ) : (
                <div
                  className="w-[72px] h-[72px] rounded-full border-2 border-white shadow-md flex items-center justify-center text-[26px] font-serif"
                  style={{ backgroundColor: accentBg, color: accentColor }}
                >
                  {initials}
                </div>
              )}
            {pro.isVerified && (
              <SealCheck
                className="absolute -bottom-0.5 -right-0.5 w-5 h-5 text-brand"
                weight="fill"
              />
            )}
          </div>

          {/* Name + specialty */}
          <div className="flex-1 min-w-0 pt-1">
            {/* Vertical badge */}
            {VertIcon && (
              <div
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold mb-1.5"
                style={{ backgroundColor: accentBg, color: accentColor }}
              >
                <VertIcon className="w-3 h-3" />
                {vertical.nombre}
              </div>
            )}
            <h3 className="text-[20px] font-bold text-text-primary leading-tight tracking-tight truncate">{name}</h3>
            <p className="text-[13px] text-text-tertiary mt-0.5 truncate">{label}</p>

            {/* Rating */}
            {rating != null && (
              <div className="flex items-center gap-1.5 mt-1.5">
                <div className="flex items-center gap-1 bg-amber-50 border border-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full text-[11px]">
                  <Star className="w-3 h-3 fill-amber-500 text-amber-500" />
                  <span className="font-bold">{Number(rating).toFixed(1)}</span>
                </div>
                {reviews > 0 && (
                  <span className="text-[11px] text-text-muted font-medium">
                    {reviews} {reviews === 1 ? 'reseña' : 'reseñas'}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Walk-in available badge */}
          {pro.isAvailableWalkin && (
            <div className="flex items-center gap-1 bg-green-50 border border-green-200 text-green-700 px-2 py-0.5 rounded-full text-[10px] font-semibold mt-2 self-start">
              <Lightning className="w-2.5 h-2.5" weight="fill" />
              Disponible ahora
            </div>
          )}

          {/* Close */}
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-bg-primary border border-border-default flex items-center justify-center hover:bg-gray-100 transition-colors shrink-0 mt-0.5"
          >
            <X className="w-4 h-4 text-text-secondary" />
          </button>
        </div>
      </div>

      {/* Divider */}
      <div className="h-px bg-border-default mx-6 flex-shrink-0" />

      {/* Scrollable body */}
      <div className="px-6 py-5 overflow-y-auto flex-1 scrollbar-hide space-y-5">

        {/* Bio */}
        {bio && (
          <div>
            <p className="text-[11px] font-bold text-text-muted uppercase tracking-widest mb-1.5">Sobre el profesional</p>
            <p className="text-[14px] text-text-secondary leading-relaxed">{bio}</p>
          </div>
        )}

        {/* Price card */}
        {price != null && (
          <div
            className="rounded-[20px] px-4 py-3 flex items-center justify-between"
            style={{ backgroundColor: accentBg }}
          >
            <div className="flex items-center gap-2">
              {modality === 'presencial'
                ? <MapPin className="w-4 h-4" style={{ color: accentColor }} />
                : <VideoCamera className="w-4 h-4" style={{ color: accentColor }} />}
              <span className="text-[13px] font-semibold" style={{ color: accentColor }}>
                {modality === 'presencial' ? 'Consulta presencial' : 'Videoconsulta'}
              </span>
            </div>
            <span className="text-[18px] font-bold" style={{ color: accentColor }}>
              ${Number(price).toLocaleString('es-AR')}
            </span>
          </div>
        )}

        {/* Quick contact row */}
        <div>
          <p className="text-[11px] font-bold text-text-muted uppercase tracking-widest mb-2">Contacto rápido</p>
          <div className="flex gap-2">
            <button
              onClick={handleWhatsApp}
              disabled={!phone}
              className="flex-1 flex flex-col items-center gap-1.5 py-3.5 rounded-[16px] border border-border-default bg-bg-primary text-text-secondary hover:bg-bg-secondary transition-colors disabled:opacity-40 text-[11px] font-semibold"
            >
              <ChatCircle className="w-5 h-5 text-green-500" />
              WhatsApp
            </button>
            <button
              onClick={handlePhone}
              disabled={!phone}
              className="flex-1 flex flex-col items-center gap-1.5 py-3.5 rounded-[16px] border border-border-default bg-bg-primary text-text-secondary hover:bg-bg-secondary transition-colors disabled:opacity-40 text-[11px] font-semibold"
            >
              <Phone className="w-5 h-5 text-text-secondary" />
              Llamar
            </button>
          </div>
        </div>
      </div>

      {/* Primary CTA */}
      <div className="px-6 pb-8 pt-3 flex-shrink-0">
        <button
          onClick={handleBook}
          className="w-full py-4 rounded-[20px] font-bold text-[16px] text-white flex items-center justify-center gap-2 active:scale-95 transition-transform"
          style={{ backgroundColor: accentColor }}
        >
          <CalendarPlus className="w-5 h-5" />
          Reservar ahora
        </button>
      </div>
    </PatientSheet>
  )
}
