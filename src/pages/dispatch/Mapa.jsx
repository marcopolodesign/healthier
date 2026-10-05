import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Map, Marker } from 'react-map-gl/mapbox'
import 'mapbox-gl/dist/mapbox-gl.css'
import { Ambulance, MapTrifold, WifiSlash, X } from '@phosphor-icons/react'
import { dispatchService, ubicacionEsReciente, ESTADOS_AMBULANCIA, TIPOS_AMBULANCIA } from '../../services/dispatchService'
import { toast } from '../../components/Toast'

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN
const ZOOM = 12
const DEFAULT_CENTER = { lat: -34.5956, lng: -58.3843 }

const COLOR_POR_ESTADO = {
  disponible:        '#10B981', // verde
  en_servicio:       '#F59E0B', // ámbar
  fuera_de_servicio: '#9CA3AF', // gris
}

function haceCuanto(iso) {
  if (!iso) return 'sin datos'
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (min < 1) return 'hace instantes'
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  return `hace ${h} h`
}

function MarcadorAmbulancia({ color }) {
  return (
    <div
      className="w-9 h-9 rounded-full flex items-center justify-center border-[3px] border-white shadow-[0_6px_16px_rgba(0,0,0,0.25)]"
      style={{ backgroundColor: color }}
    >
      <Ambulance className="w-[18px] h-[18px] text-white" />
    </div>
  )
}

export default function DespachoMapa() {
  const [entidad, setEntidad] = useState(null)
  const [ambulancias, setAmbulancias] = useState([])
  const [loading, setLoading] = useState(true)
  const [seleccionada, setSeleccionada] = useState(null)
  const mapRef = useRef(null)

  const cargar = useCallback(async (providerId) => {
    try {
      const data = await dispatchService.listarAmbulancias(providerId)
      setAmbulancias(data)
    } catch {
      toast.error('Error al cargar la flota')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let providerId
    dispatchService.miEntidad().then(e => {
      providerId = e?.id
      setEntidad(e)
      return cargar(providerId)
    })
    const unsub = dispatchService.suscribirUbicaciones(() => cargar(providerId))
    return unsub
  }, [cargar])

  const conUbicacionFresca = useMemo(
    () => ambulancias.filter(a => a.ubicacion && ubicacionEsReciente(a.ubicacion)),
    [ambulancias],
  )
  const sinUbicacionFresca = useMemo(
    () => ambulancias.filter(a => !a.ubicacion || !ubicacionEsReciente(a.ubicacion)),
    [ambulancias],
  )

  const centro = conUbicacionFresca[0]?.ubicacion
    ? { lat: conUbicacionFresca[0].ubicacion.latitude, lng: conUbicacionFresca[0].ubicacion.longitude }
    : DEFAULT_CENTER

  if (loading) {
    return <div className="h-[70vh] bg-bg-surface rounded-lg animate-pulse" />
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
          <MapTrifold className="h-6 w-6 text-brand" /> Flota en vivo
        </h1>
        <p className="text-text-secondary mt-1">{entidad?.name}</p>
      </div>

      <div className="flex flex-col lg:flex-row gap-4">
        <div className="relative flex-1 h-[60vh] lg:h-[70vh] rounded-2xl overflow-hidden border border-border-default">
          <Map
            ref={mapRef}
            mapboxAccessToken={MAPBOX_TOKEN}
            initialViewState={{ longitude: centro.lng, latitude: centro.lat, zoom: ZOOM }}
            mapStyle="mapbox://styles/mapbox/light-v11"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
            attributionControl={{ compact: true }}
          >
            {conUbicacionFresca.map(a => (
              <Marker
                key={a.id}
                longitude={a.ubicacion.longitude}
                latitude={a.ubicacion.latitude}
                anchor="center"
                onClick={e => { e.originalEvent.stopPropagation(); setSeleccionada(a) }}
              >
                <MarcadorAmbulancia color={COLOR_POR_ESTADO[a.status] || COLOR_POR_ESTADO.fuera_de_servicio} />
              </Marker>
            ))}
          </Map>
        </div>

        {/* Panel lateral */}
        <div className="w-full lg:w-80 space-y-4 shrink-0">
          {seleccionada && (
            <div className="card space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold text-text-primary">{seleccionada.label}</p>
                  <p className="text-xs text-text-secondary">
                    {seleccionada.plate ? `${seleccionada.plate} · ` : ''}
                    {TIPOS_AMBULANCIA.find(t => t.id === seleccionada.unitType)?.label || seleccionada.unitType}
                  </p>
                </div>
                <button onClick={() => setSeleccionada(null)} className="text-text-tertiary hover:text-text-primary">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-full inline-block"
                style={{ backgroundColor: `${COLOR_POR_ESTADO[seleccionada.status]}22`, color: COLOR_POR_ESTADO[seleccionada.status] }}>
                {ESTADOS_AMBULANCIA.find(e => e.id === seleccionada.status)?.label || seleccionada.status}
              </span>
              <div className="space-y-1.5">
                {(seleccionada.tripulacion || []).length === 0 ? (
                  <p className="text-xs text-text-secondary">Sin tripulación asignada</p>
                ) : seleccionada.tripulacion.map(t => (
                  <div key={t.id} className="flex items-center justify-between text-sm">
                    <span className="text-text-primary">{t.profile?.fullName}</span>
                    <span className="text-text-secondary text-xs">{t.crewRole}</span>
                  </div>
                ))}
              </div>
              {seleccionada.ubicacion && (
                <p className="text-xs text-text-tertiary">Actualizado {haceCuanto(seleccionada.ubicacion.updatedAt)}</p>
              )}
            </div>
          )}

          <div className="card space-y-2">
            <p className="font-semibold text-text-primary flex items-center gap-1.5 text-sm">
              <WifiSlash className="h-4 w-4 text-text-tertiary" /> Sin posición reciente ({sinUbicacionFresca.length})
            </p>
            {sinUbicacionFresca.length === 0 ? (
              <p className="text-xs text-text-secondary">Toda la flota reporta posición en vivo</p>
            ) : (
              <div className="space-y-2">
                {sinUbicacionFresca.map(a => (
                  <button
                    key={a.id}
                    onClick={() => setSeleccionada(a)}
                    className="w-full flex items-center justify-between text-left p-2 rounded-lg hover:bg-bg-surface transition-colors"
                  >
                    <span className="text-sm text-text-primary">{a.label}</span>
                    <span className="text-xs text-text-tertiary">{haceCuanto(a.ubicacion?.updatedAt)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
