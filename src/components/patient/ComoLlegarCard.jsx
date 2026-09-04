import { useNavigate } from 'react-router-dom'
import { MapPin, NavigationArrow, WarningCircle } from '@phosphor-icons/react'
import { staticMapUrl } from '../../lib/directions'

/**
 * "Cómo llegar" para un turno presencial: miniatura del consultorio en el mapa,
 * la dirección, y el botón que abre el camino en vivo (`/paciente/camino/:id`).
 *
 * Es una imagen estática a propósito — montar un Mapbox GL interactivo dentro
 * de una tarjeta que el paciente sólo mira de paso es caro y no aporta nada.
 * El mapa de verdad está a un tap.
 *
 * Cuando el profesional todavía no cargó su dirección, la tarjeta lo dice en
 * lugar de desaparecer: un turno presencial sin lugar es justamente lo que el
 * paciente necesita saber antes de salir de su casa.
 */
export default function ComoLlegarCard({ consultationId, address, latitude, longitude, className = '' }) {
  const navigate = useNavigate()

  const lat = latitude != null ? Number(latitude) : null
  const lng = longitude != null ? Number(longitude) : null
  const ubicado = lat != null && lng != null
  const thumb = ubicado ? staticMapUrl({ lat, lng }) : null

  if (!ubicado && !address) {
    return (
      <div className={`w-full bg-white rounded-[24px] border border-border-default shadow-sm p-5 flex items-start gap-3 ${className}`}>
        <WarningCircle className="w-5 h-5 text-text-tertiary flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-[14px] font-semibold text-text-primary">Falta la dirección del consultorio</p>
          <p className="text-[13px] text-text-secondary mt-0.5">
            Todavía no está cargada. Escribile al profesional antes de salir.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className={`w-full bg-white rounded-[24px] border border-border-default shadow-sm overflow-hidden ${className}`}>
      {thumb && (
        <img src={thumb} alt="Ubicación del consultorio" className="w-full h-[130px] object-cover" loading="lazy" />
      )}
      <div className="p-5 flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <MapPin className="w-5 h-5 text-brand flex-shrink-0 mt-0.5" weight="fill" />
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">Consultorio</p>
            <p className="text-[14px] font-semibold text-text-primary mt-0.5">
              {address ?? 'Dirección sin cargar'}
            </p>
          </div>
        </div>

        {ubicado ? (
          <button
            onClick={() => navigate(`/paciente/camino/${consultationId}`)}
            className="w-full flex items-center justify-center gap-2 px-6 py-3.5 rounded-full font-bold text-[15px] text-white bg-brand hover:bg-brand-hover transition-all shadow-sm active:scale-95"
          >
            <NavigationArrow className="w-5 h-5" weight="fill" />
            Cómo llegar
          </button>
        ) : (
          <a
            href={`https://maps.google.com/?q=${encodeURIComponent(address)}`}
            target="_blank" rel="noopener noreferrer"
            className="w-full flex items-center justify-center gap-2 px-6 py-3.5 rounded-full font-bold text-[15px] text-brand border-2 border-brand hover:bg-brand/5 transition-all active:scale-95"
          >
            <NavigationArrow className="w-5 h-5" />
            Buscar en Google Maps
          </a>
        )}
      </div>
    </div>
  )
}
