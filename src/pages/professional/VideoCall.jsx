import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, PhoneOff } from 'lucide-react'
import DailyIframe from '@daily-co/daily-js'
import { consultationsService } from '../../services/consultationsService'
import CloseConsultationModal from '../../components/CloseConsultationModal'
import { toast } from '../../components/Toast'

export default function ProfessionalVideoCall({ profile }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const containerRef = useRef(null)
  const callFrameRef = useRef(null)
  const [consultation, setConsultation] = useState(null)
  const [loading, setLoading] = useState(true)
  const [closeModal, setCloseModal] = useState(false)

  useEffect(() => {
    let destroyed = false

    async function init() {
      try {
        const [cons, { roomUrl, token }] = await Promise.all([
          consultationsService.getById(id),
          consultationsService.getDailyAccess(id),
        ])
        if (destroyed) return
        setConsultation(cons)

        const callFrame = DailyIframe.createFrame(containerRef.current, {
          iframeStyle: { width: '100%', height: '100%', border: 'none', borderRadius: '12px' },
          showLeaveButton: false,
          showFullscreenButton: true,
          lang: 'es',
        })
        callFrameRef.current = callFrame

        callFrame.on('left-meeting', () => { if (!destroyed) setCloseModal(true) })
        callFrame.on('error', e => {
          toast.error(`Error en la videollamada: ${e.errorMsg}`)
          if (!destroyed) setLoading(false)
        })
        // Hide our spinner as soon as Daily starts loading so the user
        // can see and interact with Daily's pre-join haircheck screen.
        callFrame.on('loading', () => { if (!destroyed) setLoading(false) })

        callFrame.join({ url: roomUrl, token }).catch(err => {
          if (!destroyed) {
            toast.error('No se pudo iniciar la videollamada')
            navigate('/profesional/dashboard')
          }
        })
      } catch (err) {
        if (!destroyed) {
          toast.error('No se pudo iniciar la videollamada')
          setLoading(false)
          navigate('/profesional/dashboard')
        }
      }
    }

    init()
    return () => {
      destroyed = true
      callFrameRef.current?.destroy()
    }
  }, [id])

  const handleFinalized = () => {
    callFrameRef.current?.destroy()
    navigate('/profesional/consulta/' + id)
  }

  return (
    <div className="flex flex-col h-screen bg-bg-primary">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border-default bg-bg-surface shrink-0">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1 text-sm text-text-secondary hover:text-brand"
        >
          <ArrowLeft className="h-4 w-4" /> Volver
        </button>
        <span className="text-sm font-medium text-text-primary">
          {consultation?.patient?.fullName ?? 'Videoconsulta'}
        </span>
        <button
          onClick={() => setCloseModal(true)}
          className="btn-danger flex items-center gap-2 px-4 py-2 text-sm"
        >
          <PhoneOff className="h-4 w-4" />
          Finalizar
        </button>
      </div>

      {/* Daily iframe container */}
      <div className="flex-1 relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-bg-primary z-10">
            <div className="text-center space-y-3">
              <div className="h-10 w-10 border-2 border-brand border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-sm text-text-secondary">Conectando sala…</p>
            </div>
          </div>
        )}
        <div ref={containerRef} className="w-full h-full" />
      </div>

      {consultation && (
        <CloseConsultationModal
          open={closeModal}
          onClose={() => setCloseModal(false)}
          consultationId={id}
          patientName={consultation.patient?.fullName}
          profile={profile}
          onFinalized={handleFinalized}
        />
      )}
    </div>
  )
}
