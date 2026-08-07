import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { VideoCamera, MapPin, CaretRight, Clock, FileText } from '@phosphor-icons/react'
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

export function isActive(consultation, now) {
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
 * El profesional cortó la llamada y está cargando el cierre (migración 098).
 * Ventana sin tiempo límite propio a propósito: el cron que la destraba corre
 * cada 15 min con una tolerancia de 10, así que en la práctica nunca queda
 * viva mucho más que eso — no hace falta otra cuenta acá.
 */
export function isClosing(consultation) {
  return consultation?.status === 'closing'
}

// C2 (Mateo, 2026-08-06): terminada la consulta, el paciente tiene que ver el
// resumen y la receta DIRECTO desde el inicio, sin ir a buscarlos a Mi Agenda.
// Ventana acotada para que no se convierta en un banner permanente — pasado
// esto, "Mi Agenda" (pestaña Historial) sigue teniendo el mismo "Ver receta".
const RECENTLY_COMPLETED_WINDOW_MS = 24 * 60 * 60 * 1000

export function isRecentlyCompleted(consultation, now) {
  if (consultation?.status !== 'completed') return false
  if (!consultation.completedAt) return false
  const completed = new Date(consultation.completedAt).getTime()
  if (Number.isNaN(completed)) return false
  return now - completed >= 0 && now - completed <= RECENTLY_COMPLETED_WINDOW_MS
}

/**
 * Un solo slot de banner para todo lo que amerita volver: un turno en curso o
 * por empezar (`isActive`) gana siempre; si no hay ninguno, un cierre en
 * curso (`isClosing`) es más urgente que avisar de una receta ya lista;
 * recién si no hay nada de eso se ofrece la consulta completada más
 * reciente. Fusiona `pickActiveAppointment` con las dos señales nuevas de
 * C6/C2 sin tocar su comportamiento (`isActive` queda intacto — lo importa
 * BookingConfirmed).
 */
export function pickBannerConsultation(consultations, now) {
  const list = consultations || []

  const live = pickActiveAppointment(list, now)
  if (live) return live

  const closing = list.filter(isClosing)
  if (closing.length) {
    // Si por lo que sea hay más de una (no debería, sólo hay una llamada
    // activa por vez), la más reciente en empezar a cerrar.
    return closing.sort((a, b) =>
      new Date(b.closingStartedAt ?? 0) - new Date(a.closingStartedAt ?? 0)
    )[0]
  }

  const completed = list.filter(c => isRecentlyCompleted(c, now))
  if (completed.length) {
    return completed.sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt))[0]
  }

  return null
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

  const active = useMemo(() => pickBannerConsultation(consultations, now), [consultations, now])

  // Fire the view event once per appointment, not on every 30s tick.
  const viewedIds = useRef(new Set())
  useEffect(() => {
    if (!active || viewedIds.current.has(active.id)) return
    viewedIds.current.add(active.id)
    track('active_appointment_view', {
      appointment_id: active.id,
      modality:       active.modality,
      status:         active.status,
      flow: 'paciente',
    })
  }, [active])

  if (!active) return null

  const isVideo = active.modality === 'video'
  const inProgress = active.status === 'in_progress'
  const closing = active.status === 'closing'
  const recentlyCompleted = active.status === 'completed'
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
      flow: 'paciente',
    })
    if (closing) {
      // Misma pantalla que ya sabe mostrar "Preparando tu receta" y
      // redirigir sola cuando el profesional termina — un solo lugar que
      // sabe qué hacer con `status='closing'` (VideoCall.jsx).
      navigate(`/paciente/videollamada/${active.id}`)
    } else if (recentlyCompleted) {
      navigate(`/paciente/consulta/resumen/${active.id}`)
    } else {
      navigate(isVideo ? `/paciente/videollamada/${active.id}` : `/paciente/turno-confirmado/${active.id}`)
    }
  }

  const Icon = closing ? Clock : recentlyCompleted ? FileText : isVideo ? VideoCamera : MapPin

  const eyebrow = inProgress ? 'En curso'
    : closing ? 'Preparando tu receta'
    : recentlyCompleted ? 'Consulta finalizada'
    : 'Tu próximo turno'

  const title = closing ? 'Tu profesional está cerrando la consulta'
    : recentlyCompleted ? 'Mirá el resumen y tu receta'
    : `Continuar con tu turno ${isVideo ? 'virtual' : 'presencial'}`

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
          {(inProgress || closing) && <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse flex-shrink-0" />}
          <span className="text-[10px] font-semibold tracking-widest uppercase text-brand">
            {eyebrow}
          </span>
        </div>
        <p className="text-[15px] font-semibold text-text-primary leading-tight mt-1 truncate">
          {title}
        </p>
        <p className="text-[12px] text-text-secondary mt-0.5 truncate">
          {proName}{!closing && !recentlyCompleted && timeStr ? ` · ${timeStr} hs` : ''}
        </p>
      </div>

      <CaretRight className="w-5 h-5 text-brand flex-shrink-0" />
    </button>
  )
}
