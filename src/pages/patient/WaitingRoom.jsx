import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Clock, VideoCamera } from '@phosphor-icons/react'
import { supabase } from '../../lib/supabase'
import { consultationsService } from '../../services/consultationsService'

/**
 * Patient waiting room — /paciente/sala-espera/:consultationId
 *
 * Shows a waiting state until the professional joins (status → in_progress).
 * Subscribes to Supabase Realtime UPDATE events on the consultations table.
 * "Entrar a la consulta" is disabled until the doctor is ready.
 */
export default function WaitingRoom({ profile }) {
  const { consultationId } = useParams()
  const navigate = useNavigate()

  const [consultation, setConsultation] = useState(null)
  const [doctorReady, setDoctorReady] = useState(false)
  const [entering, setEntering] = useState(false)
  const [dots, setDots] = useState('')

  // Animate waiting dots
  useEffect(() => {
    const iv = setInterval(() => setDots(d => (d.length >= 3 ? '' : d + '.')), 500)
    return () => clearInterval(iv)
  }, [])

  // Load consultation and check if doctor already joined
  useEffect(() => {
    if (!consultationId) return
    consultationsService.getById(consultationId)
      .then(c => {
        setConsultation(c)
        if (c.status === 'in_progress') setDoctorReady(true)
      })
      .catch(() => {})
  }, [consultationId])

  // Realtime subscription — fires when professional joins and status → in_progress
  useEffect(() => {
    if (!consultationId) return

    const channel = supabase
      .channel(`waiting-${consultationId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'consultations',
          filter: `id=eq.${consultationId}`,
        },
        (payload) => {
          if (payload.new?.status === 'in_progress') {
            setDoctorReady(true)
          }
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [consultationId])

  const handleEnter = () => {
    if (!doctorReady || entering) return
    setEntering(true)
    navigate(`/paciente/videollamada/${consultationId}`)
  }

  const doctorName = consultation?.professional?.fullName ?? 'el profesional'

  return (
    <div className="absolute inset-0 bg-bg-primary flex flex-col items-center justify-center px-6 py-10">
      {/* Icon circle */}
      <div className={`w-24 h-24 rounded-full flex items-center justify-center mb-6 shadow-md transition-colors duration-500 ${doctorReady ? 'bg-brand-muted' : 'bg-brand-muted'}`}>
        {doctorReady
          ? <VideoCamera className="w-10 h-10 text-brand" />
          : <Clock className="w-10 h-10 text-brand" />
        }
      </div>

      {/* Status title */}
      <h1 className="text-[28px] text-text-primary text-center leading-tight mb-2">
        {doctorReady ? '¡El profesional está listo!' : 'Sala de espera'}
      </h1>

      {/* Status subtitle */}
      <p className="text-[15px] text-text-secondary text-center leading-relaxed mb-8 max-w-xs">
        {doctorReady
          ? `${doctorName} ya se encuentra en la sala.`
          : `Esperando que ${doctorName} se una${dots}`
        }
      </p>

      {/* Pulsing indicator while waiting */}
      {!doctorReady && (
        <div className="mb-8 flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-brand animate-[pulse_1.2s_ease-in-out_infinite]" />
          <div className="w-2.5 h-2.5 rounded-full bg-brand animate-[pulse_1.2s_ease-in-out_0.4s_infinite]" />
          <div className="w-2.5 h-2.5 rounded-full bg-brand animate-[pulse_1.2s_ease-in-out_0.8s_infinite]" />
        </div>
      )}

      {/* Enter CTA */}
      <button
        onClick={handleEnter}
        disabled={!doctorReady || entering}
        className={`flex items-center gap-2.5 px-8 py-4 rounded-full font-bold text-[16px] transition-all shadow-md mb-4 ${
          doctorReady
            ? 'bg-brand text-white hover:bg-brand-hover active:scale-95'
            : 'bg-gray-100 text-gray-400 cursor-not-allowed opacity-35'
        }`}
      >
        <VideoCamera className="w-5 h-5" />
        {entering ? 'Entrando...' : 'Entrar a la consulta'}
      </button>

      {/* Back link */}
      <button
        onClick={() => navigate('/paciente/consultas')}
        className="text-[14px] text-text-tertiary font-medium py-2 hover:text-text-secondary transition-colors"
      >
        Salir de la sala de espera
      </button>
    </div>
  )
}
