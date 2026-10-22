import { Ambulance } from '@phosphor-icons/react'
import { antiguedadUbicacion, haceCuanto } from '../../services/dispatchService'

// Color por estado del móvil — clases enteras para que Tailwind las vea.
const MACIZO = {
  disponible:        'bg-emerald-500',
  en_servicio:       'bg-amber-500',
  fuera_de_servicio: 'bg-gray-400',
}
const CONTORNO = {
  disponible:        'border-emerald-500 text-emerald-600',
  en_servicio:       'border-amber-500 text-amber-600',
  fuera_de_servicio: 'border-gray-400 text-gray-500',
}

/**
 * El móvil en el mapa (revisión de Felipe, 2026-10-22). En vivo (<2 min):
 * círculo macizo del color de su estado. Posición vieja: HUECO (fondo blanco,
 * borde e ícono del color del estado) con una pastilla "12 min" debajo — no
 * se atenúa con opacidad porque se confundía con el gris de "Fuera de servicio".
 */
export default function MarcadorMovil({ movil, ahora = Date.now() }) {
  const estado = movil.status in MACIZO ? movil.status : 'fuera_de_servicio'
  if (antiguedadUbicacion(movil.ubicacion, ahora) === 'vivo') {
    return (
      <div className={`w-9 h-9 rounded-full flex items-center justify-center border-[3px] border-white shadow-[0_6px_16px_rgba(0,0,0,0.25)] ${MACIZO[estado]}`}>
        <Ambulance className="w-[18px] h-[18px] text-white" weight="fill" />
      </div>
    )
  }
  return (
    <div className="flex flex-col items-center">
      <div className={`w-9 h-9 rounded-full flex items-center justify-center border-[2.5px] bg-white shadow-[0_6px_16px_rgba(0,0,0,0.18)] ${CONTORNO[estado]}`}>
        <Ambulance className="w-[18px] h-[18px]" weight="fill" />
      </div>
      <span className="mt-0.5 px-1.5 rounded-full bg-white border border-gray-200 text-[13px] font-semibold text-gray-900 tabular-nums leading-tight">
        {haceCuanto(movil.ubicacion?.updatedAt, ahora).replace(/^hace /, '')}
      </span>
    </div>
  )
}
