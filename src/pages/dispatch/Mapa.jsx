import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Map, Marker } from 'react-map-gl/mapbox'
import 'mapbox-gl/dist/mapbox-gl.css'
import { MapTrifold, WifiSlash, X } from '@phosphor-icons/react'
import { dispatchService, antiguedadUbicacion, haceCuanto, ESTADOS_AMBULANCIA, TIPOS_AMBULANCIA } from '../../services/dispatchService'
import MarcadorMovil from '../../components/dispatch/MarcadorMovil'
import { toast } from '../../components/Toast'

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN
const ZOOM = 12
const DEFAULT_CENTER = { lat: -34.5956, lng: -58.3843 }

const COLOR_POR_ESTADO = {
  disponible:        '#10B981', // verde
  en_servicio:       '#F59E0B', // ámbar
  fuera_de_servicio: '#9CA3AF', // gris
}

export default function DespachoMapa() {
  const [entidad, setEntidad] = useState(null)
  const [ambulancias, setAmbulancias] = useState([])
  const [loading, setLoading] = useState(true)
  const [seleccionada, setSeleccionada] = useState(null)
  const mapRef = useRef(null)
  // Tic para el "hace X" y para que una posición pase a vieja sin esperar un evento.
  const [ahora, setAhora] = useState(Date.now())
  useEffect(() => {
    const iv = setInterval(() => setAhora(Date.now()), 15_000)
    return () => clearInterval(iv)
  }, [])

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
    // Ahora publica cada teléfono de cada tripulante: se agrupan los avisos y
    // se relee la flota a lo sumo cada 3 s (igual que la app).
    let espera = null
    const unsub = dispatchService.suscribirUbicaciones(() => {
      if (espera) return
      espera = setTimeout(() => { espera = null; cargar(providerId) }, 3000)
    })
    return () => { if (espera) clearTimeout(espera); unsub() }
  }, [cargar])

  // Se dibuja la última posición conocida (hasta 12 h), con contorno si es
  // vieja (Mateo + Felipe, 2026-10-22); la lista de abajo queda para los que
  // nunca reportaron o hace más de 12 h.
  const conUbicacionFresca = useMemo(
    () => ambulancias.filter(a => antiguedadUbicacion(a.ubicacion, ahora) !== 'sin'),
    [ambulancias, ahora],
  )
  const sinUbicacionFresca = useMemo(
    () => ambulancias.filter(a => antiguedadUbicacion(a.ubicacion, ahora) === 'sin'),
    [ambulancias, ahora],
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
        <p className="text-xs text-text-secondary mt-1">Contorno = posición vieja (más de 2 min), con cuánto hace debajo.</p>
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
                anchor="top"
                offset={[0, -18]}
                onClick={e => { e.originalEvent.stopPropagation(); setSeleccionada(a) }}
              >
                <MarcadorMovil movil={a} ahora={ahora} />
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
                <p className={`text-xs tabular-nums ${antiguedadUbicacion(seleccionada.ubicacion, ahora) === 'vivo' ? 'text-emerald-700' : 'text-text-secondary'}`}>
                  Posición de {haceCuanto(seleccionada.ubicacion.updatedAt, ahora)}
                </p>
              )}
            </div>
          )}

          <div className="card space-y-2">
            <p className="font-semibold text-text-primary flex items-center gap-1.5 text-sm">
              <WifiSlash className="h-4 w-4 text-text-tertiary" /> Sin posición ({sinUbicacionFresca.length})
            </p>
            {sinUbicacionFresca.length === 0 ? (
              <p className="text-xs text-text-secondary">Toda la flota tiene una posición conocida</p>
            ) : (
              <div className="space-y-2">
                {sinUbicacionFresca.map(a => (
                  <button
                    key={a.id}
                    onClick={() => setSeleccionada(a)}
                    className="w-full flex items-center justify-between text-left p-2 rounded-lg hover:bg-bg-surface transition-colors"
                  >
                    <span className="text-sm text-text-primary">{a.label}</span>
                    <span className="text-xs text-text-tertiary">{a.ubicacion ? haceCuanto(a.ubicacion.updatedAt, ahora) : 'nunca reportó'}</span>
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
