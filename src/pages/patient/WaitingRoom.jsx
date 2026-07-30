import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Clock, VideoCamera, SealCheck, ClipboardText } from '@phosphor-icons/react'
import { supabase } from '../../lib/supabase'
import { consultationsService, WAITING_HEARTBEAT_MS } from '../../services/consultationsService'
import PreconsultaForm from '../../components/patient/PreconsultaForm'
import { toast } from '../../components/Toast'
import { consultationEventsService, CONSULTATION_EVENTS } from '../../services/consultationEventsService'

/**
 * The pre-consulta payload is written by PreconsultaForm as snake_case JSON, but
 * getById runs it through toCamelCase — accept both shapes rather than depending
 * on which one survives the round trip.
 */
function hasPreconsulta(data) {
  if (!data || typeof data !== 'object') return false
  return Boolean(data.main_complaint || data.mainComplaint || data.symptoms)
}

function useCountdown(scheduledAt) {
  const [display, setDisplay] = useState(null)

  useEffect(() => {
    if (!scheduledAt) return
    const tick = () => {
      const diff = new Date(scheduledAt).getTime() - Date.now()
      if (diff <= 0) { setDisplay(null); return }
      const totalMins = Math.floor(diff / 60000)
      if (totalMins >= 60) { setDisplay(null); return }
      const h = Math.floor(totalMins / 60)
      const m = totalMins % 60
      const s = Math.floor((diff % 60000) / 1000)
      setDisplay(h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`)
    }
    tick()
    const iv = setInterval(tick, 1000)
    return () => clearInterval(iv)
  }, [scheduledAt])

  return display
}

/**
 * Patient waiting room — /paciente/sala-espera/:consultationId
 *
 * Shows professional info + scheduled time countdown until the professional joins.
 * Subscribes to Realtime — auto-enables "Entrar" button when status → in_progress.
 */
export default function WaitingRoom({ profile }) {
  const { consultationId } = useParams()
  const navigate = useNavigate()

  const [consultation, setConsultation] = useState(null)
  // "Habilitado" es distinto de "la consulta arrancó": el profesional puede
  // habilitarte antes de entrar él. Antes esto dependía de que abriera la
  // videollamada, y el paciente esperaba sin ninguna señal (migración 071).
  const [admitted, setAdmitted] = useState(false)
  const [doctorReady, setDoctorReady] = useState(false)
  const [entering, setEntering] = useState(false)
  const [dots, setDots] = useState('')
  // null = consultation not loaded yet, so we don't flash the form at the patient
  // before we know whether they already answered.
  const [preconsultaDone, setPreconsultaDone] = useState(null)
  // El paciente tiene que apretar "Iniciar consulta" explícitamente. Recién ahí
  // se escribe presencia, que es lo que avisa al profesional y le enciende el
  // "Atender" en su panel. Sin este paso, contestar la última pregunta convocaba
  // al profesional de una — y el paciente todavía no sabía que arrancaba.
  const [started, setStarted] = useState(false)
  const [starting, setStarting] = useState(false)

  const countdown = useCountdown(consultation?.scheduledAt)

  // Animate waiting dots.
  // Solo mientras se está esperando de verdad: los puntitos no se ven durante el
  // gate de pre-consulta, y este intervalo re-renderiza el árbol entero dos veces
  // por segundo — justo mientras el paciente está contestando el formulario.
  useEffect(() => {
    if (!preconsultaDone) return
    const iv = setInterval(() => setDots(d => (d.length >= 3 ? '' : d + '.')), 500)
    return () => clearInterval(iv)
  }, [preconsultaDone])

  // Load consultation
  useEffect(() => {
    if (!consultationId) return
    consultationsService.getById(consultationId)
      .then(c => {
        setConsultation(c)
        if (c.status === 'in_progress') setDoctorReady(true)
        if (c.patientAdmittedAt) setAdmitted(true)
        setPreconsultaDone(hasPreconsulta(c.preconsultaData))
        // Volver a una consulta ya iniciada (reload, volver atrás) no debe pedir
        // "Iniciar consulta" otra vez ni re-notificar al profesional.
        if (c.patientWaitingSince || c.status === 'in_progress') setStarted(true)
      })
      .catch(() => {})
  }, [consultationId])

  // Announce presence to the professional + keep it fresh while the room is open.
  // Without this the professional has no way of knowing anyone showed up.
  //
  // Gated on the pre-consulta on purpose: the first ping pushes "tenés un paciente
  // esperando" to the professional, so firing it before the questions are answered
  // is exactly the case Mateo reported — the professional shows up and waits while
  // the patient is still typing (or skipped the form entirely).
  useEffect(() => {
    if (!consultationId || !preconsultaDone || !started) return
    let cancelled = false

    consultationsService.pingPatientWaiting(consultationId).catch(() => {})
    const iv = setInterval(() => {
      if (!cancelled) consultationsService.pingPatientWaiting(consultationId).catch(() => {})
    }, WAITING_HEARTBEAT_MS)

    return () => {
      cancelled = true
      clearInterval(iv)
      // Leaving the room — including navigating into the call — clears presence.
      consultationsService.clearPatientWaiting(consultationId).catch(() => {})
      consultationEventsService.log(consultationId, CONSULTATION_EVENTS.PATIENT_LEFT_WAITING, null,
        { id: profile?.id, role: 'patient' })
    }
  }, [consultationId, preconsultaDone, started, profile?.id])

  // Realtime subscription
  useEffect(() => {
    if (!consultationId) return
    const channel = supabase
      .channel(`waiting-${consultationId}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'consultations',
        filter: `id=eq.${consultationId}`,
      }, (payload) => {
        if (payload.new?.status === 'in_progress') setDoctorReady(true)
        if (payload.new?.patient_admitted_at) setAdmitted(true)
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [consultationId])

  const handleStart = useCallback(async () => {
    if (starting || !consultationId) return
    setStarting(true)
    try {
      // Este ping es el que avisa al profesional y le enciende "Atender".
      await consultationsService.pingPatientWaiting(consultationId)
      consultationEventsService.log(consultationId, CONSULTATION_EVENTS.PATIENT_ENTERED_WAITING,
        { modality: consultation?.modality }, { id: profile?.id, role: 'patient' })
      setStarted(true)
    } catch {
      toast.error('No pudimos avisarle al profesional. Probá de nuevo.')
    } finally {
      setStarting(false)
    }
  }, [starting, consultationId])

  const canEnter = admitted || doctorReady

  const handleEnter = useCallback(() => {
    if (!canEnter || entering) return
    setEntering(true)
    navigate(`/paciente/videollamada/${consultationId}`)
  }, [canEnter, entering, navigate, consultationId])

  const doctorName   = consultation?.professional?.fullName ?? 'el profesional'
  const doctorAvatar = consultation?.professional?.avatarUrl ?? null
  const initial      = doctorName.charAt(0).toUpperCase()

  const scheduledAt  = consultation?.scheduledAt
  const scheduledStr = scheduledAt
    ? new Date(scheduledAt).toLocaleString('es-AR', {
        weekday: 'long', day: 'numeric', month: 'long',
        hour: '2-digit', minute: '2-digit',
        timeZone: 'America/Argentina/Buenos_Aires',
      })
    : null

  // ── Pre-consulta gate ───────────────────────────────────────────────────────
  // The patient is not considered "in the room" until this is answered: no presence
  // is written, so no push goes out and the professional's panel shows nothing.
  if (preconsultaDone === false) {
    return (
      <div className="absolute inset-0 bg-bg-primary flex flex-col items-center justify-center px-6 py-10">
        <div className="w-20 h-20 rounded-full bg-brand-muted flex items-center justify-center mb-4">
          <ClipboardText className="w-9 h-9 text-brand" />
        </div>
        <h1 className="text-[24px] font-bold text-text-primary text-center leading-tight mb-2">
          Un paso antes de entrar
        </h1>
        <p className="text-[14px] text-text-secondary text-center leading-relaxed max-w-xs">
          Contanos por qué consultás. {doctorName} lo lee antes de recibirte, así no
          perdés tiempo explicándolo en la videollamada.
        </p>

        {/* En modo required el form es full-screen y tapa esto; queda como
            fondo para el instante previo a que monte. */}
        <PreconsultaForm
          isOpen
          required
          consultationId={consultationId}
          profile={profile}
          onClose={() => {}}
          onSubmitted={() => setPreconsultaDone(true)}
        />
      </div>
    )
  }

  // ── Arranque explícito ──────────────────────────────────────────────────────
  // Contestar la última pregunta NO debe convocar al profesional: el paciente
  // decide cuándo arranca. Hasta que toque el botón no se escribe presencia, así
  // que del otro lado no aparece nada.
  if (preconsultaDone && !started) {
    return (
      <div className="absolute inset-0 bg-bg-primary flex flex-col items-center justify-center px-6 py-10">
        <div className="w-20 h-20 rounded-full bg-brand-muted flex items-center justify-center mb-4">
          <VideoCamera className="w-9 h-9 text-brand" />
        </div>
        <h1 className="text-[24px] font-bold text-text-primary text-center leading-tight mb-2">
          Listo para empezar
        </h1>
        <p className="text-[14px] text-text-secondary text-center leading-relaxed mb-8 max-w-xs">
          Cuando toques el botón le avisamos a {doctorName} que estás listo. Vas a
          esperar en la sala hasta que se conecte.
        </p>
        <button
          onClick={handleStart}
          disabled={starting}
          className="flex items-center gap-2.5 px-8 py-4 rounded-full font-bold text-[16px] transition-all shadow-md bg-brand text-white hover:bg-brand-hover active:scale-95 disabled:opacity-60"
        >
          <VideoCamera className="w-5 h-5" />
          {starting ? 'Avisando…' : 'Iniciar consulta'}
        </button>
        <button
          onClick={() => navigate('/paciente/consultas')}
          className="text-[13px] text-text-tertiary font-medium py-2 mt-4 hover:text-text-secondary transition-colors"
        >
          Ahora no
        </button>
      </div>
    )
  }

  return (
    <div className="absolute inset-0 bg-bg-primary flex flex-col items-center justify-center px-6 py-10">

      {/* Professional card */}
      <div className="flex flex-col items-center mb-8">
        <div className="relative mb-3">
          {doctorAvatar ? (
            <img src={doctorAvatar} alt={doctorName}
              className="w-20 h-20 rounded-full object-cover border-2 border-white shadow-md" />
          ) : (
            <div className="w-20 h-20 rounded-full bg-brand-muted border-2 border-white shadow-md flex items-center justify-center text-[28px] font-serif text-brand">
              {initial}
            </div>
          )}
          {consultation?.professional?.professionalProfiles?.[0]?.isVerified && (
            <SealCheck className="absolute -bottom-0.5 -right-0.5 w-5 h-5 text-brand" weight="fill" />
          )}
        </div>
        <p className="font-bold text-[17px] text-text-primary">{doctorName}</p>
        {scheduledStr && (
          <p className="text-[13px] text-text-secondary mt-0.5 text-center max-w-[240px]">{scheduledStr}</p>
        )}
      </div>

      {/* Status icon */}
      <div className={`w-20 h-20 rounded-full flex items-center justify-center mb-4 shadow-sm transition-colors duration-500 ${canEnter ? 'bg-brand text-white' : 'bg-brand-muted'}`}>
        {canEnter
          ? <VideoCamera className="w-9 h-9 text-white" />
          : <Clock className="w-9 h-9 text-brand" />}
      </div>

      {/* Status title */}
      <h1 className="text-[24px] font-bold text-text-primary text-center leading-tight mb-2">
        {canEnter ? '¡Ya podés entrar!' : 'Sala de espera'}
      </h1>

      {/* Countdown or waiting message */}
      <p className="text-[14px] text-text-secondary text-center leading-relaxed mb-6 max-w-xs">
        {canEnter
          ? `${doctorName} te habilitó. Entrá cuando quieras.`
          : countdown
            ? `La consulta comienza en ${countdown}`
            : `Ya le avisamos a ${doctorName}. Esperando que se conecte${dots}`}
      </p>

      {/* Animated dots */}
      {!canEnter && (
        <div className="mb-6 flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-brand animate-[pulse_1.2s_ease-in-out_infinite]" />
          <div className="w-2 h-2 rounded-full bg-brand animate-[pulse_1.2s_ease-in-out_0.4s_infinite]" />
          <div className="w-2 h-2 rounded-full bg-brand animate-[pulse_1.2s_ease-in-out_0.8s_infinite]" />
        </div>
      )}

      {/* Enter CTA */}
      <button
        onClick={handleEnter}
        disabled={!canEnter || entering}
        className={`flex items-center gap-2.5 px-8 py-4 rounded-full font-bold text-[16px] transition-all shadow-md mb-4 ${
          canEnter
            ? 'bg-brand text-white hover:bg-brand-hover active:scale-95'
            : 'bg-gray-100 text-gray-400 cursor-not-allowed opacity-40'
        }`}
      >
        <VideoCamera className="w-5 h-5" />
        {entering ? 'Entrando...' : 'Entrar a la consulta'}
      </button>

      {/* Back link */}
      <button
        onClick={() => navigate('/paciente/consultas')}
        className="text-[13px] text-text-tertiary font-medium py-2 hover:text-text-secondary transition-colors"
      >
        Salir de la sala de espera
      </button>
    </div>
  )
}
