import { useNavigate } from 'react-router-dom'
import { ShoppingBag } from '@phosphor-icons/react'
import { nombreDePila, inicialesDe } from '../../lib/format'
import { track } from '../../utils/analytics'
import NotificationBell from './NotificationBell'
import { usePharmacyCart } from '../../context/PharmacyCartContext'
import { farmaciaVisible } from '../../lib/featureFlags'

/**
 * Header del Inicio del paciente — "Hola {nombre}" + avatar a la izquierda,
 * campanita de notificaciones y carrito de farmacia a la derecha. Vive SÓLO
 * en Inicio (spec 2026-09-23). Pensado para ir arriba del degradé del
 * carrusel on demand — texto y borde de avatar blancos (mismo tratamiento en
 * mobile y desktop, ver nota en Dashboard.jsx sobre por qué no hay una rama
 * de escritorio separada).
 *
 * El carrito reemplaza acá a la píldora flotante (que ahora sólo vive en
 * Consultas y Perfil, ver `RUTAS_CON_PILL` en `PharmacyCartSheet`) — mismo
 * gate que el resto de farmacia (`farmaciaVisible`), sin hueco de layout si
 * está apagada.
 */
export default function PatientHeader({ profile }) {
  const navigate = useNavigate()
  const firstName = nombreDePila(profile?.fullName, 'Paciente')
  const { count, openSheet } = usePharmacyCart()

  const goToPerfil = () => { track('header_avatar_click', { flow: 'paciente' }); navigate('/paciente/perfil') }
  const abrirCarrito = () => { track('header_cart_click', { flow: 'paciente', count }); openSheet() }

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
      <div className="flex items-center gap-2 shrink-0">
        {farmaciaVisible(profile) && (
          <button
            onClick={abrirCarrito}
            aria-label={count > 0 ? `Ver el carrito — ${count} producto${count !== 1 ? 's' : ''}` : 'Ver el carrito'}
            className="relative w-11 h-11 rounded-full flex items-center justify-center transition-colors shrink-0 bg-white/15 hover:bg-white/25"
          >
            <ShoppingBag className="w-5 h-5 text-white" weight={count > 0 ? 'fill' : 'regular'} />
            {count > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-brand-secondary text-white text-[10px] font-semibold flex items-center justify-center border-2 border-white">
                {count > 9 ? '9+' : count}
              </span>
            )}
          </button>
        )}
        <NotificationBell userId={profile?.id} tone="light" />
      </div>
    </div>
  )
}
