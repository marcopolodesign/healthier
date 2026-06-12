import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { PhoneSlash, CircleNotch, SealCheck } from '@phosphor-icons/react'
import DailyIframe from '@daily-co/daily-js'
import { consultationsService } from '../../services/consultationsService'
import { toast } from '../../components/Toast'
import PreconsultaForm from '../../components/patient/PreconsultaForm'

/**
 * Patient video call page — /paciente/videollamada/:id
 *
 * Flow:
 *  1. Load consultation by :id param.
 *  2. If it has a heural_appointment_id AND preconsulta hasn't been done this
 *     session → show PreconsultaForm.
 *  3. After submit (or skip), mount the Daily.co iframe and join the room.
 */
export default function PatientVideoCall({ profile }) {
  const { id } = useParams()
  const navigate = useNavigate()

  const containerRef = useRef(null)
  const callFrameRef = useRef(null)

  const [consultation, setConsultation] = useState(null)
  const [loadingConsultation, setLoadingConsultation] = useState(true)
  const [callLoading, setCallLoading] = useState(false)

  // Validation code overlay
  const [validationCode, setValidationCode] = useState(null)

  // Pre-consulta gate
  const [showPreconsulta, setShowPreconsulta] = useState(false)
  const [preconsultaDone, setPreconsultaDone] = useState(false)

  // ── Step 1: Load consultation ───────────────────────────────────────────────
  useEffect(() => {
    if (!id) return

    // Use hardcoded consultation lookup when id is a placeholder ('1')
    // In production this will always be a real UUID
    const consultationId = id === '1' ? null : id

    if (!consultationId) {
      // Demo mode — no real consultation, skip preconsulta and go straight to call
      setLoadingConsultation(false)
      setPreconsultaDone(true)
      return
    }

    consultationsService.getById(consultationId)
      .then((cons) => {
        setConsultation(cons)
        // Show preconsulta form if there is a Heural appointment ID
        if (cons?.heuralAppointmentId) {
          setShowPreconsulta(true)
        } else {
          // No Heural appointment — skip straight to call
          setPreconsultaDone(true)
        }
      })
      .catch(() => {
        toast.error('No se pudo cargar la consulta')
        navigate('/paciente/consultas')
      })
      .finally(() => setLoadingConsultation(false))

    // Fetch validation code in parallel (non-blocking)
    consultationsService.getValidationCode(consultationId)
      .then(code => { if (code) setValidationCode(code) })
      .catch(() => {})
  }, [id])

  // ── Step 2: After preconsulta → join call ───────────────────────────────────
  useEffect(() => {
    if (!preconsultaDone) return
    if (loadingConsultation) return

    let destroyed = false
    setCallLoading(true)

    const consultationId = id === '1' ? null : id

    async function joinCall() {
      try {
        let roomUrl, token

        if (consultationId) {
          const access = await consultationsService.getDailyAccess(consultationId)
          roomUrl = access.roomUrl
          token = access.token
        } else {
          // Demo mode — point to a public Daily test room
          roomUrl = `https://healthier.daily.co/demo`
          token = undefined
        }

        if (destroyed) return

        const callFrame = DailyIframe.createFrame(containerRef.current, {
          iframeStyle: { width: '100%', height: '100%', border: 'none' },
          showLeaveButton: false,
          showFullscreenButton: true,
          lang: 'es',
        })
        callFrameRef.current = callFrame

        callFrame.on('left-meeting', async () => {
          if (destroyed) return
          if (consultationId) {
            try {
              await consultationsService.finalize(consultationId, 'patient')
            } catch {
              // non-blocking — always navigate regardless
            }
            navigate(`/paciente/consulta/review/${consultationId}`)
          } else {
            navigate('/paciente/consultas')
          }
        })
        callFrame.on('error', (e) => {
          toast.error(`Error en la videollamada: ${e.errorMsg}`)
          if (!destroyed) setCallLoading(false)
        })
        callFrame.on('loading', () => {
          if (!destroyed) setCallLoading(false)
        })

        await callFrame.join({ url: roomUrl, ...(token ? { token } : {}) })
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
      callFrameRef.current?.destroy()
      callFrameRef.current = null
    }
  }, [preconsultaDone, loadingConsultation, id])

  // ── Handlers ────────────────────────────────────────────────────────────────
  const handlePreconsultaSubmitted = () => {
    setShowPreconsulta(false)
    setPreconsultaDone(true)
  }

  const handlePreconsultaClose = () => {
    // Patient closed the form without submitting — treat as skip
    setShowPreconsulta(false)
    setPreconsultaDone(true)
  }

  const handleHangUp = async () => {
    const consultationId = id === '1' ? null : id
    callFrameRef.current?.destroy()
    callFrameRef.current = null
    if (consultationId) {
      try {
        await consultationsService.finalize(consultationId, 'patient')
      } catch {
        // non-blocking
      }
      navigate(`/paciente/consulta/review/${consultationId}`)
    } else {
      navigate('/paciente/consultas')
    }
  }

  // ── Loading skeleton ─────────────────────────────────────────────────────────
  if (loadingConsultation) {
    return (
      <div className="absolute inset-0 bg-gray-900 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          <span className="text-white/60 text-sm font-medium">Preparando sala...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="absolute inset-0 bg-gray-900 flex flex-col">
      {/* Minimal header — always on top */}
      <div className="flex items-center justify-between px-5 py-3 bg-gray-900/80 backdrop-blur-sm border-b border-white/10 flex-shrink-0 z-10">
        <span className="text-white/80 text-[14px] font-semibold truncate">
          {consultation?.professional?.fullName
            ? `Dr/a. ${consultation.professional.fullName}`
            : 'Videoconsulta'}
        </span>
        <button
          onClick={handleHangUp}
          className="flex items-center gap-2 bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-full text-[13px] font-bold transition-colors active:scale-95"
        >
          <PhoneSlash className="w-4 h-4" />
          Salir
        </button>
      </div>

      {/* Video container */}
      <div className="flex-1 relative">
        {/* Loading overlay — shown until Daily fires 'loading' event */}
        {callLoading && preconsultaDone && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900 z-10">
            <CircleNotch className="w-10 h-10 text-brand animate-spin mb-3" />
            <p className="text-white/60 text-sm font-medium">Conectando sala...</p>
          </div>
        )}

        {/* Waiting state when preconsulta is still open */}
        {!preconsultaDone && !showPreconsulta && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900 z-10">
            <CircleNotch className="w-10 h-10 text-brand animate-spin mb-3" />
            <p className="text-white/60 text-sm font-medium">Un momento...</p>
          </div>
        )}

        <div ref={containerRef} className="w-full h-full" />

        {/* Validation code pill — floating, non-interactive, top-right */}
        {validationCode && (
          <div
            className="absolute top-3 right-3 z-20 pointer-events-none flex items-center gap-1.5 bg-white/90 backdrop-blur-sm border border-white/60 rounded-full px-3 py-1.5 shadow-md"
          >
            <SealCheck className="w-3.5 h-3.5 text-brand flex-shrink-0" />
            <span className="text-[11px] font-bold text-gray-800 whitespace-nowrap">
              Tu código <span className="text-brand font-black tracking-wide">{validationCode}</span>
            </span>
          </div>
        )}
      </div>

      {/* Pre-consulta sheet — overlays the video container */}
      <PreconsultaForm
        isOpen={showPreconsulta}
        onClose={handlePreconsultaClose}
        appointmentHeuralId={consultation?.heuralAppointmentId ?? null}
        onSubmitted={handlePreconsultaSubmitted}
      />
    </div>
  )
}
