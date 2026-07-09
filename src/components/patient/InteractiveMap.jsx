import { useState, useEffect, useRef, useMemo } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Crosshair } from '@phosphor-icons/react';
import TopDownAmbulance from './TopDownAmbulance'
import MapFilters from './MapFilters'
import { pixelToLatLng } from '../../lib/geo'

const AMBULANCE_STATIC = [
  { id: 'a2', x: -180, y:   90 },
  { id: 'a3', x:  -60, y: -200 },
  { id: 'a4', x:  150, y:  120 },
]

const ZOOM = 15
// Fallback reference point when the user's real location isn't known yet —
// same Buenos Aires default used by Dashboard.jsx's geolocation failure path.
const DEFAULT_CENTER = { lat: -34.5956, lng: -58.3843 }

function buildUserMarkerIcon() {
  const html = renderToStaticMarkup(
    <div className="relative flex items-center justify-center w-20 h-20">
      <div className="absolute w-20 h-20 bg-brand/20 rounded-full animate-[ping_3s_cubic-bezier(0,0,0.2,1)_infinite]" />
      <div className="w-6 h-6 bg-brand rounded-full shadow-[0_4px_15px_rgba(176,90,54,0.6)] border-[3.5px] border-white relative z-10" />
    </div>
  )
  return L.divIcon({ html, className: 'bg-transparent border-0', iconSize: [80, 80], iconAnchor: [40, 40] })
}

function buildProMarkerIcon(v, m, dimmed) {
  const Icon = v.icon
  const html = renderToStaticMarkup(
    <div className={`relative flex flex-col items-center transition-all duration-300 ${dimmed ? 'opacity-30' : ''}`}>
      {m.isOnDemand && !dimmed && (
        <div className="absolute -top-1.5 w-14 h-14 rounded-full bg-emerald-400/30 animate-[ping_2s_cubic-bezier(0,0,0.2,1)_infinite] -z-10" />
      )}
      <div className="w-11 h-11 bg-white rounded-full flex items-center justify-center shadow-[0_8px_20px_rgba(0,0,0,0.15)] border-2 border-white relative">
        <Icon className="w-[22px] h-[22px]" style={{ color: v.color }} />
        <div className={`absolute top-0 -right-0.5 w-3.5 h-3.5 border-2 border-white rounded-full shadow-sm ${m.isOnDemand ? 'bg-emerald-500' : 'bg-blue-500'}`} />
      </div>
      <div className="w-2 h-1.5 bg-black/20 rounded-[100%] mt-1 blur-[1px]" />
    </div>
  )
  return L.divIcon({ html, className: 'bg-transparent border-0', iconSize: [56, 68], iconAnchor: [28, 56] })
}

// Wires up the underlying Leaflet map instance to the parent (for the
// recenter button) and centers on the user's real location the first time
// it resolves, without fighting subsequent manual panning.
function MapController({ userLocation, onReady }) {
  const map = useMap()
  const centeredOnce = useRef(false)

  useEffect(() => { onReady(map) }, [map, onReady])

  useEffect(() => {
    if (userLocation && !centeredOnce.current) {
      map.setView([userLocation.lat, userLocation.lng], ZOOM)
      centeredOnce.current = true
    }
  }, [userLocation, map])

  return null
}

export default function InteractiveMap({ appState, sheetState, verticales, markers, onMarkerClick, userLocation, availableNow = false }) {
  const activeMarkers = markers ?? []
  const [ambPos, setAmbPos] = useState({ x: 180, y: -220 })
  const [ambRotation, setAmbRotation] = useState(0)
  const [selectedVertical, setSelectedVertical] = useState(null)
  const [localAvailableNow, setLocalAvailableNow] = useState(false)
  const containerRef = useRef(null)
  const mapRef = useRef(null)

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

  useEffect(() => {
    let raf
    if (appState === 'emergency_matched') {
      const target = { x: 0, y: 0 }
      const update = () => {
        setAmbPos(prev => {
          const dx = target.x - prev.x
          const dy = target.y - prev.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < 5) return target
          const angle = Math.atan2(dy, dx)
          setAmbRotation(angle * (180 / Math.PI) + 90)
          return { x: prev.x + (dx / dist) * 0.4, y: prev.y + (dy / dist) * 0.4 }
        })
        raf = requestAnimationFrame(update)
      }
      raf = requestAnimationFrame(update)
    } else {
      setAmbPos({ x: 180, y: -220 })
    }
    return () => cancelAnimationFrame(raf)
  }, [appState])

  const baseY = appState === 'emergency_matched' ? -220 : appState === 'emergency_searching' ? -50 : sheetState === 'half' ? -150 : -50

  // Only offer vertical filters for specialties that actually have a marker on screen right now
  const filterableVerticales = useMemo(() => {
    const presentTypes = new Set(activeMarkers.map(m => m.type))
    return (verticales ?? []).filter(v => presentTypes.has(v.id))
  }, [verticales, activeMarkers])

  const visibleMarkers = useMemo(
    () => activeMarkers.filter(m => !selectedVertical || m.type === selectedVertical),
    [activeMarkers, selectedVertical]
  )

  const userIcon = useMemo(() => buildUserMarkerIcon(), [])

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 overflow-hidden z-0 select-none bg-[#E5E3DF]"
    >
      <div
        className="absolute inset-0"
        style={{ transform: `translateY(${baseY}px)`, transition: 'transform 0.6s cubic-bezier(0.16,1,0.3,1)' }}
      >
        {/* Real interactive map — OpenStreetMap tiles via Leaflet, no API key required */}
        <MapContainer
          center={[referencePoint.lat, referencePoint.lng]}
          zoom={ZOOM}
          zoomControl={false}
          attributionControl={false}
          className="absolute inset-0 w-full h-full"
        >
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
            attribution="&copy; OpenStreetMap contributors &copy; CARTO"
            subdomains="abcd"
            maxZoom={20}
          />
          <MapController userLocation={userLocation} onReady={m => { mapRef.current = m }} />

          {/* User dot */}
          {userLocation && (
            <Marker position={[userLocation.lat, userLocation.lng]} icon={userIcon} interactive={false} />
          )}

          {/* Clinical markers — real professional coordinates */}
          {appState !== 'emergency_searching' && visibleMarkers.map(m => {
            const v = verticales.find(v => v.id === m.type)
            if (!v) return null
            const dimmed = effectiveAvailableNow && !m.isOnDemand
            const { lat, lng } = pixelToLatLng(referencePoint, m, ZOOM)
            return (
              <Marker
                key={m.id}
                position={[lat, lng]}
                icon={buildProMarkerIcon(v, m, dimmed)}
                interactive={!dimmed}
                eventHandlers={dimmed ? undefined : { click: () => onMarkerClick(m.type) }}
              />
            )
          })}
        </MapContainer>

        {/* Emergency route line */}
        {appState === 'emergency_matched' && (
          <svg className="absolute inset-0 w-full h-full pointer-events-none z-[500]" style={{ overflow: 'visible' }}>
            <line
              x1={`calc(50% + ${ambPos.x}px)`} y1={`calc(50% + ${ambPos.y}px)`}
              x2="50%" y2="50%"
              stroke="#db0000" strokeWidth="5" strokeDasharray="10 10" strokeLinecap="round"
              className="animate-dash-move drop-shadow-[0_4px_6px_rgba(219,0,0,0.4)]"
            />
          </svg>
        )}

        {/* Radar ambulances */}
        {appState === 'emergency_searching' && AMBULANCE_STATIC.map(a => (
          <div key={a.id} className="absolute z-[500] flex flex-col items-center pointer-events-none" style={{ top: `calc(50% + ${a.y}px)`, left: `calc(50% + ${a.x}px)` }}>
            <TopDownAmbulance className="opacity-90" style={{ transform: `rotate(${Math.random() * 360}deg) scale(0.4)` }} />
          </div>
        ))}

        {/* Active ambulance moving */}
        {appState === 'emergency_matched' && (
          <div className="absolute z-[500] flex flex-col items-center pointer-events-none" style={{ top: `calc(50% + ${ambPos.y}px)`, left: `calc(50% + ${ambPos.x}px)` }}>
            <TopDownAmbulance className="transition-transform duration-100" style={{ transform: `rotate(${ambRotation}deg) scale(0.55)` }} />
          </div>
        )}
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
            onClick={e => { e.stopPropagation(); if (userLocation) mapRef.current?.setView([userLocation.lat, userLocation.lng], ZOOM) }}
            className="w-12 h-12 bg-white/90 backdrop-blur-md rounded-full flex items-center justify-center shadow-[0_8px_20px_rgba(0,0,0,0.15)] border border-gray-100 hover:bg-white transition-all active:scale-95"
          >
            <Crosshair className="w-6 h-6 text-brand" />
          </button>
        </div>
      )}
    </div>
  )
}
