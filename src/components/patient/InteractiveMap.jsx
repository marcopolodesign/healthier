import { useState, useEffect } from 'react'
import { Crosshair } from '@phosphor-icons/react';
import TopDownAmbulance from './TopDownAmbulance'

const VERTICALS = [
  { id: 'clinica',     color: '#b05a36' },
  { id: 'nutricion',   color: '#059669' },
  { id: 'mente',       color: '#7C3AED' },
  { id: 'fisico',      color: '#EA580C' },
  { id: 'veterinaria', color: '#0284C7' },
]


const AMBULANCE_STATIC = [
  { id: 'a2', x: -180, y:   90 },
  { id: 'a3', x:  -60, y: -200 },
  { id: 'a4', x:  150, y:  120 },
]

export default function InteractiveMap({ appState, sheetState, verticales, markers, onMarkerClick, userLocation, availableNow = false }) {
  const activeMarkers = markers ?? []
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [startPos, setStartPos] = useState({ x: 0, y: 0 })
  const [ambPos, setAmbPos] = useState({ x: 180, y: -220 })
  const [ambRotation, setAmbRotation] = useState(0)

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

  const onPtrDown = e => { setIsDragging(true); setStartPos({ x: e.clientX - pan.x, y: e.clientY - pan.y }); e.target.setPointerCapture(e.pointerId) }
  const onPtrMove = e => { if (isDragging) setPan({ x: e.clientX - startPos.x, y: e.clientY - startPos.y }) }
  const onPtrUp   = e => { setIsDragging(false); e.target.releasePointerCapture(e.pointerId) }

  return (
    <div
      className="absolute inset-0 overflow-hidden z-0 touch-none cursor-grab active:cursor-grabbing select-none bg-[#E5E3DF]"
      onPointerDown={onPtrDown} onPointerMove={onPtrMove} onPointerUp={onPtrUp} onPointerCancel={onPtrUp}
    >
      <div
        className="absolute top-1/2 left-1/2 w-[2500px] h-[2500px] pointer-events-none"
        style={{ transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y + baseY}px))`, transition: isDragging ? 'none' : 'transform 0.6s cubic-bezier(0.16,1,0.3,1)' }}
      >
        {/* Map tile */}
        {userLocation ? (
          <iframe
            title="Mapa" loading="lazy"
            src={`https://maps.google.com/maps?q=${userLocation.lat},${userLocation.lng}&t=m&z=15&output=embed&iwloc=near`}
            className="absolute inset-0 w-full h-full opacity-70 pointer-events-none"
            style={{ filter: 'saturate(1.1) contrast(1.05) grayscale(0.2)' }}
          />
        ) : (
          <div className="absolute inset-0 w-full h-full opacity-70 bg-gray-200" />
        )}

        {/* Emergency route line */}
        {appState === 'emergency_matched' && (
          <svg className="absolute inset-0 w-full h-full pointer-events-none z-10" style={{ overflow: 'visible' }}>
            <line
              x1={`calc(50% + ${ambPos.x}px)`} y1={`calc(50% + ${ambPos.y}px)`}
              x2="50%" y2="50%"
              stroke="#db0000" strokeWidth="5" strokeDasharray="10 10" strokeLinecap="round"
              className="animate-dash-move drop-shadow-[0_4px_6px_rgba(219,0,0,0.4)]"
            />
          </svg>
        )}

        {/* User dot */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 flex items-center justify-center">
          <div className="absolute w-20 h-20 bg-brand/20 rounded-full animate-[ping_3s_cubic-bezier(0,0,0.2,1)_infinite]" />
          <div className="w-6 h-6 bg-brand rounded-full shadow-[0_4px_15px_rgba(176,90,54,0.6)] border-[3.5px] border-white relative z-10" />
        </div>

        {/* Clinical markers */}
        {appState !== 'emergency_searching' && activeMarkers.map(m => {
          const v = verticales.find(v => v.id === m.type)
          if (!v) return null
          const dimmed = availableNow && !m.isOnDemand
          return (
            <div
              key={m.id}
              className={`absolute z-10 flex flex-col items-center transition-all duration-300 group ${dimmed ? 'opacity-30 pointer-events-none' : 'pointer-events-auto cursor-pointer hover:scale-110'}`}
              style={{ top: `calc(50% + ${m.y}px)`, left: `calc(50% + ${m.x}px)` }}
              onPointerDown={e => e.stopPropagation()}
              onClick={() => !dimmed && onMarkerClick(m.type)}
            >
              {/* Pulse ring — on-demand only */}
              {m.isOnDemand && (
                <div className="absolute w-14 h-14 rounded-full bg-emerald-400/30 animate-[ping_2s_cubic-bezier(0,0,0.2,1)_infinite] -z-10" />
              )}
              <div className="w-11 h-11 bg-white rounded-full flex items-center justify-center shadow-[0_8px_20px_rgba(0,0,0,0.15)] border-2 border-white relative">
                <v.icon className="w-[22px] h-[22px]" style={{ color: v.color }} />
                {/* On-demand: green badge · Scheduled: blue badge */}
                <div className={`absolute top-0 -right-0.5 w-3.5 h-3.5 border-2 border-white rounded-full shadow-sm ${m.isOnDemand ? 'bg-emerald-500' : 'bg-blue-500'}`} />
              </div>
              <div className="w-2 h-1.5 bg-black/20 rounded-[100%] mt-1 blur-[1px] group-hover:scale-75 transition-transform" />
            </div>
          )
        })}

        {/* Radar ambulances */}
        {appState === 'emergency_searching' && AMBULANCE_STATIC.map(a => (
          <div key={a.id} className="absolute z-10 flex flex-col items-center pointer-events-none" style={{ top: `calc(50% + ${a.y}px)`, left: `calc(50% + ${a.x}px)` }}>
            <TopDownAmbulance className="opacity-90" style={{ transform: `rotate(${Math.random() * 360}deg) scale(0.4)` }} />
          </div>
        ))}

        {/* Active ambulance moving */}
        {appState === 'emergency_matched' && (
          <div className="absolute z-30 flex flex-col items-center pointer-events-none" style={{ top: `calc(50% + ${ambPos.y}px)`, left: `calc(50% + ${ambPos.x}px)` }}>
            <TopDownAmbulance className="transition-transform duration-100" style={{ transform: `rotate(${ambRotation}deg) scale(0.55)` }} />
          </div>
        )}
      </div>

      {/* Recenter button */}
      {(appState === 'home' || appState === 'emergency_matched') && (
        <div className="absolute top-[120px] right-6 z-20">
          <button
            onClick={e => { e.stopPropagation(); setPan({ x: 0, y: 0 }) }}
            className="w-12 h-12 bg-white/90 backdrop-blur-md rounded-full flex items-center justify-center shadow-[0_8px_20px_rgba(0,0,0,0.15)] border border-gray-100 hover:bg-white transition-all active:scale-95"
          >
            <Crosshair className="w-6 h-6 text-brand" />
          </button>
        </div>
      )}
    </div>
  )
}
