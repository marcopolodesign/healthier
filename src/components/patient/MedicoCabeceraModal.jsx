import { useNavigate } from 'react-router-dom'
import { Lightning, VideoCamera, MapPin, CalendarBlank, UserCircle } from '@phosphor-icons/react'
import PatientSheet from './PatientSheet'
import { useEspecialidades } from '../../hooks/useEspecialidades'
import { verticalForSpecialty } from '../../lib/verticals'
import { track } from '../../utils/analytics'

/**
 * Popup post-onboarding para el paciente que llegó por el link de un
 * profesional (2026-08-21, pedido de Mateo). Antes el onboarding lo mandaba
 * directo a la ficha pública del profesional; ahora cae en su propio
 * dashboard y esto es lo que ve al llegar — mismas acciones que la ficha
 * (llamar ahora / agendar), pero sin sacarlo de su casa.
 *
 * También se reusa cuando el paciente vuelve a abrir la tarjeta "Tu médico de
 * cabecera" desde el dashboard más adelante — mismo componente, no dos.
 */
export default function MedicoCabeceraModal({ open, onClose, professional }) {
  const navigate = useNavigate()
  const { porSlug, especialidades } = useEspecialidades()

  if (!professional) return null

  const name = professional.profiles?.fullName || professional.profiles?.full_name
  const avatar = professional.profiles?.avatarUrl || professional.profiles?.avatar_url
  const especialidadLabel = porSlug[professional.specialty] || professional.specialty
  const vertical = verticalForSpecialty(professional.specialty, especialidades)
  const puedeCobrar = professional.mpConnected !== false

  const irA = (destino) => {
    onClose?.()
    navigate(destino)
  }

  const handleLlamarAhora = () => {
    track('medico_cabecera_ondemand_click', { professional_id: professional.userId, flow: 'paciente' })
    irA(`/paciente/ondemand/${vertical}?pro=${professional.userId}`)
  }

  const handleAgendar = (modality) => {
    track('medico_cabecera_agendar_click', { professional_id: professional.userId, modality, flow: 'paciente' })
    irA(`/paciente/reservar?vertical=${vertical}&proId=${professional.userId}&modality=${modality}`)
  }

  return (
    <PatientSheet open={open} onClose={onClose} maxWidth="max-w-md">
      <div className="px-6 pt-2 pb-8">
        <div className="flex flex-col items-center text-center mb-6">
          {avatar ? (
            <img src={avatar} alt={name} className="w-24 h-24 rounded-full object-cover shadow-sm mb-4" />
          ) : (
            <div className="w-24 h-24 rounded-full bg-brand-muted flex items-center justify-center mb-4">
              <UserCircle className="h-12 w-12 text-brand" />
            </div>
          )}
          <p className="text-[11px] font-semibold text-brand uppercase tracking-widest mb-1">Tu médico de cabecera</p>
          <h2 className="text-[22px] font-light text-text-primary leading-tight">{name}</h2>
          <p className="text-text-secondary text-sm mt-0.5">{especialidadLabel}</p>
          {professional.isOnDemand && (
            <span className="inline-flex items-center gap-1 text-xs bg-accent-muted text-accent px-3 py-1 rounded-full mt-3">
              <Lightning className="h-3.5 w-3.5" weight="fill" /> Disponible ahora
            </span>
          )}
        </div>

        {!puedeCobrar ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-center">
            <p className="font-semibold text-text-primary text-sm">No disponible para reservas online por ahora</p>
          </div>
        ) : (
          <div className="space-y-3">
            {professional.isOnDemand && (
              <button
                onClick={handleLlamarAhora}
                className="w-full flex items-center gap-4 p-4 rounded-2xl bg-brand text-white shadow-sm hover:bg-brand-hover active:scale-[0.98] transition-all"
              >
                <div className="w-11 h-11 rounded-full bg-white/15 flex items-center justify-center shrink-0">
                  <VideoCamera className="h-5 w-5" />
                </div>
                <div className="flex-1 text-left">
                  <p className="font-semibold text-[15px]">Llamar ahora</p>
                  <p className="text-white/80 text-xs">Videollamada en el momento</p>
                </div>
              </button>
            )}
            <button
              onClick={() => handleAgendar('virtual')}
              className="w-full flex items-center gap-4 p-4 rounded-2xl bg-white border border-border-default hover:border-brand transition-all"
            >
              <div className="w-11 h-11 rounded-full bg-brand-muted flex items-center justify-center shrink-0">
                <VideoCamera className="h-5 w-5 text-brand" />
              </div>
              <div className="flex-1 text-left">
                <p className="font-semibold text-[15px] text-text-primary">Agendar videollamada</p>
                <p className="text-text-secondary text-xs">Elegí día y horario</p>
              </div>
            </button>
            <button
              onClick={() => handleAgendar('presencial')}
              className="w-full flex items-center gap-4 p-4 rounded-2xl bg-white border border-border-default hover:border-brand transition-all"
            >
              <div className="w-11 h-11 rounded-full bg-brand-muted flex items-center justify-center shrink-0">
                <MapPin className="h-5 w-5 text-brand" />
              </div>
              <div className="flex-1 text-left">
                <p className="font-semibold text-[15px] text-text-primary">Agendar presencial</p>
                <p className="text-text-secondary text-xs">En el consultorio</p>
              </div>
            </button>
          </div>
        )}

        <button
          onClick={onClose}
          className="w-full mt-5 text-center text-sm text-text-tertiary hover:text-text-secondary transition-colors flex items-center justify-center gap-1.5"
        >
          <CalendarBlank className="h-4 w-4" /> Ahora no, lo veo después
        </button>
      </div>
    </PatientSheet>
  )
}
