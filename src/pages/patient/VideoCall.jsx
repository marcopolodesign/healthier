import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  PhoneSlash, CircleNotch, SealCheck, User,
  Microphone, MicrophoneSlash, Camera, CameraSlash,
} from '@phosphor-icons/react'
import DailyIframe from '@daily-co/daily-js'
import { supabase } from '../../lib/supabase'
import { consultationsService } from '../../services/consultationsService'
import { toast } from '../../components/Toast'
import PreconsultaForm from '../../components/patient/PreconsultaForm'

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
 *  2. If heural_appointment_id → show PreconsultaForm first.
 *  3. After submit/skip → join Daily.co room via createCallObject (no prebuilt UI).
 */
export default function PatientVideoCall() {
  const { id } = useParams()
  const navigate = useNavigate()
  const callRef = useRef(null)
  const channelRef = useRef(null)

  const [consultation, setConsultation] = useState(null)
  const [loadingConsultation, setLoadingConsultation] = useState(true)
  // bothReady: both patient + professional are in the presence waiting room
  const [bothReady, setBothReady] = useState(false)
  const [joining, setJoining] = useState(false)

  // Validation code overlay
  const [validationCode, setValidationCode] = useState(null)

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
        setConsultation(cons)
        if (cons?.heuralAppointmentId) {
          setShowPreconsulta(true)
        } else {
          setPreconsultaDone(true)
        }
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

  // ── Step 2: Join presence channel after preconsulta ─────────────────────────
  useEffect(() => {
    if (!preconsultaDone || loadingConsultation) return
    const consultationId = id === '1' ? null : id
    if (!consultationId) { setBothReady(true); return } // demo mode: skip presence

    let destroyed = false
    const ch = supabase.channel(`consultation-waiting-${consultationId}`)
    channelRef.current = ch

    ch.on('presence', { event: 'sync' }, () => {
      if (destroyed) return
      const state = ch.presenceState()
      const roles = Object.values(state).flat().map(p => p.role)
      setBothReady(roles.includes('professional') && roles.includes('patient'))
    })

    ch.subscribe(async (status) => {
      if (status === 'SUBSCRIBED' && !destroyed) {
        await ch.track({ role: 'patient' })
      }
    })

    return () => {
      destroyed = true
      ch.untrack().catch(() => {})
      supabase.removeChannel(ch)
      channelRef.current = null
    }
  }, [preconsultaDone, loadingConsultation, id])

  // ── Step 3: Join Daily.co when both are ready ───────────────────────────────
  useEffect(() => {
    if (!bothReady) return
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
          if (destroyed) return
          setJoining(false)
          const local = call.participants().local
          setLocalVideoTrack(local?.tracks?.video?.persistentTrack ?? null)
          setCamOn(local?.tracks?.video?.state === 'playable')
          setMicOn(local?.tracks?.audio?.state !== 'off')
        })

        call.on('participant-joined', ({ participant }) => {
          if (destroyed || participant.local) return
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
          if (!participant.local && !destroyed) setRemote(null)
        })

        call.on('left-meeting', async () => {
          if (destroyed) return
          if (consultationId) {
            try { await consultationsService.finalize(consultationId, 'patient') } catch { /* non-blocking */ }
            navigate(`/paciente/consulta/review/${consultationId}`)
          } else {
            navigate('/paciente/consultas')
          }
        })

        call.on('error', ({ errorMsg }) => {
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
      callRef.current?.leave()
      callRef.current?.destroy()
      callRef.current = null
    }
  }, [bothReady])

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
      try { await consultationsService.finalize(consultationId, 'patient') } catch { /* non-blocking */ }
      navigate(`/paciente/consulta/review/${consultationId}`)
    } else {
      navigate('/paciente/consultas')
    }
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

  const inWaitingRoom = preconsultaDone && !bothReady && !joining

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
          {bothReady && !joining && (
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
          bothReady && !joining && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center space-y-3">
                <div className="w-24 h-24 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mx-auto">
                  <User className="h-12 w-12 text-white/15" />
                </div>
                <p className="text-white/30 text-sm">Esperando video del profesional…</p>
              </div>
            </div>
          )
        )}

        {/* Remote audio (invisible) */}
        {remote?.audioTrack && <AudioPlayer track={remote.audioTrack} />}

        {/* Local camera — PiP bottom-right (shown once in call) */}
        {bothReady && !joining && (
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

        {/* Validation code pill */}
        {validationCode && (
          <div className="absolute top-3 right-3 z-20 pointer-events-none flex items-center gap-1.5 bg-white/90 backdrop-blur-sm border border-white/60 rounded-full px-3 py-1.5 shadow-md">
            <SealCheck className="w-3.5 h-3.5 text-brand flex-shrink-0" />
            <span className="text-[11px] font-bold text-gray-800 whitespace-nowrap">
              Tu código <span className="text-brand font-black tracking-wide">{validationCode}</span>
            </span>
          </div>
        )}
      </div>

      {/* Pre-consulta sheet */}
      <PreconsultaForm
        isOpen={showPreconsulta}
        onClose={handlePreconsultaClose}
        appointmentHeuralId={consultation?.heuralAppointmentId ?? null}
        onSubmitted={handlePreconsultaSubmitted}
      />
    </div>
  )
}
