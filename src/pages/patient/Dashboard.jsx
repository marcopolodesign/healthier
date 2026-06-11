import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import PatientBottomNav from '../../components/patient/PatientBottomNav'
import PatientSheet from '../../components/patient/PatientSheet'
import {
  Stethoscope, AppleLogo, Brain, Barbell, MapPin,
  Clock, CaretRight, Star, VideoCamera,
  CircleNotch, Heartbeat, PawPrint, Pulse,
} from '@phosphor-icons/react'

const LAST_VERTICAL_KEY = 'healthier_last_vertical'
import InteractiveMap from '../../components/patient/InteractiveMap'
import { useBottomSheet } from '../../components/patient/useBottomSheet'
import { professionalService } from '../../services/professionalService'
import { toast } from '../../components/Toast'
import { SPECIALTY_LABELS, pickProForVertical } from '../../lib/verticals'
import { latLngToPixel, reverseGeocode } from '../../lib/geo'

function getGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Buenos días'
  if (h < 19) return 'Buenas tardes'
  return 'Buenas noches'
}

const VERTICALS = [
  { id: 'clinica',     nombre: 'Clínica',          icon: Stethoscope, color: '#b05a36', bg: '#fef9ef', shadow: 'rgba(176,90,54,0.15)',  eta: '3 min',  price: '$20' },
  { id: 'nutricion',   nombre: 'Nutrición',         icon: AppleLogo,   color: '#059669', bg: '#ECFDF5', shadow: 'rgba(5,150,105,0.15)',  eta: '10 min', price: '$15' },
  { id: 'mente',       nombre: 'Psicología',        icon: Brain,       color: '#7C3AED', bg: '#F5F3FF', shadow: 'rgba(124,58,237,0.15)', eta: '15 min', price: '$18' },
  { id: 'fisico',      nombre: 'Kinesiología',      icon: Barbell,     color: '#EA580C', bg: '#FFF7ED', shadow: 'rgba(234,88,12,0.15)',  eta: '5 min',  price: '$16' },
  { id: 'veterinaria', nombre: 'Veterinaria',       icon: PawPrint,    color: '#0284C7', bg: '#F0F9FF', shadow: 'rgba(2,132,199,0.15)',  eta: '8 min',  price: '$18' },
  { id: 'preparador',  nombre: 'Preparador Físico', icon: Pulse,       color: '#0F766E', bg: '#F0FDFA', shadow: 'rgba(15,118,110,0.15)', eta: '12 min', price: '$14' },
]

// Fallback pixel offsets used when a pro has no geo coordinates yet
const FALLBACK_SLOTS = [
  { x: -120, y: -180 },
  { x:  220, y:  -90 },
  { x: -200, y:   80 },
  { x:  150, y:  190 },
  { x:   50, y: -240 },
]

export default function PatientDashboard({ profile }) {
  const navigate = useNavigate()
  const sheet = useBottomSheet('half')

  const [isDesktop, setIsDesktop] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 640)
  const [appState, setAppState] = useState('home')
  const [userLocation, setUserLocation] = useState(null)
  const [addressName, setAddressName] = useState('Buscando ubicación...')
  const [isLocating, setIsLocating] = useState(true)
  const [mapProFlow, setMapProFlow] = useState(null)
  const [selectedMapPro, setSelectedMapPro] = useState(null)
  const [selectedMapModality, setSelectedMapModality] = useState(null)
  const [mapPaymentStatus, setMapPaymentStatus] = useState('idle')
  const [proPool, setProPool] = useState([])
  const [availableNow, setAvailableNow] = useState(false)
  const [lastUsed, setLastUsed] = useState(() => {
    try { return JSON.parse(localStorage.getItem(LAST_VERTICAL_KEY)) } catch { return null }
  })

  // One pro per vertical, keyed by vertical id
  const markersByVertical = useMemo(() => {
    const result = {}
    VERTICALS.forEach(v => {
      const pro = pickProForVertical(proPool, v.id)
      if (pro) result[v.id] = pro
    })
    return result
  }, [proPool])

  // Marker list for InteractiveMap — project real lat/lng onto overlay, fallback to fixed slots
  const mapMarkers = useMemo(() =>
    VERTICALS
      .map((v, i) => {
        const pro = markersByVertical[v.id]
        if (!pro) return null
        const pixelPos = (userLocation && pro.latitude != null && pro.longitude != null)
          ? latLngToPixel(userLocation, pro)
          : FALLBACK_SLOTS[i]
        return { id: i + 1, type: v.id, isOnDemand: pro.isOnDemand ?? false, ...pixelPos }
      })
      .filter(Boolean),
    [markersByVertical, userLocation]
  )

  // Respond to viewport resizes
  useEffect(() => {
    const handler = () => setIsDesktop(window.innerWidth >= 640)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  // Geolocation
  useEffect(() => {
    let watchId
    if ('geolocation' in navigator) {
      watchId = navigator.geolocation.watchPosition(
        async pos => {
          const { latitude: lat, longitude: lng } = pos.coords
          setUserLocation({ lat, lng })
          if (isLocating) {
            const name = await reverseGeocode(lat, lng).catch(() => null)
            setAddressName(name || 'Ubicación Actual')
            setIsLocating(false)
          }
        },
        () => {
          setUserLocation({ lat: -34.5956, lng: -58.3843 })
          setAddressName('Av. Santa Fe 1234')
          setIsLocating(false)
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
      )
    } else {
      setUserLocation({ lat: -34.5956, lng: -58.3843 })
      setAddressName('Ubicación no soportada')
      setIsLocating(false)
    }
    return () => { if (watchId !== undefined) navigator.geolocation.clearWatch(watchId) }
  }, [isLocating])

  // Load verified professionals for map markers
  useEffect(() => {
    professionalService.getDashboardPool()
      .then(data => setProPool(data))
      .catch(() => {}) // silent — map just shows no markers
  }, [])

  const handleMarkerClick = type => {
    const pro = markersByVertical[type]
    if (!pro) return
    const vert = VERTICALS.find(v => v.id === type)
    setSelectedMapPro({
      name:      pro.profiles?.fullName || 'Profesional',
      specialty: SPECIALTY_LABELS[pro.specialty] || pro.specialty,
      rating:    String(pro.averageRating ?? '—'),
      reviews:   pro.totalReviews ?? 0,
      img:       pro.profiles?.avatarUrl || null,
      color:     vert.color,
      bg:        vert.bg,
      icon:      vert.icon,
    })
    setMapProFlow('details')
    setMapPaymentStatus('idle')
  }

  const handleMapPayment = () => {
    setMapPaymentStatus('processing')
    setTimeout(() => {
      setMapPaymentStatus('success')
      setTimeout(() => {
        setMapProFlow(null)
        setSelectedMapPro(null)
        navigate('/paciente/consultas')
        toast.success('¡Reserva confirmada!')
      }, 1000)
    }, 1500)
  }

  const goToVertical = v => {
    const entry = { id: v.id, nombre: v.nombre }
    localStorage.setItem(LAST_VERTICAL_KEY, JSON.stringify(entry))
    setLastUsed(entry)
    navigate(`/paciente/ondemand/${v.id}`)
  }

  const firstName = profile?.fullName?.split(' ')[0] || 'Paciente'

  // ── Shared content blocks ────────────────────────────────

  const lastUsedPill = (() => {
    if (!lastUsed) return null
    const v = VERTICALS.find(x => x.id === lastUsed.id)
    if (!v) return null
    return (
      <button
        onClick={() => goToVertical(v)}
        className="w-full flex items-center gap-3 px-4 py-3 rounded-[20px] bg-white border border-gray-100 shadow-sm hover:shadow-md active:scale-[0.98] transition-all text-left"
        style={{ boxShadow: `0 4px 16px ${v.shadow}` }}
      >
        <div className="w-9 h-9 rounded-[12px] flex items-center justify-center flex-shrink-0" style={{ backgroundColor: v.bg }}>
          <v.icon className="w-[18px] h-[18px]" style={{ color: v.color }} />
        </div>
        <div className="flex flex-col flex-1 min-w-0">
          <span className="text-[10px] font-bold text-gray-400 tracking-widest uppercase leading-none mb-0.5">Último utilizado</span>
          <span className="font-black text-[15px] text-gray-900 leading-tight truncate">{v.nombre}</span>
        </div>
        <div className="flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[11px] font-bold flex-shrink-0" style={{ backgroundColor: v.bg, color: v.color }}>
          <Clock className="w-3 h-3" />
          <span>{v.eta}</span>
        </div>
      </button>
    )
  })()

  const specialtyGrid = (
    <div className="flex flex-col gap-3">
      <span className="text-[11px] font-semibold text-text-secondary tracking-wide uppercase">Buscar por especialidad</span>
      <div className="grid grid-cols-2 gap-3">
        {VERTICALS.map(v => (
          <div
            key={v.id}
            onClick={() => goToVertical(v)}
            className="p-4 rounded-[12px] cursor-pointer flex flex-col gap-1.5 transition-all hover:scale-[0.98] active:scale-95 border border-border-default bg-bg-secondary"
          >
            <div className="flex flex-row items-center gap-2 mb-1">
              <v.icon className="w-[18px] h-[18px] flex-shrink-0" style={{ color: v.color }} />
              <span
                className="text-[18px] leading-[22px] flex-1"
                style={{ color: v.color }}
              >{v.nombre}</span>
            </div>
            <span className="text-[11px] font-medium" style={{ color: '#b05a36' }}>{v.price}</span>
          </div>
        ))}
      </div>
    </div>
  )

  const sosButton = (
    <div
      onClick={() => navigate('/paciente/sos')}
      className="w-full py-5 px-5 rounded-[24px] flex items-center gap-4 cursor-pointer active:scale-95 transition-all"
      style={{ backgroundColor: '#db0000' }}
    >
      <Heartbeat className="w-7 h-7 text-white flex-shrink-0" />
      <div className="flex flex-col">
        <span className="font-bold text-[15px] text-white leading-none">EMERGENCIA S.O.S</span>
        <span className="text-[12px] text-white/80 mt-0.5">Solicitar ambulancia de inmediato</span>
      </div>
    </div>
  )

  const avatarEl = (
    <div className="w-11 h-11 rounded-full overflow-hidden border-2 flex-shrink-0" style={{ backgroundColor: '#b05a36', borderColor: '#f5eee1' }}>
      {profile?.avatarUrl
        ? <img src={profile.avatarUrl} alt="Perfil" className="w-full h-full object-cover" />
        : <div className="w-full h-full flex items-center justify-center text-white font-semibold text-[15px] tracking-wide">{firstName[0]}</div>
      }
    </div>
  )

  // ── Render ───────────────────────────────────────────────

  return (
    <div className="absolute inset-0">
      {/* Map */}
      <InteractiveMap
        sheetState={sheet.state}
        appState={appState}
        verticales={VERTICALS}
        markers={mapMarkers}
        onMarkerClick={handleMarkerClick}
        userLocation={userLocation}
        availableNow={availableNow}
      />

      {/* Location header */}
      <div className="absolute top-4 sm:top-6 w-full px-6 z-30 flex justify-start items-center pointer-events-none">
        <div className="flex flex-col bg-white/70 backdrop-blur-[20px] px-2 py-2 rounded-[20px] shadow-[0_8px_30px_rgba(0,0,0,0.06)] border border-white/50 pointer-events-auto cursor-pointer transition-all self-start max-w-[70%]">
          <div className="flex items-center gap-2 pr-2">
            <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center shadow-sm flex-shrink-0">
              {isLocating
                ? <CircleNotch className="h-4 w-4 text-brand animate-spin" />
                : <MapPin className="h-4 w-4 text-brand" />
              }
            </div>
            <div className="flex flex-col justify-center overflow-hidden">
              <span className="text-[9px] font-bold text-gray-500 tracking-wider uppercase mb-0.5 flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse flex-shrink-0" />
                UBICACIÓN ACTUAL
              </span>
              <span className="font-black text-gray-900 text-[14px] leading-none truncate">{addressName}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Filter chip — top right */}
      <div className="absolute top-4 sm:top-6 right-6 z-30">
        <button
          onClick={() => setAvailableNow(v => !v)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-bold shadow-[0_4px_16px_rgba(0,0,0,0.10)] border transition-all backdrop-blur-[12px] ${
            availableNow
              ? 'bg-emerald-500 border-emerald-400 text-white'
              : 'bg-white/80 border-white/60 text-gray-700 hover:bg-white'
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${availableNow ? 'bg-white animate-pulse' : 'bg-emerald-500'}`} />
          Disponibles ahora
        </button>
      </div>

      {/* ── Desktop: Google Maps-style floating panel (bottom-left) ── */}
      {isDesktop && (
        <div
          className="absolute left-4 z-40 w-[360px] bg-white/90 backdrop-blur-[20px] rounded-[28px] shadow-[0_8px_40px_rgba(0,0,0,0.12)] flex flex-col border border-white/80 overflow-hidden"
          style={{ bottom: '16px', maxHeight: 'calc(100dvh - 32px)' }}
        >
          {/* Panel header */}
          <div className="px-5 pt-5 pb-3 flex justify-between items-center flex-shrink-0 border-b border-gray-100/80">
            <div>
              <h2 className="text-[22px] font-black tracking-tight text-gray-900 leading-none">{getGreeting()}, {firstName}</h2>
              <p className="text-[13px] font-medium text-gray-500 mt-0.5">¿Cómo podemos ayudarte hoy?</p>
            </div>
            {avatarEl}
          </div>

          {/* Scrollable body — all sections always visible */}
          <div className="overflow-y-auto scrollbar-hide flex-1 px-5 pt-4 pb-4 flex flex-col gap-4">
            {lastUsedPill}
            {specialtyGrid}
            <div className="flex flex-col gap-3">{sosButton}</div>
          </div>

          {/* Nav — pinned to bottom of panel */}
          <div className="flex-shrink-0 border-t border-gray-100/80 px-6 py-3">
            <PatientBottomNav />
          </div>
        </div>
      )}

      {/* ── Mobile: drag-to-expand bottom sheet ── */}
      {!isDesktop && (
        <div
          className={`absolute left-0 w-full bg-bg-secondary rounded-t-[40px] shadow-[0_-15px_40px_rgba(0,0,0,0.08)] z-40 flex flex-col border-t border-border-default ${!sheet.dragging ? 'transition-transform duration-500 ease-[cubic-bezier(0.2,0.8,0.2,1)]' : ''}`}
          style={{ height: '85%', bottom: 0, transform: sheet.getTransform() }}
        >
          {/* Drag handle + greeting */}
          <div
            className="w-full flex flex-col items-center pt-4 pb-2 cursor-grab active:cursor-grabbing touch-none bg-bg-secondary rounded-t-[40px]"
            onPointerDown={sheet.onPointerDown}
            onPointerMove={sheet.onPointerMove}
            onPointerUp={sheet.onPointerUp}
            onPointerCancel={sheet.onPointerUp}
          >
            <div className="w-12 h-1.5 bg-gray-200 rounded-full mb-5 pointer-events-none" />
            <div className="w-full px-6 flex justify-between items-center pointer-events-none mb-2">
              <div>
                <h2 className="text-[28px] tracking-tight text-text-primary leading-none font-light">{getGreeting()}, {firstName}</h2>
                <p className="text-[14px] font-medium text-text-secondary mt-1">¿Cómo podemos ayudarte hoy?</p>
              </div>
              <div className="w-12 h-12 rounded-full overflow-hidden border-2 flex-shrink-0" style={{ backgroundColor: '#b05a36', borderColor: '#f5eee1' }}>
                {profile?.avatarUrl
                  ? <img src={profile.avatarUrl} alt="Perfil" className="w-full h-full object-cover" />
                  : <div className="w-full h-full flex items-center justify-center text-white font-semibold text-[17px] tracking-wide">{firstName[0]}</div>
                }
              </div>
            </div>
          </div>

          {/* Scrollable content */}
          <div className="px-6 flex-1 overflow-y-auto pb-32 scrollbar-hide bg-bg-secondary mt-2 flex flex-col gap-5">
            {lastUsedPill}
            {specialtyGrid}

            {/* SOS — revealed when expanded */}
            <div className={`transition-all duration-500 ease-in-out overflow-hidden flex flex-col gap-4 ${sheet.state === 'expanded' ? 'max-h-[200px] opacity-100 mb-8' : 'max-h-0 opacity-0 m-0'}`}>
              {sosButton}
            </div>
          </div>
        </div>
      )}

      {/* Map pro flow — responsive sheet/modal */}
      <PatientSheet
        open={!!mapProFlow && !!selectedMapPro}
        onClose={() => { setMapProFlow(null); setSelectedMapPro(null); setSelectedMapModality(null) }}
      >
        <div className="pb-10 overflow-y-auto scrollbar-hide flex-1">
          {mapProFlow === 'details' && (
            <div className="px-6 pt-4">
              <div className="flex justify-end mb-3">
                <button
                  onClick={() => { setMapProFlow(null); setSelectedMapPro(null); setSelectedMapModality(null) }}
                  className="w-10 h-10 bg-white border border-gray-200 shadow-sm rounded-full flex items-center justify-center hover:bg-gray-50"
                >✕</button>
              </div>
              <div className="bg-bg-primary rounded-[28px] p-5 border border-gray-100 flex items-center gap-5 mb-6">
                {selectedMapPro.img
                  ? <img src={selectedMapPro.img} alt={selectedMapPro.name} className="w-20 h-20 rounded-[20px] object-cover border-2 border-white shadow-sm flex-shrink-0" />
                  : <div className="w-20 h-20 rounded-[20px] border-2 border-white shadow-sm flex-shrink-0 flex items-center justify-center text-3xl font-black" style={{ backgroundColor: selectedMapPro.bg, color: selectedMapPro.color }}>{selectedMapPro.name[0]}</div>
                }
                <div>
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                    <span className="text-[10px] font-black text-emerald-600 tracking-widest uppercase">Disponible ahora</span>
                  </div>
                  <h4 className="font-black text-[20px] text-gray-900 leading-tight">{selectedMapPro.name}</h4>
                  <p className="text-[14px] text-gray-500 font-medium mt-0.5">{selectedMapPro.specialty}</p>
                  <div className="flex items-center gap-1 mt-1.5">
                    <Star className="w-3.5 h-3.5 fill-yellow-400 text-yellow-400" />
                    <span className="font-bold text-[13px] text-gray-800">{selectedMapPro.rating}</span>
                    <span className="text-[12px] text-gray-400">({selectedMapPro.reviews})</span>
                  </div>
                </div>
              </div>
              <h3 className="font-black text-[18px] text-gray-900 mb-4">¿Cómo preferís atenderte?</h3>
              <div className="space-y-3">
                {[
                  { label: 'Virtual (En Vivo)', sub: 'Conectá por videollamada al instante.', mod: 'Videollamada', icon: VideoCamera, color: 'text-brand', bg: 'bg-blue-50' },
                  { label: 'Presencial', sub: 'Acudí al consultorio (a 1.2 km de vos).', mod: 'Presencial', icon: MapPin, color: 'text-emerald-600', bg: 'bg-emerald-50' },
                ].map(opt => (
                  <div
                    key={opt.mod}
                    onClick={() => { setSelectedMapModality(opt.mod); setMapProFlow('payment') }}
                    className="bg-white p-5 rounded-[24px] shadow-sm border border-gray-100 flex items-center gap-4 cursor-pointer hover:border-brand transition-all group"
                  >
                    <div className={`w-14 h-14 ${opt.bg} rounded-[16px] flex items-center justify-center group-hover:scale-110 transition-transform`}>
                      <opt.icon className={`w-6 h-6 ${opt.color}`} />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-black text-[17px] text-gray-900">{opt.label}</h3>
                      <p className="text-[13px] text-gray-500 font-medium mt-0.5">{opt.sub}</p>
                    </div>
                    <CaretRight className="w-5 h-5 text-gray-300 group-hover:text-brand transition-colors" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {mapProFlow === 'payment' && (
            <div className="px-6 pt-4 animate-fade-in">
              <div className="flex items-center gap-3 mb-6">
                <button onClick={() => setMapProFlow('details')} className="w-10 h-10 bg-white border border-gray-100 rounded-full flex items-center justify-center shadow-sm hover:bg-gray-50" disabled={mapPaymentStatus !== 'idle'}>
                  ←
                </button>
                <h2 className="text-[24px] font-black text-gray-900 leading-none tracking-tight">Confirmar Reserva</h2>
              </div>
              <div className="bg-bg-primary rounded-[24px] p-5 border border-gray-100 mb-6">
                <div className="flex items-center gap-4 mb-4 pb-4 border-b border-gray-200">
                  {selectedMapPro.img
                    ? <img src={selectedMapPro.img} alt={selectedMapPro.name} className="w-12 h-12 rounded-full object-cover border border-white shadow-sm" />
                    : <div className="w-12 h-12 rounded-full border border-white shadow-sm flex items-center justify-center font-black text-lg" style={{ backgroundColor: selectedMapPro.bg, color: selectedMapPro.color }}>{selectedMapPro.name[0]}</div>
                  }
                  <div>
                    <h4 className="font-bold text-[16px] text-gray-900 leading-tight">{selectedMapPro.name}</h4>
                    <p className="text-[13px] text-gray-500 font-medium">{selectedMapModality} • Hoy, ahora</p>
                  </div>
                </div>
                <div className="flex justify-between items-center pt-1">
                  <span className="font-bold text-gray-500">Total</span>
                  <span className="font-black text-[24px] text-gray-900">$20.00</span>
                </div>
              </div>
              <button
                onClick={handleMapPayment}
                disabled={mapPaymentStatus !== 'idle'}
                className={`w-full py-5 rounded-[20px] font-bold text-[17px] shadow-md transition-all flex justify-center items-center gap-3
                  ${mapPaymentStatus === 'success' ? 'bg-emerald-500 text-white scale-[1.02]' :
                    mapPaymentStatus === 'processing' ? 'bg-gray-200 text-gray-400 cursor-not-allowed' :
                    'bg-brand text-white hover:bg-brand-hover active:scale-95'}`}
              >
                {mapPaymentStatus === 'processing' ? <><CircleNotch className="w-5 h-5 animate-spin" /> Procesando...</>
                 : mapPaymentStatus === 'success' ? <>✓ ¡Reserva Exitosa!</>
                 : <>Pagar $20.00 y Conectar</>}
              </button>
            </div>
          )}
        </div>
      </PatientSheet>
    </div>
  )
}
