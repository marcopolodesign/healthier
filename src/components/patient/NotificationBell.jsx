import { useNavigate } from 'react-router-dom'
import { Bell } from '@phosphor-icons/react'
import { useNotificacionesBadge } from '../../hooks/useNotificacionesBadge'
import { track } from '../../utils/analytics'

/**
 * Campanita de notificaciones — header del Inicio (mobile y desktop).
 * `tone="light"` para fondo oscuro/degradé (ícono blanco), `tone="dark"` para
 * fondo claro (ícono oscuro, con chapa esmerilada — usado en el header
 * flotante de escritorio, ver `PatientHeader`).
 */
export default function NotificationBell({ userId, tone = 'light', className = '' }) {
  const navigate = useNavigate()
  const count = useNotificacionesBadge(userId)

  const iconColor = tone === 'light' ? 'text-white' : 'text-text-primary'
  const bg = tone === 'light'
    ? 'bg-white/15 hover:bg-white/25'
    : 'bg-white/90 backdrop-blur-[20px] border border-white/80 shadow-[0_4px_16px_rgba(0,0,0,0.08)] hover:bg-white'

  return (
    <button
      data-tour="pac-avisos"
      onClick={() => { track('notificaciones_bell_click', { unread: count, flow: 'paciente' }); navigate('/paciente/notificaciones') }}
      aria-label={count > 0 ? `Notificaciones — ${count} sin leer` : 'Notificaciones'}
      className={`relative w-11 h-11 rounded-full flex items-center justify-center transition-colors shrink-0 ${bg} ${className}`}
    >
      <Bell className={`w-5 h-5 ${iconColor}`} weight={count > 0 ? 'fill' : 'regular'} />
      {count > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-danger text-white text-[10px] font-semibold flex items-center justify-center border-2 border-white">
          {count > 9 ? '9+' : count}
        </span>
      )}
    </button>
  )
}
