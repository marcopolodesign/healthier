import { Link } from 'react-router-dom'
import { VideoCamera, MapPin, CircleNotch, CalendarBlank } from '@phosphor-icons/react'
import StatusBadge from '../StatusBadge'

/**
 * Los turnos de un paciente con este profesional.
 *
 * Se comparte entre el perfil del paciente y la pestaña "Turnos" de la historia
 * clínica: es la misma pregunta ("qué pasó antes con este paciente") hecha desde
 * dos lugares, y tenerla duplicada garantizaba que se desincronizaran.
 *
 * Sólo aparecen los turnos con ESTE profesional — no es una decisión de diseño de
 * la lista, es la RLS de `consultations`: una consulta la ven sus dos partes y
 * nadie más. Se dice en la UI para que el profesional no crea que está viendo
 * todo el historial del paciente.
 */

const formatARS = n =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })
    .format(Number(n ?? 0))

export default function PatientConsultationList({ consultations, loading, emptyHint }) {
  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <CircleNotch className="h-5 w-5 animate-spin text-brand" />
      </div>
    )
  }

  if (!consultations?.length) {
    return (
      <div className="text-center py-8 text-text-secondary">
        <CalendarBlank className="h-8 w-8 mx-auto mb-2 opacity-30" />
        <p className="text-sm font-medium">Sin turnos previos</p>
        {emptyHint && <p className="text-xs mt-1">{emptyHint}</p>}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {consultations.map(c => {
        const fecha = c.scheduledAt ? new Date(c.scheduledAt) : null
        const esVideo = c.modality === 'video'
        const pago = Array.isArray(c.payment) ? c.payment[0] : c.payment
        const neto = pago?.mpNetReceivedAmount ?? pago?.netToProfessional

        return (
          <Link
            key={c.id}
            to={`/profesional/consulta/${c.id}`}
            className="block rounded-xl border border-border-default bg-bg-surface p-3 hover:border-brand/40 transition-colors"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  {esVideo
                    ? <VideoCamera className="h-3.5 w-3.5 text-brand shrink-0" />
                    : <MapPin className="h-3.5 w-3.5 text-brand shrink-0" />}
                  <span className="text-sm font-medium text-text-primary">
                    {fecha
                      ? fecha.toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })
                      : 'Sin fecha'}
                  </span>
                  {fecha && (
                    <span className="text-xs text-text-tertiary">
                      {fecha.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </div>

                <p className="text-xs text-text-secondary mt-0.5">
                  {[
                    c.consultationType?.name,
                    esVideo ? 'Videollamada' : 'Presencial',
                    c.durationMinutes != null ? `${c.durationMinutes} min` : null,
                  ].filter(Boolean).join(' · ')}
                </p>

                {/* La nota de cierre es lo único que dice qué pasó en el turno, así
                    que se muestra acá y no sólo adentro. */}
                {c.closingNotes && (
                  <p className="text-xs text-text-primary mt-1 line-clamp-2">{c.closingNotes}</p>
                )}
                {c.status === 'cancelled' && c.cancelReason && (
                  <p className="text-xs text-danger mt-1">Cancelada: {c.cancelReason}</p>
                )}
              </div>

              <div className="flex flex-col items-end gap-1 shrink-0">
                <StatusBadge status={c.status} />
                {neto != null && pago?.status === 'approved' && (
                  <span className="text-[11px] text-text-tertiary">{formatARS(neto)}</span>
                )}
              </div>
            </div>
          </Link>
        )
      })}
    </div>
  )
}
