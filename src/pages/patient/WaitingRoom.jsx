import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Clock, VideoCamera, SealCheck } from '@phosphor-icons/react'
import { supabase } from '../../lib/supabase'
import { consultationsService, WAITING_HEARTBEAT_MS } from '../../services/consultationsService'

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
  const [doctorReady, setDoctorReady] = useState(false)
  const [entering, setEntering] = useState(false)
  const [dots, setDots] = useState('')

  const countdown = useCountdown(consultation?.scheduledAt)

  // Animate waiting dots
  useEffect(() => {
    const iv = setInterval(() => setDots(d => (d.length >= 3 ? '' : d + '.')), 500)
    return () => clearInterval(iv)
  }, [])

  // Load consultation
  useEffect(() => {
    if (!consultationId) return
    consultationsService.getById(consultationId)
      .then(c => {
        setConsultation(c)
        if (c.status === 'in_progress') setDoctorReady(true)
      })
      .catch(() => {})
  }, [consultationId])

  // Announce presence to the professional + keep it fresh while the room is open.
  // Without this the professional has no way of knowing anyone showed up.
  useEffect(() => {
    if (!consultationId) return
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
    }
  }, [consultationId])

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
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [consultationId])

  const handleEnter = useCallback(() => {
    if (!doctorReady || entering) return
    setEntering(true)
    navigate(`/paciente/videollamada/${consultationId}`)
  }, [doctorReady, entering, navigate, consultationId])

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
      <div className={`w-20 h-20 rounded-full flex items-center justify-center mb-4 shadow-sm transition-colors duration-500 ${doctorReady ? 'bg-brand text-white' : 'bg-brand-muted'}`}>
        {doctorReady
          ? <VideoCamera className="w-9 h-9 text-white" />
          : <Clock className="w-9 h-9 text-brand" />}
      </div>

      {/* Status title */}
      <h1 className="text-[24px] font-bold text-text-primary text-center leading-tight mb-2">
        {doctorReady ? '¡El profesional está listo!' : 'Sala de espera'}
      </h1>

      {/* Countdown or waiting message */}
      <p className="text-[14px] text-text-secondary text-center leading-relaxed mb-6 max-w-xs">
        {doctorReady
          ? `${doctorName} ya está en la sala. Podés entrar ahora.`
          : countdown
            ? `La consulta comienza en ${countdown}`
            : `Esperando que ${doctorName} se una${dots}`}
      </p>

      {/* Animated dots */}
      {!doctorReady && (
        <div className="mb-6 flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-brand animate-[pulse_1.2s_ease-in-out_infinite]" />
          <div className="w-2 h-2 rounded-full bg-brand animate-[pulse_1.2s_ease-in-out_0.4s_infinite]" />
          <div className="w-2 h-2 rounded-full bg-brand animate-[pulse_1.2s_ease-in-out_0.8s_infinite]" />
        </div>
      )}

      {/* Enter CTA */}
      <button
        onClick={handleEnter}
        disabled={!doctorReady || entering}
        className={`flex items-center gap-2.5 px-8 py-4 rounded-full font-bold text-[16px] transition-all shadow-md mb-4 ${
          doctorReady
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
