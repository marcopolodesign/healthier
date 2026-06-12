import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Star, SealCheck } from '@phosphor-icons/react'
import { consultationsService } from '../../services/consultationsService'
import { reviewsService } from '../../services/reviewsService'
import { toast } from '../../components/Toast'

const RATING_LABELS = ['Muy mala', 'Mala', 'Regular', 'Buena', '¡Excelente!']

/**
 * Post-consultation review page — /paciente/consulta/review/:consultationId
 *
 * Mirrors mobile consultation/review.tsx.
 * Shows: validation code card, professional card with SealCheck, 5-star picker,
 * optional comment textarea, submit CTA, skip link, and a done state.
 */
export default function ConsultationReview({ profile }) {
  const { consultationId } = useParams()
  const navigate = useNavigate()

  const [consultation, setConsultation] = useState(null)
  const [loadingConsultation, setLoadingConsultation] = useState(true)
  const [validationCode, setValidationCode] = useState(null)

  const [rating, setRating] = useState(0)
  const [hovered, setHovered] = useState(0)
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  // Load consultation + validation code on mount
  useEffect(() => {
    if (!consultationId) return
    setLoadingConsultation(true)

    Promise.all([
      consultationsService.getById(consultationId),
      consultationsService.getValidationCode(consultationId).catch(() => null),
    ])
      .then(([cons, code]) => {
        setConsultation(cons)
        setValidationCode(code)
      })
      .catch(() => {
        toast.error('No se pudo cargar la consulta')
        navigate('/paciente/consultas')
      })
      .finally(() => setLoadingConsultation(false))
  }, [consultationId])

  const activeRating = hovered || rating
  const proName = consultation?.professional?.fullName ?? 'Profesional'
  const proAvatar = consultation?.professional?.avatarUrl ?? null
  const proSpecialty = consultation?.professional?.professionalProfiles?.[0]?.specialty ?? null

  const handleSubmit = async () => {
    if (!rating) return
    setSubmitting(true)
    try {
      // Write review
      await reviewsService.create({
        consultationId,
        patientId: profile?.id,
        professionalId: consultation?.professionalId,
        rating,
        comment: comment.trim() || null,
      })
      // Finalize consultation (patient side) — non-blocking
      if (consultationId) {
        consultationsService.finalize(consultationId, 'patient').catch(() => {})
      }
    } catch {
      // Non-blocking — proceed to done state regardless
    } finally {
      setSubmitting(false)
      setDone(true)
    }
  }

  const handleSkip = () => navigate('/paciente/consultas')

  // ── Loading ──────────────────────────────────────────────
  if (loadingConsultation) {
    return (
      <div className="absolute inset-0 bg-bg-primary flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  // ── Done state ───────────────────────────────────────────
  if (done) {
    return (
      <div className="absolute inset-0 bg-bg-primary flex flex-col items-center justify-center px-6 text-center">
        <div className="w-24 h-24 rounded-full bg-amber-100 flex items-center justify-center mb-6">
          <Star className="w-10 h-10 text-amber-500" weight="fill" />
        </div>
        <h1 className="text-[28px] text-text-primary mb-2">¡Gracias por tu reseña!</h1>
        <p className="text-[15px] text-text-secondary leading-relaxed mb-10 max-w-xs">
          Tu opinión ayuda a otros pacientes a elegir mejor.
        </p>
        <button
          onClick={() => navigate('/paciente/consultas')}
          className="px-8 py-4 rounded-full bg-brand text-white font-bold text-[16px] hover:bg-brand-hover active:scale-95 transition-all shadow-md"
        >
          Volver al inicio
        </button>
      </div>
    )
  }

  // ── Review form ──────────────────────────────────────────
  return (
    <div className="absolute inset-0 bg-bg-primary overflow-y-auto scrollbar-hide">
      <div className="max-w-lg mx-auto px-6 pt-8 pb-16">

        {/* Validation code card */}
        {validationCode && (
          <div className="bg-bg-secondary border border-border-default rounded-[24px] p-5 mb-6 text-center shadow-sm">
            <p className="text-[11px] font-bold text-text-tertiary uppercase tracking-widest mb-1">
              Código de validación
            </p>
            <p className="text-[42px] font-black text-brand tracking-[0.2em] leading-none mb-2">
              {validationCode}
            </p>
            <p className="text-[13px] text-text-secondary leading-relaxed">
              Si el profesional te lo pide, dáselo para finalizar la consulta.
            </p>
          </div>
        )}

        {/* Professional card */}
        <div className="bg-bg-secondary border border-border-default rounded-[24px] p-4 mb-8 flex items-center gap-4 shadow-sm">
          {proAvatar
            ? <img src={proAvatar} alt={proName} className="w-16 h-16 rounded-full object-cover flex-shrink-0 border-2 border-white shadow-sm" />
            : (
              <div className="w-16 h-16 rounded-full bg-brand-muted flex items-center justify-center flex-shrink-0 border-2 border-white shadow-sm">
                <span className="text-[26px] font-black text-brand">{proName.charAt(0)}</span>
              </div>
            )
          }
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="font-bold text-[15px] text-text-primary truncate">{proName}</span>
              <SealCheck className="w-4 h-4 text-brand flex-shrink-0" weight="duotone" />
            </div>
            {proSpecialty && (
              <p className="text-[13px] text-text-secondary">{proSpecialty}</p>
            )}
            <p className="text-[11px] font-semibold text-emerald-600 mt-1">Videoconsulta finalizada</p>
          </div>
        </div>

        {/* Star rating */}
        <h2 className="text-[22px] text-text-primary mb-4">¿Cómo fue tu consulta?</h2>
        <div className="flex justify-center gap-2 mb-3">
          {[1, 2, 3, 4, 5].map(n => (
            <button
              key={n}
              onClick={() => { setRating(n); setHovered(0) }}
              onMouseEnter={() => setHovered(n)}
              onMouseLeave={() => setHovered(0)}
              className="p-1 transition-transform hover:scale-110 active:scale-95"
            >
              <Star
                className="w-10 h-10"
                style={{ color: '#F59E0B' }}
                weight={n <= activeRating ? 'fill' : 'regular'}
              />
            </button>
          ))}
        </div>
        {activeRating > 0 && (
          <p className="text-center text-[14px] font-bold text-amber-500 mb-6">
            {RATING_LABELS[activeRating - 1]}
          </p>
        )}
        {activeRating === 0 && <div className="mb-6" />}

        {/* Comment */}
        <h2 className="text-[22px] text-text-primary mb-3">
          Comentario{' '}
          <span className="text-[16px] font-light text-text-tertiary">(opcional)</span>
        </h2>
        <textarea
          value={comment}
          onChange={e => setComment(e.target.value)}
          rows={4}
          placeholder="Contá tu experiencia con el profesional…"
          className="w-full bg-bg-secondary border border-border-default rounded-[20px] px-4 py-3 text-[15px] font-medium text-text-primary placeholder-text-tertiary outline-none focus:border-brand resize-none mb-8 transition-colors"
        />

        {/* Submit CTA */}
        <button
          onClick={handleSubmit}
          disabled={rating === 0 || submitting}
          className={`w-full py-4 rounded-full font-bold text-[16px] transition-all shadow-md mb-4 ${
            rating > 0 && !submitting
              ? 'bg-brand text-white hover:bg-brand-hover active:scale-95'
              : 'bg-gray-100 text-gray-400 cursor-not-allowed'
          }`}
        >
          {submitting ? 'Enviando...' : 'Enviar reseña'}
        </button>

        {/* Skip link */}
        <button
          onClick={handleSkip}
          className="w-full text-center text-[14px] text-text-tertiary font-medium py-2 hover:text-text-secondary transition-colors"
        >
          Omitir
        </button>
      </div>
    </div>
  )
}
