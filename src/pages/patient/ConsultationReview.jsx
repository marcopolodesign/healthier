import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Star, SealCheck, Warning, CheckCircle, Pill, CircleNotch } from '@phosphor-icons/react'
import { supabase } from '../../lib/supabase'
import { estadoDeReceta, estaCerrada } from '../../lib/cierreConsulta'
import { consultationsService } from '../../services/consultationsService'
import { reviewsService } from '../../services/reviewsService'
import { toast } from '../../components/Toast'
import { inicialesDe } from '../../lib/format'

const RATING_LABELS = ['Muy mala', 'Mala', 'Regular', 'Buena', '¡Excelente!']

/**
 * La pantalla de cierre del paciente — /paciente/consulta/review/:consultationId
 *
 * UNA sola, a la que cae cuando el profesional finaliza la consulta (`closing`) y
 * que se queda hasta que el paciente decida irse:
 *
 *  1. "Tu consulta finalizó", con el nombre del profesional.
 *  2. Calificarlo (estrellas + comentario opcional; se puede omitir).
 *  3. El estado de la receta en vivo: "Estamos preparando tu receta" mientras la
 *     consulta está en `closing`, y "Tu receta está lista · Ver resumen" cuando
 *     pasa a `completed`.
 *
 * Nada de acá navega al inicio por su cuenta: antes el paciente veía "Preparando
 * tu receta" en la llamada y, al completarse, lo mandaban al inicio sin haber
 * calificado (Mateo, 2026-10-13). Sólo "Volver al inicio" / "Omitir" llevan allá.
 * Calificar es opcional (decisión por defecto).
 *
 * Espejo de mobile `app/consultation/review.tsx`.
 */
export default function ConsultationReview({ profile }) {
  const { consultationId } = useParams()
  const navigate = useNavigate()

  const [consultation, setConsultation] = useState(null)
  const [loadingConsultation, setLoadingConsultation] = useState(true)

  const [rating, setRating] = useState(0)
  const [hovered, setHovered] = useState(0)
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  // Load consultation on mount
  useEffect(() => {
    if (!consultationId) return
    setLoadingConsultation(true)

    consultationsService.getById(consultationId)
      .then(setConsultation)
      .catch(() => {
        toast.error('No se pudo cargar la consulta')
        navigate('/paciente/consultas')
      })
      .finally(() => setLoadingConsultation(false))
  }, [consultationId])

  // Estado en vivo: Realtime, más un sondeo y un refresco al volver a la pestaña.
  // Los sockets se caen en silencio (pestaña dormida, sin red); sin el respaldo,
  // "Estamos preparando tu receta" quedaba clavado para siempre.
  useEffect(() => {
    if (!consultationId) return
    let vivo = true
    const refrescar = () => {
      consultationsService.getById(consultationId)
        .then(c => { if (vivo && c) setConsultation(c) })
        .catch(() => {})
    }
    const ch = supabase
      .channel(`cierre-estado-${consultationId}-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'consultations', filter: `id=eq.${consultationId}`,
      }, ({ new: fila }) => {
        if (vivo && fila?.status) setConsultation(prev => (prev ? { ...prev, status: fila.status, completedAt: fila.completed_at ?? prev.completedAt } : prev))
      })
      .subscribe()
    const alVolver = () => { if (document.visibilityState === 'visible') refrescar() }
    document.addEventListener('visibilitychange', alVolver)
    const iv = setInterval(() => { if (!estaCerrada(statusRef.current)) refrescar() }, 8000)
    return () => {
      vivo = false
      clearInterval(iv)
      document.removeEventListener('visibilitychange', alVolver)
      supabase.removeChannel(ch)
    }
  }, [consultationId])

  const statusRef = useRef(null)
  statusRef.current = consultation?.status
  const receta = estadoDeReceta(consultation?.status)
  const termino = consultation?.status === 'closing' || consultation?.status === 'completed'
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
      // Mientras el profesional cierra no se toca el estado: el cierre es suyo.
      if (consultationId && consultation?.status !== 'closing') {
        consultationsService.finalize(consultationId, 'patient').catch(() => {})
      }
    } catch {
      // Non-blocking — proceed to done state regardless
    } finally {
      setSubmitting(false)
      setDone(true)
    }
  }

  // El ÚNICO camino al inicio de toda esta pantalla: sólo cuelga de botones.
  const volverAlInicio = () => navigate('/paciente/dashboard')
  const verResumen = () => navigate(`/paciente/consulta/resumen/${consultationId}`)

  // ── Loading ──────────────────────────────────────────────
  if (loadingConsultation) {
    return (
      <div className="absolute inset-0 bg-bg-primary flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  // ── Cancellation state — professional never joined the call ────────────────
  // (status auto-set to 'no_show' by expire-stale-appointments cron, the patient's
  // "Marcar profesional ausente" button, or the patient hanging up before the
  // professional's Daily.co participant ever joined.)
  if (consultation?.status === 'no_show') {
    const refundPending = consultation?.refundPending || consultation?.paymentStatus === 'paid'
    return (
      <div className="absolute inset-0 bg-bg-primary flex flex-col items-center justify-center px-6 text-center">
        <div className="w-24 h-24 rounded-full bg-red-50 flex items-center justify-center mb-6">
          <Warning className="w-10 h-10 text-red-400" weight="fill" />
        </div>
        <h1 className="text-[28px] text-text-primary mb-2">El profesional no se unió a la consulta</h1>
        <p className="text-[15px] text-text-secondary leading-relaxed mb-4 max-w-xs">
          Lamentamos el inconveniente. Podés reservar un nuevo turno cuando quieras.
        </p>
        {refundPending && (
          <p className="text-[13px] text-text-tertiary leading-relaxed mb-6 max-w-xs">
            Como ya habías pagado esta consulta, nuestro equipo está revisando tu reembolso.
          </p>
        )}
        <button
          onClick={() => navigate('/paciente/consultas')}
          className="px-8 py-4 rounded-full bg-brand text-white font-bold text-[16px] hover:bg-brand-hover active:scale-95 transition-all shadow-md"
        >
          Volver a mis consultas
        </button>
      </div>
    )
  }

  // ── Review form ──────────────────────────────────────────
  return (
    <div className="absolute inset-0 bg-bg-primary overflow-y-auto scrollbar-hide">
      <div className="max-w-lg mx-auto px-6 pt-8 pb-16">

        {/* Acá había una tarjeta con el código de validación. Se sacó a pedido
            de Mateo (2026-07-30): esta pantalla es posterior a la consulta, así
            que mostrarle el código al paciente cuando ya terminó no sirve para
            nada — y encima ocupaba el lugar más visible de la reseña. El código
            se le sigue mostrando *durante* la llamada (VideoCall), que es cuando
            el profesional se lo puede llegar a pedir. */}

        {/* 1 · Tu consulta finalizó */}
        <div className="text-center mb-6">
          <CheckCircle className="w-12 h-12 text-emerald-500 mx-auto mb-3" weight="fill" />
          <h1 className="text-[28px] text-text-primary mb-1">
            {termino || !consultation?.status ? 'Tu consulta finalizó' : 'Saliste de la consulta'}
          </h1>
          <p className="text-[15px] text-text-secondary">con {proName}</p>
        </div>

        {/* 3 · La receta, en vivo — se actualiza sola. */}
        {receta && (
          <div
            data-testid={`receta-${receta}`}
            className="flex items-start gap-3 bg-brand-muted border border-border-default rounded-[24px] p-4 mb-4"
          >
            <div className="w-10 h-10 rounded-full bg-bg-secondary flex items-center justify-center flex-shrink-0">
              {receta === 'preparando'
                ? <CircleNotch className="w-5 h-5 text-brand animate-spin" />
                : <Pill className="w-5 h-5 text-brand" weight="fill" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-[15px] text-text-primary">
                {receta === 'preparando' ? 'Estamos preparando tu receta' : 'Tu receta está lista'}
              </p>
              <p className="text-[13px] text-text-secondary leading-snug mt-0.5">
                {receta === 'preparando'
                  ? 'Tu profesional está terminando de cargar los datos de la consulta. Esta pantalla se actualiza sola.'
                  : 'Ya podés ver el resumen de la consulta y tu receta.'}
              </p>
              {receta === 'lista' && (
                <button
                  onClick={verResumen}
                  className="mt-2 px-4 py-2 rounded-full bg-brand text-white text-[13px] font-semibold hover:bg-brand-hover active:scale-95 transition-all"
                >
                  Ver resumen
                </button>
              )}
            </div>
          </div>
        )}

        {/* Professional card */}
        <div className="bg-bg-secondary border border-border-default rounded-[24px] p-4 mb-8 flex items-center gap-4 shadow-sm">
          {proAvatar
            ? <img src={proAvatar} alt={proName} className="w-16 h-16 rounded-full object-cover flex-shrink-0 border-2 border-white shadow-sm" />
            : (
              <div className="w-16 h-16 rounded-full bg-brand-muted flex items-center justify-center flex-shrink-0 border-2 border-white shadow-sm">
                <span className="text-[26px] font-black text-brand">{inicialesDe(proName)}</span>
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
            <p className="text-[11px] font-semibold text-emerald-600 mt-1">Videoconsulta</p>
          </div>
        </div>

        {done ? (
          <div className="text-center py-4" data-testid="gracias">
            <Star className="w-10 h-10 text-amber-500 mx-auto mb-2" weight="fill" />
            <h2 className="text-[22px] text-text-primary mb-1">¡Gracias por tu reseña!</h2>
            <p className="text-[14px] text-text-secondary">Tu opinión ayuda a otros pacientes a elegir mejor.</p>
          </div>
        ) : (
          <>
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
          </>
        )}

        {/* Salida explícita: el paciente decide cuándo irse. */}
        {done ? (
          <button
            onClick={volverAlInicio}
            className="w-full mt-6 py-4 rounded-full bg-brand text-white font-bold text-[16px] hover:bg-brand-hover active:scale-95 transition-all shadow-md"
          >
            Volver al inicio
          </button>
        ) : (
          <button
            onClick={volverAlInicio}
            className="w-full text-center text-[14px] text-text-tertiary font-medium py-2 hover:text-text-secondary transition-colors"
          >
            Omitir y volver al inicio
          </button>
        )}
      </div>
    </div>
  )
}
