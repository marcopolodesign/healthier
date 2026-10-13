import { useState, useEffect, useMemo, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Star, SealCheck, Warning, Pill, FileText, CircleNotch } from '@phosphor-icons/react'
import { supabase } from '../../lib/supabase'
import { contenidoDeCierre, estadoDelCierre, estaCerrada } from '../../lib/cierreConsulta'
import { consultationsService } from '../../services/consultationsService'
import { historiaClinicaService } from '../../services/historiaClinicaService'
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
 *  1. "Gracias por tu consulta", con el profesional (avatar + nombre · especialidad).
 *  2. Lo que dejó el profesional: indicaciones y receta con su contenido. Mientras
 *     está cerrando y no hay nada todavía: "Estamos preparando tus indicaciones y
 *     tu receta"; apenas llegan, Realtime/sondeo las pintan en el lugar. Sin
 *     indicaciones ni receta: "El resumen de tu consulta está listo".
 *  3. Calificar (estrellas; el comentario aparece al elegirlas; se puede omitir).
 *
 * Nada de acá navega al inicio por su cuenta: antes el paciente veía "Preparando
 * tu receta" en la llamada y lo mandaban al inicio sin calificar (Mateo,
 * 2026-10-13). Sólo "Volver al inicio" lleva allá. Calificar es opcional.
 *
 * Espejo de mobile `app/consultation/review.tsx`.
 */
export default function ConsultationReview({ profile }) {
  const { consultationId } = useParams()
  const navigate = useNavigate()

  const [consultation, setConsultation] = useState(null)
  const [encuentro, setEncuentro] = useState(null)
  const [loadingConsultation, setLoadingConsultation] = useState(true)

  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [falloResena, setFalloResena] = useState(false)

  // Estado y contenido en vivo: Realtime, más un sondeo y un refresco al volver a
  // la pestaña. Los sockets se caen en silencio; sin el respaldo "Estamos
  // preparando…" quedaba clavado para siempre.
  const statusRef = useRef(null)
  statusRef.current = consultation?.status

  useEffect(() => {
    if (!consultationId) return
    let vivo = true
    const leer = (inicial = false) => {
      consultationsService.getById(consultationId)
        .then(c => { if (vivo && c) setConsultation(c) })
        .catch(() => {
          if (!inicial) return
          toast.error('No se pudo cargar la consulta')
          navigate('/paciente/consultas')
        })
        .finally(() => { if (inicial && vivo) setLoadingConsultation(false) })
      // Lo clínico aparte: que falle no puede dejar al paciente sin el resto.
      historiaClinicaService.getEncounterByConsultation(consultationId, profile?.id)
        .then(e => { if (vivo) setEncuentro(e) })
        .catch(() => {})
    }
    leer(true)
    const ch = supabase
      .channel(`cierre-estado-${consultationId}-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'consultations', filter: `id=eq.${consultationId}`,
      }, ({ new: fila }) => {
        if (!vivo) return
        if (fila?.status) setConsultation(prev => (prev ? { ...prev, status: fila.status } : prev))
        leer() // al cambiar de estado llegan también las notas de cierre y la receta
      })
      .subscribe()
    const alVolver = () => { if (document.visibilityState === 'visible') leer() }
    document.addEventListener('visibilitychange', alVolver)
    // Mientras cierra se sigue sondeando: el contenido llega de a poco.
    const iv = setInterval(() => {
      const st = statusRef.current
      if (estaCerrada(st) && st !== 'completed') return
      leer()
    }, 8000)
    return () => {
      vivo = false
      clearInterval(iv)
      document.removeEventListener('visibilitychange', alVolver)
      supabase.removeChannel(ch)
    }
  }, [consultationId, profile?.id])

  const proName = consultation?.professional?.fullName ?? 'Profesional'
  const proAvatar = consultation?.professional?.avatarUrl ?? null
  const pp = consultation?.professional?.professionalProfiles
  const especialidad = (Array.isArray(pp) ? pp[0] : pp)?.specialty ?? null
  const proSpecialty = especialidad ? especialidad.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()) : null
  const contenido = useMemo(
    () => contenidoDeCierre(consultation?.closingNotes, encuentro),
    [consultation?.closingNotes, encuentro],
  )
  const seccion = estadoDelCierre(consultation?.status, contenido)
  const resumenListo = consultation?.status === 'completed'

  const handleSubmit = async () => {
    if (!rating || submitting) return
    setSubmitting(true)
    try {
      await reviewsService.create({
        consultationId,
        patientId: profile?.id,
        professionalId: consultation?.professionalId,
        rating,
        comment: comment.trim() || null,
      })
    } catch (err) {
      // Nada de "¡Gracias!" si la reseña no se guardó: el error real y a reintentar.
      toast.error(err?.message || 'No se pudo enviar tu reseña. Probá de nuevo.')
      setFalloResena(true)
      setSubmitting(false)
      return
    }
    // Que el cierre del lado del paciente falle no le quita nada: sigue en silencio.
    // Mientras el profesional cierra no se toca el estado: el cierre es suyo.
    if (consultationId && consultation?.status !== 'closing') {
      consultationsService.finalize(consultationId, 'patient').catch(() => {})
    }
    setSubmitting(false)
    setDone(true)
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
          <p className="text-[14px] text-text-tertiary leading-relaxed mb-6 max-w-xs">
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

  return (
    <div className="absolute inset-0 bg-bg-primary overflow-y-auto scrollbar-hide">
      <div className="max-w-lg mx-auto px-6 pt-8 pb-16">

        {/* 1 · Gracias, con el profesional. Acá había una tarjeta con el código de
            validación (se sacó el 2026-07-30: después de la consulta no sirve). */}
        <div className="text-center mb-8">
          {proAvatar
            ? <img src={proAvatar} alt={proName} className="w-[72px] h-[72px] rounded-full object-cover mx-auto mb-3 border-2 border-white shadow-sm" />
            : (
              <div className="w-[72px] h-[72px] rounded-full bg-brand-muted flex items-center justify-center mx-auto mb-3 border-2 border-white shadow-sm">
                <span className="text-[28px] font-black text-brand">{inicialesDe(proName)}</span>
              </div>
            )
          }
          <h1 className="text-[24px] leading-[28px] text-text-primary mb-1">Gracias por tu consulta</h1>
          <p className="flex items-center justify-center gap-1.5 text-[14px] leading-5 text-text-secondary">
            <span>{proName}{proSpecialty ? ` · ${proSpecialty}` : ''}</span>
            <SealCheck className="w-4 h-4 text-brand flex-shrink-0" weight="duotone" />
          </p>
        </div>

        {/* 2 · Lo que dejó el profesional, en vivo */}
        {seccion === 'preparando' && (
          <div data-testid="cierre-preparando" className="flex items-center gap-3 bg-brand-muted border border-border-default rounded-[24px] p-4 mb-8">
            <CircleNotch className="w-6 h-6 text-brand animate-spin flex-shrink-0" />
            <div className="min-w-0">
              <p className="font-bold text-[16px] leading-snug text-text-primary">Estamos preparando tus indicaciones y tu receta</p>
              <p className="text-[14px] leading-5 text-text-secondary mt-1">Te avisamos cuando estén listas, aunque salgas de acá.</p>
            </div>
          </div>
        )}

        {seccion === 'resumen' && (
          <div data-testid="cierre-resumen" className="flex items-center gap-3 bg-brand-muted border border-border-default rounded-[24px] p-4 mb-8">
            <FileText className="w-6 h-6 text-brand flex-shrink-0" weight="fill" />
            <p className="font-bold text-[16px] leading-snug text-text-primary">El resumen de tu consulta está listo</p>
          </div>
        )}

        {seccion === 'contenido' && (
          <div data-testid="cierre-contenido">
            {contenido.indicaciones.length > 0 && (
              <div className="mb-8 space-y-2">
                <div className="flex items-center gap-2 mb-1">
                  <Pill className="w-[18px] h-[18px] text-brand" />
                  <h2 className="text-[20px] leading-6 text-text-primary">Tus indicaciones</h2>
                </div>
                {contenido.indicaciones.map(i => (
                  <div key={i.id} className="bg-bg-secondary border border-border-default rounded-[20px] p-4 shadow-sm">
                    {i.titulo && <p className="text-[15px] leading-5 font-semibold text-text-primary">{i.titulo}</p>}
                    {i.texto && <p className="text-[14px] leading-5 text-text-primary whitespace-pre-wrap mt-0.5">{i.texto}</p>}
                  </div>
                ))}
              </div>
            )}
            {contenido.recetas.length > 0 && (
              <div className="mb-8 space-y-2">
                <div className="flex items-center gap-2 mb-1">
                  <FileText className="w-[18px] h-[18px] text-brand" />
                  <h2 className="text-[20px] leading-6 text-text-primary">{contenido.recetas.length > 1 ? 'Tus recetas' : 'Tu receta'}</h2>
                </div>
                {contenido.recetas.map(r => (
                  <a
                    key={r.id}
                    href={r.pdfUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-between gap-3 bg-bg-secondary border border-border-default rounded-[20px] p-4 shadow-sm hover:border-brand transition-colors"
                  >
                    <span className="text-[15px] leading-5 font-semibold text-text-primary truncate">
                      {r.medicamentos.filter(Boolean).join(' · ') || 'Receta'}
                    </span>
                    <span className="text-[14px] font-semibold text-brand flex-shrink-0">Ver receta</span>
                  </a>
                ))}
              </div>
            )}
            {consultation?.status === 'closing' && (
              <p className="flex items-center gap-2 text-[14px] leading-5 text-text-secondary mb-8">
                <CircleNotch className="w-4 h-4 text-brand animate-spin flex-shrink-0" />
                Tu profesional sigue cargando datos. Se actualiza solo.
              </p>
            )}
          </div>
        )}

        {/* 3 · Calificar */}
        {done ? (
          <div className="text-center py-4" data-testid="gracias">
            <Star className="w-10 h-10 text-amber-500 mx-auto mb-2" weight="fill" />
            <h2 className="text-[20px] leading-6 text-text-primary mb-1">¡Gracias por tu reseña!</h2>
            <p className="text-[14px] leading-5 text-text-secondary">Tu opinión ayuda a otros pacientes a elegir mejor.</p>
          </div>
        ) : (
          <>
            <h2 className="text-[20px] leading-6 text-text-primary mb-4">¿Cómo fue tu consulta?</h2>
            <div className="flex justify-center gap-2 mb-3">
              {[1, 2, 3, 4, 5].map(n => (
                <button
                  key={n}
                  data-testid={`estrella-${n}`}
                  onClick={() => setRating(n)}
                  aria-label={`${n} ${n === 1 ? 'estrella' : 'estrellas'}`}
                  className="p-1 transition-transform hover:scale-110 active:scale-95"
                >
                  <Star
                    className="w-10 h-10"
                    style={{ color: '#F59E0B' }}
                    weight={n <= rating ? 'fill' : 'regular'}
                  />
                </button>
              ))}
            </div>
            {rating > 0 && (
              <>
                <p className="text-center text-[14px] leading-5 font-semibold text-text-primary mb-6">
                  {RATING_LABELS[rating - 1]}
                </p>
                <label htmlFor="comentario-resena" className="block text-[14px] leading-[18px] font-medium text-text-primary mb-2">
                  Comentario (opcional)
                </label>
                <textarea
                  id="comentario-resena"
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                  rows={4}
                  placeholder="Contá tu experiencia con el profesional…"
                  className="w-full bg-bg-secondary border border-border-default rounded-[20px] px-4 py-3 text-[14px] leading-5 font-medium text-text-primary placeholder-text-tertiary outline-none focus:border-brand resize-none mb-4 transition-colors"
                />
                <button
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="w-full py-3.5 rounded-full font-bold text-[15px] border border-border-default text-text-primary hover:border-brand active:scale-95 transition-all disabled:opacity-60"
                >
                  {submitting ? 'Enviando…' : falloResena ? 'Reintentar' : 'Enviar reseña'}
                </button>
              </>
            )}
          </>
        )}

        {/* Salida explícita. Con el resumen listo, "Ver resumen" es la acción principal. */}
        {resumenListo && (
          <button
            onClick={verResumen}
            className="w-full mt-8 py-4 rounded-full bg-brand text-white font-bold text-[16px] hover:bg-brand-hover active:scale-95 transition-all shadow-md"
          >
            Ver resumen
          </button>
        )}
        <button
          onClick={volverAlInicio}
          className={`w-full text-center text-[14px] text-text-secondary font-semibold py-3 hover:text-text-primary transition-colors ${resumenListo ? 'mt-2' : 'mt-8'}`}
        >
          Volver al inicio
        </button>
      </div>
    </div>
  )
}
