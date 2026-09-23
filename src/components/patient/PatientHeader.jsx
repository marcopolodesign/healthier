import { useNavigate } from 'react-router-dom'
import { nombreDePila, inicialesDe } from '../../lib/format'
import { track } from '../../utils/analytics'
import NotificationBell from './NotificationBell'

/**
 * Header del Inicio del paciente — "Hola {nombre}" + avatar a la izquierda,
 * campanita de notificaciones a la derecha. Vive SÓLO en Inicio (spec
 * 2026-09-23). Pensado para ir arriba del degradé del carrusel on demand —
 * texto y borde de avatar blancos (mismo tratamiento en mobile y desktop, ver
 * nota en Dashboard.jsx sobre por qué no hay una rama de escritorio separada).
 */
export default function PatientHeader({ profile }) {
  const navigate = useNavigate()
  const firstName = nombreDePila(profile?.fullName, 'Paciente')

  const goToPerfil = () => { track('header_avatar_click', { flow: 'paciente' }); navigate('/paciente/perfil') }

  return (
    <div className="flex items-center justify-between gap-3">
      <button onClick={goToPerfil} className="flex items-center gap-2.5 min-w-0 text-left">
        <span className="w-10 h-10 rounded-full overflow-hidden border-2 border-white/50 flex-shrink-0 bg-white/15 flex items-center justify-center">
          {profile?.avatarUrl
            ? <img src={profile.avatarUrl} alt="" className="w-full h-full object-cover" />
            : <span className="text-white font-semibold text-[14px] tracking-wide">{inicialesDe(profile?.fullName)}</span>}
        </span>
        <span className="font-light text-[20px] text-white leading-none truncate">Hola, {firstName}</span>
      </button>
      <NotificationBell userId={profile?.id} tone="light" />
    </div>
  )
}
