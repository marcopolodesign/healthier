import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { CheckCircle, Calendar, VideoCamera, MapPin, CaretRight, Plus } from '@phosphor-icons/react'
import { consultationsService } from '../../services/consultationsService'
import { isActive as puedeEntrarYa } from '../../components/patient/ActiveAppointmentBanner'

function buildGoogleCalendarUrl(consultation) {
  if (!consultation?.scheduledAt) return null
  const start = new Date(consultation.scheduledAt)
  const end   = new Date(start.getTime() + 60 * 60 * 1000)
  const fmt   = d => d.toISOString().replace(/[-:]/g, '').replace('.000', '')
  const title = encodeURIComponent(`Consulta con ${consultation.professional?.fullName ?? 'profesional'} — Healthier`)
  const details = encodeURIComponent(
    consultation.modality === 'video'
      ? 'Consulta por videollamada en Healthier'
      : 'Consulta presencial reservada en Healthier'
  )
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${fmt(start)}/${fmt(end)}&details=${details}`
}

function SkeletonRow() {
  return <div className="h-4 w-3/4 bg-gray-100 rounded animate-pulse" />
}

export default function BookingConfirmed({ profile }) {
  const { consultationId } = useParams()
  const navigate = useNavigate()
  const [consultation, setConsultation] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!consultationId) return
    consultationsService.getById(consultationId)
      .then(setConsultation)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [consultationId])

  const proName   = consultation?.professional?.fullName ?? '—'
  const specialty = consultation?.professional?.professionalProfiles?.[0]?.specialty ?? null
  const proAvatar = consultation?.professional?.avatarUrl ?? null
  const initial   = proName.charAt(0).toUpperCase()

  const scheduledAt = consultation?.scheduledAt
  const dateStr = scheduledAt
    ? new Date(scheduledAt).toLocaleString('es-AR', {
        weekday: 'long', day: 'numeric', month: 'long',
        hour: '2-digit', minute: '2-digit',
        timeZone: 'America/Argentina/Buenos_Aires',
      })
    : '—'

  const isVideo   = consultation?.modality === 'video'
  const price     = consultation?.priceAtBooking

  /*
   * Una consulta inmediata (on-demand, o videoconsulta con match al momento:
   * `handleConfirmMatched` en ReservarConsulta no manda `scheduledAt`, así que
   * el turno queda para ahora) no se agenda para después — el paso siguiente es
   * entrar. Sin esto la única acción era "Ver mis turnos" y el paciente que
   * acababa de pagar tenía que buscar el "Entrar a Sala" dentro de Mi Agenda.
   *
   * Se reusa la ventana del banner de inicio (misma regla de "está por empezar
   * o ya empezó" + pago habilitante) para no tener dos definiciones de cuándo
   * un turno se puede usar.
   */
  const entrarAhora = !loading && isVideo && puedeEntrarYa(consultation, Date.now())

  // Un turno que empieza ahora no necesita recordatorio en el calendario.
  const calUrl    = entrarAhora ? null : buildGoogleCalendarUrl(consultation)

  return (
    /*
     * El scroll va en el contenedor y el centrado en un hijo `min-h-full`: con
     * `items-center` directamente sobre el que scrollea, el contenido más alto
     * que la pantalla se recorta arriba y abajo sin poder llegar a los botones
     * (pasaba en mobile — los CTAs quedaban tapados por el nav de abajo).
     * `pb-32` es la separación estándar del nav del paciente.
     */
    <div className="absolute inset-0 bg-bg-primary overflow-y-auto">
      <div className="min-h-full flex items-center justify-center px-5 py-10 pb-32">
        <div className="w-full max-w-sm flex flex-col items-center gap-6">

        {/* Success icon */}
        <div className="relative">
          <div className="w-24 h-24 rounded-full flex items-center justify-center shadow-md"
            style={{ backgroundColor: '#f0f7f3' }}>
            <CheckCircle className="w-14 h-14 text-brand" weight="fill" />
          </div>
        </div>

        {/* Title */}
        <div className="text-center">
          <h1 className="text-[28px] font-black text-text-primary leading-tight tracking-tight">
            ¡Turno confirmado!
          </h1>
          <p className="text-[14px] text-text-secondary mt-1.5">
            {entrarAhora
              ? 'Tu consulta empieza ahora — entrá a la sala'
              : 'Recibirás un recordatorio antes de la consulta'}
          </p>
        </div>

        {/* Consultation card */}
        <div className="w-full bg-white rounded-[24px] border border-border-default shadow-sm p-5 flex flex-col gap-4">

          {/* Professional */}
          <div className="flex items-center gap-3">
            {loading ? (
              <div className="w-14 h-14 rounded-full bg-gray-100 animate-pulse flex-shrink-0" />
            ) : proAvatar ? (
              <img src={proAvatar} alt={proName}
                className="w-14 h-14 rounded-full object-cover border-2 border-white shadow-sm flex-shrink-0" />
            ) : (
              <div className="w-14 h-14 rounded-full flex items-center justify-center text-[24px] font-serif text-brand flex-shrink-0"
                style={{ backgroundColor: 'var(--color-brand-muted)' }}>
                {initial}
              </div>
            )}
            <div className="flex-1 min-w-0">
              {loading ? (
                <div className="flex flex-col gap-1.5"><SkeletonRow /><div className="h-3 w-1/2 bg-gray-100 rounded animate-pulse" /></div>
              ) : (
                <>
                  <p className="text-[16px] font-bold text-text-primary leading-tight truncate">{proName}</p>
                  {specialty && <p className="text-[13px] text-text-secondary mt-0.5 truncate">{specialty}</p>}
                </>
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="border-t border-border-default" />

          {/* Date */}
          <div className="flex items-start gap-3">
            <Calendar className="w-5 h-5 text-brand flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">Fecha y hora</p>
              {loading ? <SkeletonRow /> : (
                <p className="text-[14px] font-semibold text-text-primary mt-0.5 capitalize">{dateStr}</p>
              )}
            </div>
          </div>

          {/* Modality */}
          <div className="flex items-center gap-3">
            {isVideo
              ? <VideoCamera className="w-5 h-5 text-brand flex-shrink-0" />
              : <MapPin className="w-5 h-5 text-brand flex-shrink-0" />}
            <div>
              <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">Modalidad</p>
              {loading ? <SkeletonRow /> : (
                <p className="text-[14px] font-semibold text-text-primary mt-0.5">
                  {isVideo ? 'Videoconsulta' : 'Presencial'}
                </p>
              )}
            </div>
          </div>

          {/* Price */}
          {price && (
            <div className="flex items-center justify-between pt-2 border-t border-border-default">
              <p className="text-[13px] text-text-secondary font-medium">Honorarios</p>
              <p className="text-[16px] font-black text-text-primary">${price.toLocaleString('es-AR')}</p>
            </div>
          )}
        </div>

        {/* Add to calendar */}
        {calUrl && !loading && (
          <a
            href={calUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-[13px] font-bold text-brand hover:text-brand-hover transition-colors"
          >
            <Plus className="w-4 h-4" />
            Agregar a Google Calendar
          </a>
        )}

        {/* CTAs */}
        <div className="w-full flex flex-col gap-3">
          {entrarAhora ? (
            <>
              {/* La sala de espera, no la videollamada directa: es la que toma la
                  pre-consulta y avisa al profesional que el paciente ya está. */}
              <button
                onClick={() => navigate(`/paciente/sala-espera/${consultationId}`)}
                className="w-full flex items-center justify-center gap-2 px-6 py-4 rounded-full font-bold text-[15px] text-white bg-brand hover:bg-brand-hover transition-all shadow-md active:scale-95"
              >
                <VideoCamera className="w-5 h-5" weight="fill" />
                Entrar a la sala
              </button>
              <button
                onClick={() => navigate('/paciente/consultas')}
                className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-full font-bold text-[15px] text-brand border-2 border-brand hover:bg-brand/5 transition-all active:scale-95"
              >
                <Calendar className="w-5 h-5" />
                Ver mis turnos
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => navigate('/paciente/consultas')}
                className="w-full flex items-center justify-center gap-2 px-6 py-4 rounded-full font-bold text-[15px] text-white bg-brand hover:bg-brand-hover transition-all shadow-md active:scale-95"
              >
                <Calendar className="w-5 h-5" />
                Ver mis turnos
              </button>
              <button
                onClick={() => navigate('/paciente/reservar')}
                className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-full font-bold text-[15px] text-brand border-2 border-brand hover:bg-brand/5 transition-all active:scale-95"
              >
                Reservar otro turno
              </button>
            </>
          )}
        </div>

        </div>
      </div>
    </div>
  )
}
