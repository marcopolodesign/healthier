import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  PhoneSlash, CircleNotch, SealCheck, User,
  Microphone, MicrophoneSlash, Camera, CameraSlash, Warning, Pill,
} from '@phosphor-icons/react'
import DailyIframe from '@daily-co/daily-js'
import { supabase } from '../../lib/supabase'
import { consultationsService } from '../../services/consultationsService'
import { toast } from '../../components/Toast'
import { consultationEventsService, CONSULTATION_EVENTS } from '../../services/consultationEventsService'
import PreconsultaForm from '../../components/patient/PreconsultaForm'

// Margen antes de cerrarle la llamada al paciente cuando el profesional se va: un
// refresh del profesional también dispara `participant-left`.
const PRO_LEFT_GRACE_MS = 8000

const NO_SHOW_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes — mirrors professional/VideoCall.jsx

// ── Audio element for remote participant (invisible) ──────────────────────────
function AudioPlayer({ track }) {
  const ref = useRef(null)
  useEffect(() => {
    if (ref.current && track) ref.current.srcObject = new MediaStream([track])
  }, [track])
  return <audio ref={ref} autoPlay playsInline />
}

// ── Video tile — attaches a MediaStreamTrack to a <video> element ─────────────
function VideoTile({ track, muted = false, mirror = false, className = '' }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!ref.current) return
    ref.current.srcObject = track ? new MediaStream([track]) : null
  }, [track])
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted={muted}
      className={`${mirror ? '[transform:scaleX(-1)]' : ''} ${className}`}
    />
  )
}

/**
 * Patient video call page — /paciente/videollamada/:id
 *
 * Flow:
 *  1. Load consultation.
 *  2. Show PreconsultaForm first.
 *  3. After submit/skip → join Daily.co room via createCallObject (no prebuilt UI).
 */
export default function PatientVideoCall() {
  const { id } = useParams()
  const navigate = useNavigate()
  const callRef = useRef(null)
  const channelRef = useRef(null)
  const noShowTimerRef = useRef(null)
  const proLeftTimerRef = useRef(null)
  // Se muestra en pantalla mientras corre el margen, para que el cierre no
  // aparezca como que se cortó solo.
  const [profesionalSeFue, setProfesionalSeFue] = useState(false)
  // Set true only when the professional's Daily.co participant actually joins the
  // call (distinct from bothReady, which only means both sides are in the presence
  // waiting room). Used to decide review vs. cancellation screen on hangup.
  const professionalJoinedRef = useRef(false)

  const [consultation, setConsultation] = useState(null)
  const [loadingConsultation, setLoadingConsultation] = useState(true)
  /**
   * Compuerta para ENTRAR a Daily: late una vez y no vuelve atrás. Misma razón que
   * del lado del profesional — `bothReady` es presencia en vivo, y usarla para
   * decidir si QUEDARSE hacía que un bajón momentáneo del otro lado ejecutara
   * `call.leave()` y tirara la llamada abajo. Quién está en la sala lo sabe Daily.
   */
  const [joinGate, setJoinGate] = useState(false)
  const [joining, setJoining] = useState(false)
  const [noShowBanner, setNoShowBanner] = useState(false)

  // Validation code overlay
  const [validationCode, setValidationCode] = useState(null)
  // El profesional pidió el código de cierre (migración 099) — se le muestra un
  // aviso con un solo botón: "Aceptar y compartir". Aceptar ES compartir, no
  // hace falta que dicte los 4 dígitos.
  const [solicitudCodigo, setSolicitudCodigo] = useState(false)
  const [codigoCompartido, setCodigoCompartido] = useState(false)

  // Pre-consulta gate
  const [showPreconsulta, setShowPreconsulta] = useState(false)
  const [preconsultaDone, setPreconsultaDone] = useState(false)

  // Camera/mic controls
  const [camOn, setCamOn] = useState(true)
  const [micOn, setMicOn] = useState(true)
  const [localVideoTrack, setLocalVideoTrack] = useState(null)

  // Remote participant
  const [remote, setRemote] = useState(null)

  // ── Step 1: Load consultation ───────────────────────────────────────────────
  useEffect(() => {
    if (!id) return
    const consultationId = id === '1' ? null : id

    if (!consultationId) {
      setLoadingConsultation(false)
      setPreconsultaDone(true)
      return
    }

    consultationsService.getById(consultationId)
      .then((cons) => {
        /*
         * Sin pago no se entra. Esta pantalla no miraba el cobro en absoluto:
         * alcanzaba con que la consulta estuviera `confirmed`, y una consulta
         * on-demand nace confirmada ANTES de cobrar. El 2026-07-31 MP rechazó
         * el pago (`cc_rejected_high_risk`) y la videollamada se pudo abrir
         * igual — una consulta gratis.
         *
         * `in_process` es la pre-autorización aprobada (plata reservada, se
         * captura al cerrar), así que sí habilita. `pending_payment` incluye
         * "MP lo está revisando", que todavía no es un sí.
         */
        const sinCargo = cons?.priceAtBooking == null || Number(cons.priceAtBooking) === 0
        const pagoOk = sinCargo || ['paid', 'in_process'].includes(cons?.paymentStatus)
        if (cons && !pagoOk) {
          toast.error('Esta consulta todavía no tiene el pago confirmado.')
          navigate('/paciente/consultas')
          return
        }
        setConsultation(cons)
        // El profesional cortó la llamada y está cargando el cierre (migración
        // 098): no hay nada a lo que unirse — la llamada ya terminó. Se corta
        // acá, antes de la pre-consulta y de pedir acceso a Daily, y se muestra
        // la pantalla de "Preparando tu receta" en vez de esto. El bloqueo real
        // (por si alguien pega la URL o toca "atrás") vive en el servidor:
        // `daily-token` rechaza el token mientras el estado sea `closing`.
        if (cons?.status === 'closing') return
        // The waiting room now asks this before letting anyone in, so the normal
        // path arrives here already answered — don't ask twice. The form stays as
        // a fallback for anyone landing on the call URL directly.
        const d = cons?.preconsultaData
        const alreadyAnswered = Boolean(d && typeof d === 'object' && (d.main_complaint || d.mainComplaint || d.symptoms))
        if (alreadyAnswered) setPreconsultaDone(true)
        else setShowPreconsulta(true)
      })
      .catch(() => {
        toast.error('No se pudo cargar la consulta')
        navigate('/paciente/consultas')
      })
      .finally(() => setLoadingConsultation(false))

    consultationsService.getValidationCode(consultationId)
      .then(code => { if (code) setValidationCode(code) })
      .catch(() => {})
  }, [id])

  // ── "Preparando tu receta" — el profesional está cerrando (status='closing') ──
  // Se sondea cada 5s en vez de escuchar Realtime: esta pantalla ya vive casi
  // siempre unos segundos nomás (el cierre es rápido), así que un poll simple
  // alcanza y evita sumar una suscripción más a un componente que ya tiene la
  // del presence channel. Al salir de `closing` (típicamente a `completed`) se
  // manda al inicio, donde el banner de "Tu consulta terminó" (mismo patrón que
  // "Continuar con tu turno") ofrece el resumen y la receta.
  useEffect(() => {
    if (consultation?.status !== 'closing') return
    const consultationId = id === '1' ? null : id
    if (!consultationId) return
    let cancelled = false
    const iv = setInterval(() => {
      consultationsService.getById(consultationId)
        .then(latest => {
          if (cancelled) return
          if (latest?.status === 'closing') { setConsultation(latest); return }
          navigate('/paciente/dashboard')
        })
        .catch(() => {})
    }, 5000)
    return () => { cancelled = true; clearInterval(iv) }
  }, [consultation?.status, id])

  // ── Step 2: Join presence channel after preconsulta ─────────────────────────
  useEffect(() => {
    if (!preconsultaDone || loadingConsultation) return
    const consultationId = id === '1' ? null : id
    if (!consultationId) { setBothReady(true); return } // demo mode: skip presence

    let destroyed = false
    const ch = supabase.channel(`consultation-waiting-${consultationId}`)
    channelRef.current = ch

    // El profesional pidió el código de cierre (migración 099). Reusa este
    // mismo canal de presencia — ya está abierto para el "ready"/no-show — en
    // vez de armar uno nuevo sólo para esto. Los listeners de broadcast tienen
    // que registrarse ANTES de `subscribe()`.
    ch.on('broadcast', { event: 'solicitar_codigo' }, () => {
      if (!destroyed) setSolicitudCodigo(true)
    })

    ch.on('presence', { event: 'sync' }, () => {
      if (destroyed) return
      const state = ch.presenceState()
      const roles = Object.values(state).flat().map(p => p.role)
      const ready = roles.includes('professional') && roles.includes('patient')
      if (ready) {
        clearTimeout(noShowTimerRef.current)
        setNoShowBanner(false)
        setJoinGate(true)
      }
    })

    ch.subscribe(async (status) => {
      if (status === 'SUBSCRIBED' && !destroyed) {
        await ch.track({ role: 'patient' })
        // Start 5-minute no-show countdown (mirrors professional/VideoCall.jsx)
        noShowTimerRef.current = setTimeout(() => {
          if (!destroyed) setNoShowBanner(true)
        }, NO_SHOW_TIMEOUT_MS)
      }
    })

    return () => {
      destroyed = true
      clearTimeout(noShowTimerRef.current)
      ch.untrack().catch(() => {})
      supabase.removeChannel(ch)
      channelRef.current = null
    }
  }, [preconsultaDone, loadingConsultation, id])

  // ── Step 3: Join Daily.co when both are ready ───────────────────────────────
  useEffect(() => {
    if (!joinGate) return
    const consultationId = id === '1' ? null : id
    let destroyed = false
    setJoining(true)

    async function joinCall() {
      try {
        let roomUrl, token
        if (consultationId) {
          const access = await consultationsService.getDailyAccess(consultationId)
          roomUrl = access.roomUrl
          token = access.token
        } else {
          roomUrl = 'https://healthier.daily.co/demo'
          token = undefined
        }
        if (destroyed) return

        const DailyLib = window.__DailyIframeMock ?? DailyIframe
        const call = DailyLib.createCallObject()
        callRef.current = call

        call.on('joined-meeting', () => {
          consultationEventsService.log(consultationId, CONSULTATION_EVENTS.CALL_JOINED, null, { role: 'patient' })
          if (destroyed) return
          setJoining(false)
          const local = call.participants().local
          setLocalVideoTrack(local?.tracks?.video?.persistentTrack ?? null)
          setCamOn(local?.tracks?.video?.state === 'playable')
          setMicOn(local?.tracks?.audio?.state !== 'off')
        })

        call.on('participant-joined', ({ participant }) => {
          if (!participant.local) {
            // Volvió (o llegó): se cancela el cierre automático.
            clearTimeout(proLeftTimerRef.current)
            setProfesionalSeFue(false)
          }
          consultationEventsService.log(consultationId, CONSULTATION_EVENTS.CALL_PARTICIPANT_JOINED,
            { participant_id: participant?.session_id, owner: participant?.owner, user_name: participant?.user_name },
            { role: 'patient' })
          if (destroyed || participant.local) return
          // The professional's Daily.co participant actually joined the call —
          // distinct from bothReady (which only tracks the presence waiting room).
          professionalJoinedRef.current = true
          setRemote({
            videoTrack: participant.tracks?.video?.persistentTrack ?? null,
            audioTrack: participant.tracks?.audio?.persistentTrack ?? null,
          })
        })

        call.on('participant-updated', ({ participant }) => {
          if (destroyed) return
          if (participant.local) {
            setLocalVideoTrack(participant.tracks?.video?.persistentTrack ?? null)
            setCamOn(participant.tracks?.video?.state === 'playable')
            setMicOn(participant.tracks?.audio?.state !== 'off')
          } else {
            setRemote({
              videoTrack: participant.tracks?.video?.persistentTrack ?? null,
              audioTrack: participant.tracks?.audio?.persistentTrack ?? null,
            })
          }
        })

        call.on('participant-left', ({ participant }) => {
          if (participant.local || destroyed) return
          setRemote(null)
          // Si se va el profesional, la consulta terminó: el paciente no tiene por
          // qué quedarse solo en una sala mirando el vacío hasta que se le ocurra
          // colgar (pedido de Mateo, 2026-07-30 — va en este sentido y no al revés).
          // Con margen: un refresh del profesional también dispara `participant-left`
          // y no debería echar al paciente. Si vuelve, se cancela.
          clearTimeout(proLeftTimerRef.current)
          setProfesionalSeFue(true)
          proLeftTimerRef.current = setTimeout(() => {
            if (!destroyed) callRef.current?.leave().catch(() => {})
          }, PRO_LEFT_GRACE_MS)
        })

        call.on('left-meeting', async () => {
          consultationEventsService.log(consultationId, CONSULTATION_EVENTS.CALL_LEFT, null, { role: 'patient' })
          if (destroyed) return
          if (consultationId) {
            await goToPostCallScreen(consultationId)
          } else {
            navigate('/paciente/consultas')
          }
        })

        call.on('error', ({ errorMsg }) => {
          consultationEventsService.log(consultationId, CONSULTATION_EVENTS.CALL_ERROR,
            { error: errorMsg ?? 'desconocido' }, { role: 'patient' })
          toast.error(`Error en la videollamada: ${errorMsg ?? 'desconocido'}`)
          if (!destroyed) setJoining(false)
        })

        await call.join({ url: roomUrl, ...(token ? { token } : {}) })
      } catch {
        if (!destroyed) {
          toast.error('No se pudo iniciar la videollamada')
          navigate('/paciente/consultas')
        }
      }
    }

    joinCall()
    return () => {
      destroyed = true
      clearTimeout(proLeftTimerRef.current)
      callRef.current?.leave()
      callRef.current?.destroy()
      callRef.current = null
    }
  }, [joinGate])

  // ── Controls ────────────────────────────────────────────────────────────────
  async function toggleCam() {
    const next = !camOn
    setCamOn(next)
    try { await callRef.current?.setLocalVideo(next) }
    catch { setCamOn(!next) }
  }

  async function toggleMic() {
    const next = !micOn
    setMicOn(next)
    try { await callRef.current?.setLocalAudio(next) }
    catch { setMicOn(!next) }
  }

  async function handleHangUp() {
    const consultationId = id === '1' ? null : id
    try { await callRef.current?.leave() } catch { /* ignore */ }
    callRef.current?.destroy()
    callRef.current = null
    if (consultationId) {
      await goToPostCallScreen(consultationId)
    } else {
      navigate('/paciente/consultas')
    }
  }

  // Decide review (professional joined) vs. cancellation (professional never joined)
  // screen on hangup. Defensively re-checks DB status too, since the professional's
  // own "Marcar como ausente" button or the expire-stale-appointments cron job could
  // have already flipped the consultation to 'no_show'.
  async function goToPostCallScreen(consultationId) {
    if (!professionalJoinedRef.current) {
      try {
        const latest = await consultationsService.getById(consultationId)
        if (latest?.status !== 'no_show' && latest?.status !== 'cancelled') {
          await consultationsService.updateStatus(consultationId, 'no_show')
        }
      } catch { /* non-blocking */ }
      navigate(`/paciente/consulta/review/${consultationId}`)
      return
    }
    try { await consultationsService.finalize(consultationId, 'patient') } catch { /* non-blocking */ }
    navigate(`/paciente/consulta/review/${consultationId}`)
  }

  async function handleProfessionalNoShow() {
    const consultationId = id === '1' ? null : id
    if (consultationId) {
      try { await consultationsService.updateStatus(consultationId, 'no_show') } catch { /* non-blocking */ }
    }
    callRef.current?.leave().catch(() => {})
    callRef.current?.destroy()
    callRef.current = null
    if (consultationId) {
      navigate(`/paciente/consulta/review/${consultationId}`)
    } else {
      navigate('/paciente/consultas')
    }
  }

  // Compartir el código de cierre con el profesional — a mano ("Compartir
  // código") o aceptando su pedido ("Aceptar y compartir"), es la misma
  // acción. Va por el canal de presencia que ya está abierto: el profesional
  // lo recibe y lo auto-verifica, sin que el paciente tenga que dictarlo.
  async function compartirCodigo() {
    if (!validationCode || !channelRef.current) return
    const consultationId = id === '1' ? null : id
    try {
      await channelRef.current.send({
        type: 'broadcast',
        event: 'codigo_compartido',
        payload: { code: validationCode },
      })
      setSolicitudCodigo(false)
      setCodigoCompartido(true)
      consultationEventsService.log(consultationId, CONSULTATION_EVENTS.CODE_SHARED, null, { role: 'patient' })
      setTimeout(() => setCodigoCompartido(false), 4000)
    } catch {
      toast.error('No se pudo compartir el código. Probá de nuevo.')
    }
  }

  function handleKeepWaitingForProfessional() {
    setNoShowBanner(false)
    // Reset 5-minute timer
    noShowTimerRef.current = setTimeout(() => setNoShowBanner(true), NO_SHOW_TIMEOUT_MS)
  }

  const handlePreconsultaSubmitted = () => { setShowPreconsulta(false); setPreconsultaDone(true) }
  const handlePreconsultaClose = () => { setShowPreconsulta(false); setPreconsultaDone(true) }

  // ── Loading skeleton ─────────────────────────────────────────────────────────
  if (loadingConsultation) {
    return (
      <div className="absolute inset-0 bg-zinc-900 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          <span className="text-white/60 text-sm font-medium">Preparando sala...</span>
        </div>
      </div>
    )
  }

  // ── Preparando tu receta ─────────────────────────────────────────────────────
  // El profesional cortó la llamada y está cargando el cierre. No hay nada a lo
  // que unirse — se corta antes de la pre-consulta y de Daily (ver Step 1) — y
  // el poll de arriba manda al inicio en cuanto el profesional termina.
  if (consultation?.status === 'closing') {
    return (
      <div className="absolute inset-0 bg-zinc-900 flex flex-col items-center justify-center px-6 text-center">
        <div className="w-20 h-20 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mb-5 relative">
          <Pill className="w-9 h-9 text-brand" />
          <span className="absolute inset-0 rounded-full border-2 border-brand/30 animate-ping" />
        </div>
        <h1 className="text-white text-[20px] font-semibold mb-2">Preparando tu receta</h1>
        <p className="text-white/50 text-[14px] leading-relaxed max-w-xs mb-8">
          Tu profesional está terminando de cargar los datos de la consulta. En un
          toque vas a ver el resumen y tu receta desde el inicio.
        </p>
        <button
          onClick={() => navigate('/paciente/dashboard')}
          className="text-white/40 text-[13px] font-medium hover:text-white/70 transition-colors"
        >
          Volver al inicio
        </button>
      </div>
    )
  }

  // Misma razón que del lado del profesional: la sala de espera se muestra hasta
  // que entramos a la llamada, no mientras la presencia del otro parpadea.
  const inWaitingRoom = preconsultaDone && !joinGate && !joining

  return (
    <div className="absolute inset-0 bg-zinc-900 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 bg-zinc-900/80 backdrop-blur-sm border-b border-white/10 shrink-0 z-10">
        <span className="text-white/80 text-[14px] font-semibold truncate">
          {consultation?.professional?.fullName
            ? `Dr/a. ${consultation.professional.fullName}`
            : 'Videoconsulta'}
        </span>

        <div className="flex items-center gap-2">
          {joinGate && !joining && (
            <>
              <button
                onClick={toggleCam}
                title={camOn ? 'Apagar cámara' : 'Encender cámara'}
                className={`flex items-center justify-center w-9 h-9 rounded-full border transition-colors ${
                  camOn
                    ? 'border-white/20 text-white/70 hover:text-white hover:border-white/40'
                    : 'border-red-500/50 bg-red-500/10 text-red-400 hover:bg-red-500/20'
                }`}
              >
                {camOn ? <Camera className="h-4 w-4" /> : <CameraSlash className="h-4 w-4" />}
              </button>
              <button
                onClick={toggleMic}
                title={micOn ? 'Silenciar micrófono' : 'Activar micrófono'}
                className={`flex items-center justify-center w-9 h-9 rounded-full border transition-colors ${
                  micOn
                    ? 'border-white/20 text-white/70 hover:text-white hover:border-white/40'
                    : 'border-red-500/50 bg-red-500/10 text-red-400 hover:bg-red-500/20'
                }`}
              >
                {micOn ? <Microphone className="h-4 w-4" /> : <MicrophoneSlash className="h-4 w-4" />}
              </button>
            </>
          )}
          <button
            onClick={handleHangUp}
            className="flex items-center gap-2 bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-full text-[13px] font-bold transition-colors active:scale-95"
          >
            <PhoneSlash className="w-4 h-4" />
            Salir
          </button>
        </div>
      </div>

      {/* No-show banner — professional hasn't joined the waiting room after 5 min */}
      {noShowBanner && (
        <div className="shrink-0 flex items-center justify-between gap-4 px-5 py-3 bg-amber-900/60 border-b border-amber-700/40 z-10">
          <div className="flex items-center gap-2 text-amber-200 text-sm">
            <Warning className="h-4 w-4 shrink-0" />
            <span>El profesional no se unió a la consulta.</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleKeepWaitingForProfessional}
              className="text-xs px-3 py-1.5 rounded-full border border-amber-600/60 text-amber-300 hover:bg-amber-800/40 transition-colors"
            >
              Seguir esperando
            </button>
            <button
              onClick={handleProfessionalNoShow}
              className="text-xs px-3 py-1.5 rounded-full bg-amber-600 hover:bg-amber-500 text-white font-medium transition-colors"
            >
              Marcar profesional ausente
            </button>
          </div>
        </div>
      )}

      {/* Video area */}
      <div className="flex-1 relative">
        {/* Pre-consulta or loading */}
        {(!preconsultaDone && !showPreconsulta) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-900 z-10">
            <CircleNotch className="w-10 h-10 text-brand animate-spin mb-3" />
            <p className="text-white/60 text-sm font-medium">Un momento...</p>
          </div>
        )}

        {/* Waiting room — in presence channel, professional not yet ready */}
        {inWaitingRoom && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-900 z-10">
            <div className="text-center space-y-4">
              <div className="w-24 h-24 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mx-auto relative">
                <User className="h-12 w-12 text-white/15" />
                <span className="absolute inset-0 rounded-full border-2 border-brand/30 animate-ping" />
              </div>
              <div className="space-y-1">
                <p className="text-white/50 text-sm">El profesional se unirá en breve…</p>
                <p className="text-white/20 text-xs">Tu lugar está reservado</p>
              </div>
            </div>
          </div>
        )}

        {/* Connecting to Daily.co */}
        {joining && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-900 z-10">
            <CircleNotch className="w-10 h-10 text-brand animate-spin mb-3" />
            <p className="text-white/60 text-sm font-medium">Conectando sala...</p>
          </div>
        )}

        {/* Remote video — full-bleed */}
        {remote?.videoTrack ? (
          <VideoTile
            track={remote.videoTrack}
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          joinGate && !joining && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center space-y-3">
                <div className="w-24 h-24 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mx-auto">
                  <User className="h-12 w-12 text-white/15" />
                </div>
                <p className="text-white/30 text-sm">
                  {profesionalSeFue
                    ? 'El profesional finalizó la consulta. Cerrando…'
                    : 'Esperando video del profesional…'}
                </p>
              </div>
            </div>
          )
        )}

        {/* Remote audio (invisible) */}
        {remote?.audioTrack && <AudioPlayer track={remote.audioTrack} />}

        {/* Local camera — PiP bottom-right (shown once in call) */}
        {joinGate && !joining && (
          <div className="absolute bottom-4 right-4 w-36 h-24 rounded-xl overflow-hidden border border-white/10 shadow-2xl bg-zinc-800 z-10">
            {camOn && localVideoTrack ? (
              <VideoTile track={localVideoTrack} muted mirror className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <CameraSlash className="h-5 w-5 text-white/20" />
              </div>
            )}
          </div>
        )}

        {/* Validation code pill + compartir — el profesional lo necesita para
            cerrar la consulta (migración 099). "Compartir código" hace lo mismo
            que aceptar un pedido: se lo manda por el canal ya abierto, sin que
            el profesional tenga que anotar lo que el paciente dicta. */}
        {validationCode && !solicitudCodigo && (
          <div className="absolute top-3 right-3 z-20 flex items-center gap-1.5 bg-white/90 backdrop-blur-sm border border-white/60 rounded-full pl-3 pr-1.5 py-1.5 shadow-md">
            <SealCheck className="w-3.5 h-3.5 text-brand flex-shrink-0" />
            <span className="text-[11px] font-bold text-gray-800 whitespace-nowrap">
              Tu código <span className="text-brand font-black tracking-wide">{validationCode}</span>
            </span>
            <button
              onClick={compartirCodigo}
              className="text-[11px] font-semibold text-white bg-brand rounded-full px-2.5 py-1 hover:bg-brand/90 transition-colors whitespace-nowrap"
            >
              {codigoCompartido ? 'Compartido ✓' : 'Compartir'}
            </button>
          </div>
        )}

        {/* El profesional pidió el código — un solo botón: aceptar = compartir. */}
        {solicitudCodigo && (
          <div className="absolute inset-x-4 top-3 z-20 flex items-center justify-between gap-3 bg-white/95 backdrop-blur-sm border border-white/70 rounded-2xl px-4 py-3 shadow-md">
            <div className="flex items-center gap-2 min-w-0">
              <SealCheck className="w-4 h-4 text-brand flex-shrink-0" />
              <p className="text-[12px] font-semibold text-gray-800 leading-tight">
                Tu profesional pidió tu código de cierre
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => setSolicitudCodigo(false)}
                className="text-[11px] font-medium text-gray-500 px-2 py-1.5"
              >
                Ahora no
              </button>
              <button
                onClick={compartirCodigo}
                className="text-[11px] font-bold text-white bg-brand rounded-full px-3 py-1.5 hover:bg-brand/90 transition-colors whitespace-nowrap"
              >
                Aceptar y compartir
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Pre-consulta sheet */}
      <PreconsultaForm
        isOpen={showPreconsulta}
        onClose={handlePreconsultaClose}
        consultationId={consultation?.id ?? null}
        onSubmitted={handlePreconsultaSubmitted}
      />
    </div>
  )
}
