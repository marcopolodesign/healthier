import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { VideoCamera, MapPin, CaretRight } from '@phosphor-icons/react'
import { consultationsService } from '../../services/consultationsService'
import { track } from '../../utils/analytics'

// An appointment only counts as "active" near its scheduled time — otherwise
// next week's booking would sit on the home screen forever. `in_progress` gets
// a much longer tail (that IS the case this banner exists for: the call started
// and the patient lost the tab), but still a bounded one: consultations get
// stuck in `in_progress` when nobody closes them, and a zombie row from weeks
// ago must not park a permanent banner on the home screen.
const WINDOW_BEFORE_MS     = 15 * 60 * 1000
const WINDOW_AFTER_MS      = 60 * 60 * 1000
const IN_PROGRESS_AFTER_MS = 6 * 60 * 60 * 1000

// Re-evaluate the time window without refetching, so a confirmed appointment
// appears/disappears on its own as its window opens and closes.
const TICK_MS = 30 * 1000

/**
 * Estados de pago con los que un turno se puede usar: cobrado, o pre-autorizado
 * (on-demand reserva la plata en la tarjeta y la captura al cerrar).
 *
 * Mirar sólo `status` era un agujero de plata: una consulta on-demand nace
 * `confirmed` ANTES de cobrar, así que si MP rechazaba el pago la fila quedaba
 * confirmada igual y este banner la ofrecía en el inicio. Pasó el 2026-07-31 —
 * MP rechazó por `cc_rejected_high_risk` y el paciente entró igual a la
 * videollamada. `pending_payment` incluye también "MP lo está revisando", que
 * todavía no es un sí.
 */
const PAGOS_HABILITANTES = ['paid', 'in_process']

/** Sin precio no hay nada que cobrar — no se puede exigir un pago que no existe. */
const sinCargo = c => c?.priceAtBooking == null || Number(c.priceAtBooking) === 0

function isActive(consultation, now) {
  const status = consultation?.status
  if (status !== 'in_progress' && status !== 'confirmed') return false
  if (!sinCargo(consultation) && !PAGOS_HABILITANTES.includes(consultation?.paymentStatus)) return false
  if (!consultation.scheduledAt) return false
  const scheduled = new Date(consultation.scheduledAt).getTime()
  if (Number.isNaN(scheduled)) return false
  const after = status === 'in_progress' ? IN_PROGRESS_AFTER_MS : WINDOW_AFTER_MS
  return now >= scheduled - WINDOW_BEFORE_MS && now <= scheduled + after
}

/**
 * Picks the one appointment worth resuming: an in-progress one always wins,
 * then whichever is closest to now.
 */
export function pickActiveAppointment(consultations, now) {
  const candidates = (consultations || []).filter(c => isActive(c, now))
  if (!candidates.length) return null
  return candidates.sort((a, b) => {
    const aInProgress = a.status === 'in_progress'
    const bInProgress = b.status === 'in_progress'
    if (aInProgress !== bInProgress) return aInProgress ? -1 : 1
    const aDist = Math.abs(new Date(a.scheduledAt).getTime() - now)
    const bDist = Math.abs(new Date(b.scheduledAt).getTime() - now)
    return aDist - bDist
  })[0]
}

/**
 * Home-screen re-entry point for an appointment already under way — shown
 * above the on-demand hero on the patient dashboard. Without it, a patient
 * whose video call dropped (tab closed, reload, connection lost) has no
 * obvious way back: the only "Entrar a Sala" button lives inside Mi Agenda.
 */
export default function ActiveAppointmentBanner({ profile }) {
  const navigate = useNavigate()
  const [consultations, setConsultations] = useState([])
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!profile?.id) return
    let cancelled = false
    const load = () => {
      consultationsService.getByPatient(profile.id)
        .then(data => { if (!cancelled) setConsultations(data || []) })
        .catch(() => {}) // silent — the banner is additive, never blocks the home
    }
    load()
    // Coming back to the tab is exactly when the professional may have started
    // the call, so refetch instead of waiting for the next mount.
    const onVisible = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVisible)
    const iv = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(iv)
    }
  }, [profile?.id])

  const active = useMemo(() => pickActiveAppointment(consultations, now), [consultations, now])

  // Fire the view event once per appointment, not on every 30s tick.
  const viewedIds = useRef(new Set())
  useEffect(() => {
    if (!active || viewedIds.current.has(active.id)) return
    viewedIds.current.add(active.id)
    track('active_appointment_view', {
      appointment_id: active.id,
      modality:       active.modality,
      status:         active.status,
    })
  }, [active])

  if (!active) return null

  const isVideo = active.modality === 'video'
  const inProgress = active.status === 'in_progress'
  const proName = active.professional?.fullName ?? 'tu profesional'
  const timeStr = active.scheduledAt
    ? new Date(active.scheduledAt).toLocaleTimeString('es-AR', {
        hour: '2-digit', minute: '2-digit', hour12: false,
        timeZone: 'America/Argentina/Buenos_Aires',
      })
    : null

  const handleResume = () => {
    track('active_appointment_resume_click', {
      appointment_id: active.id,
      modality:       active.modality,
      status:         active.status,
    })
    navigate(isVideo ? `/paciente/videollamada/${active.id}` : `/paciente/turno-confirmado/${active.id}`)
  }

  const Icon = isVideo ? VideoCamera : MapPin

  return (
    <button
      onClick={handleResume}
      className="w-full rounded-[28px] bg-white border border-brand/30 shadow-[0_8px_24px_rgba(124,179,139,0.18)] p-5 flex items-center gap-4 text-left active:scale-[0.98] hover:border-brand transition-all"
    >
      <div className="w-11 h-11 rounded-full bg-brand-muted flex items-center justify-center flex-shrink-0">
        <Icon className="w-5 h-5 text-brand" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          {inProgress && <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse flex-shrink-0" />}
          <span className="text-[10px] font-semibold tracking-widest uppercase text-brand">
            {inProgress ? 'En curso' : 'Tu próximo turno'}
          </span>
        </div>
        <p className="text-[15px] font-semibold text-text-primary leading-tight mt-1 truncate">
          Continuar con tu turno {isVideo ? 'virtual' : 'presencial'}
        </p>
        <p className="text-[12px] text-text-secondary mt-0.5 truncate">
          {proName}{timeStr ? ` · ${timeStr} hs` : ''}
        </p>
      </div>

      <CaretRight className="w-5 h-5 text-brand flex-shrink-0" />
    </button>
  )
}
