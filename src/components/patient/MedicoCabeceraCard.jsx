import { useState } from 'react'
import { UserCircle, X } from '@phosphor-icons/react'
import { profilesService } from '../../services/profilesService'
import { useEspecialidades } from '../../hooks/useEspecialidades'
import { track } from '../../utils/analytics'

/**
 * Tarjeta persistente "Tu médico de cabecera" — vive entre el bloque verde del
 * header y la grilla de especialidades del dashboard (Mateo, 2026-08-21).
 *
 * La X sólo la oculta para este paciente (`profiles.medico_cabecera_dismissed`,
 * migración 118) — la atribución real (`referred_by_professional_id`) no se
 * toca, sigue contando para las métricas del profesional/super admin.
 *
 * El ocultamiento en sí lo decide el padre (`onDismissed`, optimista, antes de
 * que termine el guardado): así el padre puede dejar de renderizar la tarjeta
 * entera en vez de dejar un contenedor vacío en el layout.
 */
export default function MedicoCabeceraCard({ profile, professional, onOpen, onDismissed }) {
  const { porSlug } = useEspecialidades()
  const [dismissing, setDismissing] = useState(false)

  if (!professional) return null

  const name = professional.profiles?.fullName || professional.profiles?.full_name
  const avatar = professional.profiles?.avatarUrl || professional.profiles?.avatar_url
  const especialidadLabel = porSlug[professional.specialty] || professional.specialty

  const handleDismiss = async (e) => {
    e.stopPropagation()
    if (dismissing) return
    setDismissing(true)
    // Optimista: el padre la oculta al toque, no espera el round-trip.
    track('medico_cabecera_card_dismiss', { professional_id: professional.userId, flow: 'paciente' })
    onDismissed?.()
    try {
      await profilesService.update(profile.id, { medico_cabecera_dismissed: true })
    } catch {
      // Si falla, se vuelve a mostrar en el próximo refresh — no hay nada más
      // que hacer acá sin bloquear al paciente con un toast por una tarjeta.
    } finally {
      setDismissing(false)
    }
  }

  return (
    <button
      onClick={onOpen}
      className="w-full rounded-[28px] bg-white border border-brand/30 shadow-[0_8px_24px_rgba(124,179,139,0.18)] p-5 flex items-center gap-4 text-left active:scale-[0.98] hover:border-brand transition-all"
    >
      {avatar ? (
        <img src={avatar} alt={name} className="w-11 h-11 rounded-full object-cover flex-shrink-0" />
      ) : (
        <div className="w-11 h-11 rounded-full bg-brand-muted flex items-center justify-center flex-shrink-0">
          <UserCircle className="w-5 h-5 text-brand" />
        </div>
      )}

      <div className="flex-1 min-w-0">
        <span className="text-[10px] font-semibold tracking-widest uppercase text-brand block">
          Tu médico de cabecera
        </span>
        <p className="text-[15px] font-semibold text-text-primary leading-tight mt-1 truncate">{name}</p>
        <p className="text-[12px] text-text-secondary mt-0.5 truncate">{especialidadLabel}</p>
      </div>

      <span
        role="button"
        aria-label="Ocultar tarjeta"
        onClick={handleDismiss}
        className="w-8 h-8 rounded-full flex items-center justify-center text-text-tertiary hover:bg-bg-primary hover:text-text-secondary transition-colors flex-shrink-0"
      >
        <X className="w-4 h-4" />
      </span>
    </button>
  )
}
