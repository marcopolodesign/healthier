import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { SealCheck, FileText, ClipboardText, Star, CaretLeft, Stethoscope, Pill } from '@phosphor-icons/react'
import { consultationsService } from '../../services/consultationsService'
import { historiaClinicaService } from '../../services/historiaClinicaService'
import { reviewsService } from '../../services/reviewsService'

/**
 * Resumen de consulta — /paciente/consulta/resumen/:id
 *
 * A dónde manda el banner de inicio "Mirá el resumen y tu receta" (migración
 * 098 / C2, Mateo 2026-08-06): terminada la consulta, el paciente tiene que
 * poder ver el resumen y la receta DIRECTO desde el inicio, sin ir a
 * buscarlos a Mi Agenda.
 *
 * Usa `getByPatient` (no `getById`) porque es el único método del service que
 * ya trae `encounters.medications` — la misma fuente que usa la pestaña
 * Historial de Consultations.jsx para derivar las recetas emitidas, así que
 * la lógica de acá es la misma a propósito (una sola definición de "qué es
 * una receta emitida" en el código del paciente).
 */
export default function ConsultationSummary({ profile }) {
  const { id } = useParams()
  const navigate = useNavigate()

  const [consultation, setConsultation] = useState(null)
  // Lo que el profesional asentó en ESTA consulta: diagnósticos, indicaciones y
  // la evolución. Vive aparte porque no viaja en `getByPatient` — ver
  // `historiaClinicaService.getEncounterByConsultation`.
  const [encuentro, setEncuentro] = useState(null)
  const [loading, setLoading] = useState(true)
  const [hasReview, setHasReview] = useState(false)

  useEffect(() => {
    if (!profile?.id || !id) return
    let cancelled = false
    Promise.all([
      consultationsService.getByPatient(profile.id),
      reviewsService.getByPatient(profile.id).catch(() => ({})),
      // Que falle la parte clínica no puede dejar al paciente sin resumen ni
      // sin su receta: se degrada a null y el resto se muestra igual.
      historiaClinicaService.getEncounterByConsultation(id, profile.id).catch(() => null),
    ]).then(([consultations, reviewMap, enc]) => {
      if (cancelled) return
      setConsultation((consultations || []).find(c => c.id === id) ?? null)
      setHasReview(Boolean(reviewMap?.[id]))
      setEncuentro(enc)
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [profile?.id, id])

  if (loading) {
    return (
      <div className="absolute inset-0 bg-bg-primary flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!consultation) {
    return (
      <div className="absolute inset-0 bg-bg-primary flex flex-col items-center justify-center px-6 text-center">
        <p className="text-[15px] text-text-secondary mb-6">No pudimos encontrar esta consulta.</p>
        <button
          onClick={() => navigate('/paciente/dashboard')}
          className="px-6 py-3 rounded-full bg-brand text-white font-bold text-[14px]"
        >
          Volver al inicio
        </button>
      </div>
    )
  }

  const proName = consultation.professional?.fullName ?? 'Profesional'
  const proAvatar = consultation.professional?.avatarUrl ?? null
  const proSpecialty = consultation.professional?.professionalProfiles?.[0]?.specialty ?? null
  const fecha = consultation.completedAt
    ? new Date(consultation.completedAt).toLocaleDateString('es-AR', {
        day: 'numeric', month: 'long', year: 'numeric',
      })
    : null

  // Una consulta puede tener más de una receta, y cada receta agrupa uno o
  // más medicamentos (mismo `rctaPrescriptionId`) — se agrupan acá para poder
  // listar los nombres, algo que Consultations.jsx no necesita (ahí sólo
  // muestra "Ver receta" genérico) pero que en un resumen sí suma.
  const recetasPorId = (consultation.encounters ?? [])
    .flatMap(e => e.medications ?? [])
    .filter(m => m.rctaStatus === 'issued' && m.rctaPdfUrl)
    .reduce((acc, m) => {
      const existing = acc.get(m.rctaPrescriptionId)
      if (existing) existing.medications.push(m.medicationName)
      else acc.set(m.rctaPrescriptionId, { rctaPrescriptionId: m.rctaPrescriptionId, rctaPdfUrl: m.rctaPdfUrl, medications: [m.medicationName] })
      return acc
    }, new Map())
  const recetas = Array.from(recetasPorId.values())

  const diagnosticos = encuentro?.conditions ?? []
  // Las indicaciones son las medicaciones del encuentro. Las que salieron por
  // receta electrónica ya se listan arriba con su PDF, así que acá quedan las
  // otras — lo indicado que no es una receta emitida (venta libre, pautas).
  const indicaciones = (encuentro?.medications ?? []).filter(m => m.rctaStatus !== 'issued')
  // La evolución la escribe el profesional en la consulta. `closingNotes` es
  // lo que dejó al cerrar; pueden convivir y no son lo mismo.
  const evolucion = (encuentro?.entries ?? []).filter(e => (e.content ?? '').trim())

  return (
    <div className="absolute inset-0 bg-bg-primary overflow-y-auto scrollbar-hide">
      <div className="max-w-lg mx-auto px-6 pt-6 pb-16">
        {/* `-1` y no "/paciente/dashboard": ahora también se llega desde el
            Historial, y ahí "Inicio" saca al paciente del lugar donde estaba. */}
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1 text-[13px] font-medium text-text-tertiary hover:text-text-secondary transition-colors mb-6"
        >
          <CaretLeft className="w-4 h-4" /> Volver
        </button>

        {/* Professional card */}
        <div className="bg-bg-secondary border border-border-default rounded-[24px] p-4 mb-6 flex items-center gap-4 shadow-sm">
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
            {proSpecialty && <p className="text-[13px] text-text-secondary">{proSpecialty}</p>}
            {fecha && <p className="text-[11px] font-semibold text-emerald-600 mt-1">Consulta finalizada · {fecha}</p>}
          </div>
        </div>

        {/* Resumen / notas de cierre */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <ClipboardText className="w-4 h-4 text-brand" />
            <h2 className="text-[16px] font-semibold text-text-primary">Resumen de tu consulta</h2>
          </div>
          {consultation.closingNotes ? (
            <p className="text-[14px] text-text-primary leading-relaxed bg-bg-secondary border border-border-default rounded-2xl p-4 whitespace-pre-wrap">
              {consultation.closingNotes}
            </p>
          ) : (
            <p className="text-[13px] text-text-tertiary bg-bg-secondary border border-border-default rounded-2xl p-4">
              Tu profesional no dejó notas adicionales para esta consulta.
            </p>
          )}
        </div>

        {/* Diagnósticos de esta consulta */}
        {diagnosticos.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <Stethoscope className="w-4 h-4 text-brand" />
              <h2 className="text-[16px] font-semibold text-text-primary">
                Diagnóstico{diagnosticos.length > 1 ? 's' : ''}
              </h2>
            </div>
            <div className="space-y-2">
              {diagnosticos.map(d => (
                <div key={d.id} className="bg-bg-secondary border border-border-default rounded-2xl p-4">
                  <p className="text-[14px] font-semibold text-text-primary">
                    {d.icd10Display || d.snomedDisplay || 'Diagnóstico'}
                  </p>
                  {d.notes && (
                    <p className="text-[13px] text-text-secondary mt-1 whitespace-pre-wrap">{d.notes}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Indicaciones — lo medicado que NO salió por receta electrónica; esas
            ya se listan abajo con su PDF y repetirlas confunde. */}
        {indicaciones.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <Pill className="w-4 h-4 text-brand" />
              <h2 className="text-[16px] font-semibold text-text-primary">Indicaciones</h2>
            </div>
            <div className="space-y-2">
              {indicaciones.map(m => (
                <div key={m.id} className="bg-bg-secondary border border-border-default rounded-2xl p-4">
                  <p className="text-[14px] font-semibold text-text-primary">
                    {m.medicationName || m.nombreDroga || 'Indicación'}
                  </p>
                  {(m.dosageText || m.frequency) && (
                    <p className="text-[13px] text-text-secondary mt-1">
                      {[m.dosageText, m.frequency].filter(Boolean).join(' · ')}
                    </p>
                  )}
                  {m.notes && (
                    <p className="text-[13px] text-text-secondary mt-1 whitespace-pre-wrap">{m.notes}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Evolución — lo que el profesional escribió durante la consulta */}
        {evolucion.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <ClipboardText className="w-4 h-4 text-brand" />
              <h2 className="text-[16px] font-semibold text-text-primary">Evolución</h2>
            </div>
            <div className="space-y-2">
              {evolucion.map(e => (
                <p key={e.id} className="text-[14px] text-text-primary leading-relaxed bg-bg-secondary border border-border-default rounded-2xl p-4 whitespace-pre-wrap">
                  {e.content}
                </p>
              ))}
            </div>
          </div>
        )}

        {/* Recetas — sólo si hay, no dejamos un botón que lleve a la nada */}
        {recetas.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <FileText className="w-4 h-4 text-brand" />
              <h2 className="text-[16px] font-semibold text-text-primary">
                Receta{recetas.length > 1 ? 's' : ''} electrónica{recetas.length > 1 ? 's' : ''}
              </h2>
            </div>
            <div className="space-y-2">
              {recetas.map(r => (
                <a
                  key={r.rctaPrescriptionId}
                  href={r.rctaPdfUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between gap-3 bg-bg-secondary border border-border-default rounded-2xl p-4 hover:border-brand transition-colors"
                >
                  <span className="text-[13px] font-semibold text-text-primary truncate">
                    {(r.medications ?? []).join(' · ') || `Receta N° ${r.rctaPrescriptionId}`}
                  </span>
                  <span className="text-[13px] font-semibold text-brand flex-shrink-0">Ver PDF</span>
                </a>
              ))}
            </div>
          </div>
        )}

        {!hasReview && (
          <button
            onClick={() => navigate(`/paciente/consulta/review/${id}`)}
            className="w-full flex items-center justify-center gap-2 py-4 rounded-full font-bold text-[15px] text-white bg-brand hover:bg-brand-hover transition-all shadow-md active:scale-95"
          >
            <Star className="w-4 h-4" weight="fill" /> Dejar una reseña
          </button>
        )}
      </div>
    </div>
  )
}
