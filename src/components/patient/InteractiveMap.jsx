import { useState, useEffect, useRef, useMemo } from 'react'
import { Map, Marker, Source, Layer } from 'react-map-gl/mapbox'
import 'mapbox-gl/dist/mapbox-gl.css'
import { Crosshair, Ambulance } from '@phosphor-icons/react';
import MapFilters from './MapFilters'
import { pixelToLatLng } from '../../lib/geo'

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN

const ZOOM = 15
// Fallback reference point when the user's real location isn't known yet —
// same Buenos Aires default used by Dashboard.jsx's geolocation failure path.
const DEFAULT_CENTER = { lat: -34.5956, lng: -58.3843 }

function UserMarker() {
  return (
    <div className="relative flex items-center justify-center w-20 h-20 pointer-events-none">
      <div className="absolute w-20 h-20 bg-brand/20 rounded-full animate-[ping_3s_cubic-bezier(0,0,0.2,1)_infinite]" />
      <div className="w-6 h-6 bg-brand rounded-full shadow-[0_4px_15px_rgba(176,90,54,0.6)] border-[3.5px] border-white relative z-10" />
    </div>
  )
}

/**
 * El profesional que viene a una emergencia. Se dibuja SÓLO cuando hay una
 * posición real y fresca publicada en `emergency_tracking` — el que decide eso
 * es quien pasa la prop, no este componente.
 */
function EmergencyProMarker({ color = '#F43F5E' }) {
  return (
    <div className="relative flex items-center justify-center">
      <div className="absolute w-14 h-14 rounded-full animate-[ping_2s_cubic-bezier(0,0,0.2,1)_infinite]" style={{ backgroundColor: `${color}33` }} />
      <div
        className="w-11 h-11 rounded-full flex items-center justify-center border-[3px] border-white shadow-[0_8px_20px_rgba(0,0,0,0.25)] relative"
        style={{ backgroundColor: color }}
      >
        <Ambulance className="w-[22px] h-[22px] text-white" />
      </div>
    </div>
  )
}

function ProMarker({ vertical, marker, dimmed }) {
  const Icon = vertical.icon
  return (
    <div className={`relative flex flex-col items-center transition-all duration-300 ${dimmed ? 'opacity-30' : ''}`}>
      {marker.isOnDemand && !dimmed && (
        <div className="absolute -top-1.5 w-14 h-14 rounded-full bg-emerald-400/30 animate-[ping_2s_cubic-bezier(0,0,0.2,1)_infinite] -z-10" />
      )}
      <div className="w-11 h-11 bg-white rounded-full flex items-center justify-center shadow-[0_8px_20px_rgba(0,0,0,0.15)] border-2 border-white relative">
        <Icon className="w-[22px] h-[22px]" style={{ color: vertical.color }} />
        <div className={`absolute top-0 -right-0.5 w-3.5 h-3.5 border-2 border-white rounded-full shadow-sm ${marker.isOnDemand ? 'bg-emerald-500' : 'bg-blue-500'}`} />
      </div>
      <div className="w-2 h-1.5 bg-black/20 rounded-[100%] mt-1 blur-[1px]" />
    </div>
  )
}

export default function InteractiveMap({
  appState, sheetState, verticales, markers, onMarkerClick, userLocation, availableNow = false,
  // Emergencia en curso: posición en vivo del profesional y la ruta que la API
  // devolvió para llegar. Las dos son opcionales — sin ellas el mapa es el de
  // siempre, y nunca se dibuja una recta inventada en lugar de la ruta.
  emergencyPro = null, emergencyRoute = null, emergencyColor = '#F43F5E',
}) {
  const activeMarkers = markers ?? []
  const [selectedVertical, setSelectedVertical] = useState(null)
  const [localAvailableNow, setLocalAvailableNow] = useState(false)
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const centeredOnce = useRef(false)

  const effectiveAvailableNow = availableNow || localAvailableNow
  const referencePoint = userLocation || DEFAULT_CENTER

  // Prevent Safari from hijacking single-finger map pans as tab-switch gestures.
  // Multi-touch (pinch-to-zoom) is allowed through.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const prevent = e => { if (e.touches.length === 1) e.preventDefault() }
    el.addEventListener('touchmove', prevent, { passive: false })
    return () => el.removeEventListener('touchmove', prevent)
  }, [])

  // Center on the user's real location the first time it resolves, without
  // fighting subsequent manual panning.
  useEffect(() => {
    if (userLocation && !centeredOnce.current && mapRef.current) {
      mapRef.current.flyTo({ center: [userLocation.lng, userLocation.lat], zoom: ZOOM, duration: 800 })
      centeredOnce.current = true
    }
  }, [userLocation])

  const baseY = appState === 'emergency_matched' ? -220 : sheetState === 'half' ? -150 : -50

  /*
   * Con el profesional en pantalla el encuadre útil son LOS DOS puntos, no el
   * paciente solo.
   *
   * El ajuste fino no es capricho: el contenedor del mapa está desplazado
   * `baseY` px hacia arriba y encima el panel de seguimiento le tapa un pedazo,
   * así que el centro del mapa NO es el centro de lo que el usuario ve. Con un
   * `fitBounds` a secas los dos marcadores quedaban arriba del borde visible —
   * o sea, el encuadre "correcto" mostraba una emergencia sin nadie adentro.
   *
   * Se corrige con padding asimétrico y NO con `offset`: `offset` mueve el
   * centro DESPUÉS de calcular el zoom, así que lo único que hace es empujar la
   * mitad de abajo fuera de la pantalla. El padding entra en el cálculo, que es
   * lo que hace falta.
   */
  useEffect(() => {
    if (!emergencyPro || !userLocation || !mapRef.current) return
    const cont = mapRef.current.getContainer?.()
    const ancho = cont?.clientWidth ?? 0
    const alto = cont?.clientHeight ?? 0
    if (!ancho || !alto) return

    const esAncho = ancho >= 640
    const desplazado = Math.abs(baseY)
    // Rectángulo del mapa que el usuario ve de verdad, en coordenadas del mapa:
    // arriba lo corta el desplazamiento; abajo (en teléfono) la hoja del panel;
    // a la izquierda (en escritorio) la columna del panel.
    const visibleAbajo = esAncho ? alto : desplazado + Math.max(160, (alto - desplazado) * 0.42)
    const visibleIzq = esAncho ? 410 : 0

    const M = 60
    let top = desplazado + M
    let bottom = alto - visibleAbajo + M
    const left = visibleIzq + M
    const right = M

    // Si la franja visible es muy angosta, se afloja el padding vertical en vez
    // de pedirle a Mapbox algo imposible (padding mayor que el alto).
    const minLibre = 120
    if (alto - top - bottom < minLibre) {
      const exceso = minLibre - (alto - top - bottom)
      const total = top + bottom
      top -= Math.round(exceso * (top / total))
      bottom -= Math.round(exceso * (bottom / total))
    }

    mapRef.current.fitBounds(
      [
        [Math.min(emergencyPro.lng, userLocation.lng), Math.min(emergencyPro.lat, userLocation.lat)],
        [Math.max(emergencyPro.lng, userLocation.lng), Math.max(emergencyPro.lat, userLocation.lat)],
      ],
      { padding: { top, bottom, left, right }, duration: 800, maxZoom: 16 },
    )
  }, [emergencyPro?.lat, emergencyPro?.lng, userLocation?.lat, userLocation?.lng, baseY])

  // Only offer vertical filters for specialties that actually have a marker on screen right now
  const filterableVerticales = useMemo(() => {
    const presentTypes = new Set(activeMarkers.map(m => m.type))
    return (verticales ?? []).filter(v => presentTypes.has(v.id))
  }, [verticales, activeMarkers])

  const visibleMarkers = useMemo(
    () => activeMarkers.filter(m => !selectedVertical || m.type === selectedVertical),
    [activeMarkers, selectedVertical]
  )

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 overflow-hidden z-0 select-none bg-[#E5E3DF]"
    >
      <div
        className="absolute inset-0"
        style={{ transform: `translateY(${baseY}px)`, transition: 'transform 0.6s cubic-bezier(0.16,1,0.3,1)' }}
      >
        {/* Real interactive map — Mapbox GL, light style to match the brand */}
        <Map
          ref={mapRef}
          mapboxAccessToken={MAPBOX_TOKEN}
          initialViewState={{ longitude: referencePoint.lng, latitude: referencePoint.lat, zoom: ZOOM }}
          mapStyle="mapbox://styles/mapbox/light-v11"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
          attributionControl={{ compact: true }}
        >
          {/* Ruta real del profesional hacia el paciente */}
          {emergencyRoute?.length > 1 && (
            <Source
              id="emergency-route"
              type="geojson"
              data={{ type: 'Feature', geometry: { type: 'LineString', coordinates: emergencyRoute } }}
            >
              <Layer
                id="emergency-route-line"
                type="line"
                layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                paint={{ 'line-color': emergencyColor, 'line-width': 4 }}
              />
            </Source>
          )}

          {/* Profesional en camino */}
          {emergencyPro && (
            <Marker longitude={emergencyPro.lng} latitude={emergencyPro.lat} anchor="center">
              <EmergencyProMarker color={emergencyColor} />
            </Marker>
          )}

          {/* User dot */}
          {userLocation && (
            <Marker longitude={userLocation.lng} latitude={userLocation.lat} anchor="center">
              <UserMarker />
            </Marker>
          )}

          {/* Clinical markers — real professional coordinates */}
          {visibleMarkers.map(m => {
            const v = verticales.find(v => v.id === m.type)
            if (!v) return null
            const dimmed = effectiveAvailableNow && !m.isOnDemand
            const { lat, lng } = pixelToLatLng(referencePoint, m, ZOOM)
            return (
              <Marker
                key={m.id}
                longitude={lng}
                latitude={lat}
                anchor="bottom"
                onClick={dimmed ? undefined : e => { e.originalEvent.stopPropagation(); onMarkerClick(m.type) }}
              >
                <ProMarker vertical={v} marker={m} dimmed={dimmed} />
              </Marker>
            )
          })}
        </Map>
      </div>

      {/* Filters — Disponibles ahora + especialidad */}
      <MapFilters
        verticales={filterableVerticales}
        activeVertical={selectedVertical}
        onVerticalChange={setSelectedVertical}
        availableNow={effectiveAvailableNow}
        onToggleAvailableNow={() => setLocalAvailableNow(v => !v)}
      />

      {/* Recenter button */}
      {(appState === 'home' || appState === 'emergency_matched') && (
        <div className="absolute top-[120px] right-6 z-20">
          <button
            onClick={e => { e.stopPropagation(); if (userLocation) mapRef.current?.flyTo({ center: [userLocation.lng, userLocation.lat], zoom: ZOOM, duration: 500 }) }}
            className="w-12 h-12 bg-white/90 backdrop-blur-md rounded-full flex items-center justify-center shadow-[0_8px_20px_rgba(0,0,0,0.15)] border border-gray-100 hover:bg-white transition-all active:scale-95"
          >
            <Crosshair className="w-6 h-6 text-brand" />
          </button>
        </div>
      )}
    </div>
  )
}
