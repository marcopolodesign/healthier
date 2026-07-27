import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import PatientSheet from '../../components/patient/PatientSheet'
import {
  MapPin, MapTrifold, CaretRight, Star, VideoCamera,
  Heartbeat, ClipboardText, X, Sparkle,
} from '@phosphor-icons/react'

const LAST_VERTICAL_KEY = 'healthier_last_vertical'
import InteractiveMap from '../../components/patient/InteractiveMap'
import { professionalService } from '../../services/professionalService'
import { VERTICALS, SPECIALTY_LABELS, pickProForVertical } from '../../lib/verticals'
import { latLngToPixel } from '../../lib/geo'

function getGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Buenos días'
  if (h < 19) return 'Buenas tardes'
  return 'Buenas noches'
}

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

  const [userLocation, setUserLocation] = useState(null)
  const [showMap, setShowMap] = useState(false)
  const [mapProFlow, setMapProFlow] = useState(null)
  const [selectedMapPro, setSelectedMapPro] = useState(null)
  const [proPool, setProPool] = useState([])

  // One pro per vertical, keyed by vertical id
  const markersByVertical = useMemo(() => {
    const result = {}
    VERTICALS.forEach(v => {
      if (v.comingSoon) return   // no map pin for coming-soon verticals
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

  // Only specialties bookable right now (no "próximamente") get the on-demand hero treatment
  const onDemandVerticals = useMemo(() => VERTICALS.filter(v => !v.comingSoon), [])

  // Geolocation
  useEffect(() => {
    let watchId
    if ('geolocation' in navigator) {
      watchId = navigator.geolocation.watchPosition(
        pos => {
          const { latitude: lat, longitude: lng } = pos.coords
          setUserLocation(prev => {
            if (prev && Math.abs(prev.lat - lat) < 0.0001 && Math.abs(prev.lng - lng) < 0.0001) return prev
            return { lat, lng }
          })
        },
        () => setUserLocation({ lat: -34.5956, lng: -58.3843 }),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
      )
    } else {
      setUserLocation({ lat: -34.5956, lng: -58.3843 })
    }
    return () => { if (watchId !== undefined) navigator.geolocation.clearWatch(watchId) }
  }, [])

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
      name:       pro.profiles?.fullName || 'Profesional',
      specialty:  SPECIALTY_LABELS[pro.specialty] || pro.specialty,
      rating:     String(pro.averageRating ?? '—'),
      reviews:    pro.totalReviews ?? 0,
      img:        pro.profiles?.avatarUrl || null,
      color:      vert.color,
      bg:         vert.bg,
      icon:       vert.icon,
      userId:     pro.userId,
      verticalId: type,
    })
    setMapProFlow('details')
  }

  const handleMapModalitySelect = modality => {
    if (!selectedMapPro) return
    setMapProFlow(null)
    setSelectedMapPro(null)
    navigate(`/paciente/reservar?vertical=${selectedMapPro.verticalId}&proId=${selectedMapPro.userId}&modality=${modality}`)
  }

  const goToVertical = v => {
    const entry = { id: v.id, nombre: v.nombre }
    localStorage.setItem(LAST_VERTICAL_KEY, JSON.stringify(entry))
    navigate(`/paciente/reservar?vertical=${v.id}`)
  }

  const firstName = profile?.fullName?.split(' ')[0] || 'Paciente'

  // ── Shared content blocks ────────────────────────────────

  const onDemandHero = (
    <div className="rounded-[28px] bg-gradient-to-br from-brand to-brand-hover p-6 flex flex-col gap-4 text-white shadow-[0_12px_32px_rgba(124,179,139,0.35)]">
      <div>
        <span className="text-[11px] font-semibold tracking-widest uppercase text-white/70">Consulta on demand</span>
        <h2 className="text-[22px] font-light leading-tight mt-1">Hablá con un médico ahora</h2>
        <p className="text-[13px] text-white/80 mt-1">Sin turno previo · Videollamada en minutos</p>
      </div>
      <div className="flex gap-2">
        {onDemandVerticals.map(v => (
          <button
            key={v.id}
            onClick={() => navigate(`/paciente/ondemand/${v.id}`)}
            className="flex-1 flex items-center justify-center gap-2 py-3.5 px-4 rounded-2xl bg-white/15 hover:bg-white/25 active:scale-95 transition-all font-semibold text-[14px]"
          >
            <v.icon className="w-[18px] h-[18px]" />
            {v.nombre}
          </button>
        ))}
      </div>
    </div>
  )

  const specialtyGrid = (
    <div className="flex flex-col gap-3">
      <span className="text-[11px] font-semibold text-text-secondary tracking-wide uppercase">Buscar por especialidad</span>
      <div className="grid grid-cols-2 gap-3">
        {VERTICALS.map(v => (
          <div
            key={v.id}
            onClick={v.comingSoon ? undefined : () => goToVertical(v)}
            className={`card flex flex-col gap-1.5 transition-all ${
              v.comingSoon
                ? 'opacity-60 cursor-default'
                : 'card-hover cursor-pointer hover:scale-[0.98] active:scale-95'
            }`}
          >
            <div className="flex flex-row items-center gap-2 mb-1">
              <v.icon className="w-[18px] h-[18px] flex-shrink-0" style={{ color: v.color }} />
              <span
                className="text-[18px] leading-[22px] flex-1"
                style={{ color: v.color }}
              >{v.nombre}</span>
            </div>
            {v.comingSoon && (
              <span className="text-[10px] font-semibold tracking-wide uppercase px-2 py-0.5 rounded-full self-start" style={{ backgroundColor: v.bg, color: v.color }}>
                Próximamente
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )

  const mapCta = (
    <button
      onClick={() => setShowMap(true)}
      className="card-hover w-full flex items-center gap-4 active:scale-[0.98] transition-all text-left"
    >
      <div className="w-10 h-10 rounded-full bg-brand-muted flex items-center justify-center flex-shrink-0">
        <MapTrifold className="w-5 h-5 text-brand" />
      </div>
      <div className="flex-1 min-w-0">
        <span className="font-semibold text-[14px] text-text-primary leading-none">Ver mapa</span>
        <p className="text-[11px] text-text-secondary mt-0.5 truncate">Profesionales disponibles cerca tuyo</p>
      </div>
      <CaretRight className="w-4 h-4 text-text-tertiary flex-shrink-0" />
    </button>
  )

  const aiTriageCta = (
    <div className="card w-full flex items-center gap-4 opacity-60 pointer-events-none text-left relative">
      <div className="w-10 h-10 rounded-full bg-brand-muted flex items-center justify-center flex-shrink-0">
        <Sparkle className="w-5 h-5 text-brand" />
      </div>
      <div className="flex-1 min-w-0">
        <span className="font-semibold text-[14px] text-text-primary leading-none">¿No sabés qué especialista necesitás?</span>
        <p className="text-[11px] text-text-secondary mt-0.5 truncate">Contanos tus síntomas y te orientamos</p>
      </div>
      <span className="text-[10px] font-semibold tracking-wide uppercase px-2 py-0.5 rounded-full bg-brand-muted text-brand flex-shrink-0">
        Próximamente
      </span>
    </div>
  )

  const sosButton = (
    <div
      className="w-full py-5 px-5 rounded-2xl bg-danger flex items-center gap-4 opacity-40 pointer-events-none relative"
    >
      <Heartbeat className="w-7 h-7 text-white flex-shrink-0" />
      <div className="flex flex-col">
        <span className="font-semibold text-[15px] text-white leading-none">EMERGENCIA S.O.S</span>
        <span className="text-[12px] text-white/80 mt-0.5">Solicitar ambulancia de inmediato</span>
      </div>
      <span className="absolute top-2 right-3 text-[9px] font-semibold tracking-wide uppercase px-1.5 py-0.5 rounded-full bg-white/90 text-danger">Próximamente</span>
    </div>
  )

  // Deliberately separated from sosButton — this is NOT an emergency flow.
  // Different icon, calmer palette (brand-tertiary lavender, not coral/danger),
  // plus clarifying copy so patients don't mistake this for S.O.S.
  const urgentCareSection = (
    <div className="flex flex-col gap-2">
      <div
        onClick={() => navigate('/paciente/fastpass')}
        className="card-hover w-full flex items-center gap-4 cursor-pointer active:scale-95 transition-all"
      >
        <div className="w-10 h-10 rounded-full bg-brand-tertiary/10 flex items-center justify-center flex-shrink-0">
          <ClipboardText className="w-5 h-5 text-brand-tertiary" />
        </div>
        <div className="flex flex-col">
          <span className="font-semibold text-[14px] text-text-primary leading-none">Fastpass</span>
          <span className="text-[11px] text-text-secondary mt-0.5">Ver a un médico sin turno previo, salteando la fila</span>
        </div>
      </div>
      <p className="text-[11px] text-text-tertiary px-1 leading-snug">
        No es una emergencia médica — para eso usá el botón de S.O.S.
      </p>
    </div>
  )

  const avatarEl = (
    <div className="w-11 h-11 rounded-full overflow-hidden border-2 flex-shrink-0 bg-[#b05a36] border-[#f5eee1]">
      {profile?.avatarUrl
        ? <img src={profile.avatarUrl} alt="Perfil" className="w-full h-full object-cover" />
        : <div className="w-full h-full flex items-center justify-center text-white font-semibold text-[15px] tracking-wide">{firstName[0]}</div>
      }
    </div>
  )

  // ── Render ───────────────────────────────────────────────

  return (
    <div className="absolute inset-0">
      <div className="absolute inset-0 overflow-y-auto scrollbar-hide bg-bg-primary">
        <div className="px-6 pt-6 sm:pt-8 pb-4 flex justify-between items-center">
          <div>
            <h1 className="text-[28px] tracking-tight text-text-primary leading-none font-light">{getGreeting()}, {firstName}</h1>
            <p className="text-[14px] font-medium text-text-secondary mt-1">¿Cómo podemos ayudarte hoy?</p>
          </div>
          {avatarEl}
        </div>

        <div className="px-6 pb-32 flex flex-col gap-5 w-full">
          {onDemandHero}
          {specialtyGrid}
          {mapCta}
          {aiTriageCta}
          {urgentCareSection}
          {sosButton}
        </div>
      </div>

      {/* Full-screen map — secondary view, opened from mapCta. InteractiveMap owns its
          own "Disponibles ahora" + especialidad filters internally (MapFilters). */}
      {showMap && (
        <div className="fixed inset-0 z-[60]">
          <InteractiveMap
            appState="home"
            sheetState="collapsed"
            verticales={VERTICALS}
            markers={mapMarkers}
            onMarkerClick={handleMarkerClick}
            userLocation={userLocation}
          />

          {/* Close button — top right, matching the slot MapFilters already reserves (right-[76px] on its own row) */}
          <div className="absolute top-4 sm:top-6 right-6 z-30">
            <button
              onClick={() => setShowMap(false)}
              className="w-10 h-10 flex items-center justify-center rounded-full bg-white/80 border border-white/60 shadow-[0_4px_16px_rgba(0,0,0,0.10)] backdrop-blur-[12px] hover:bg-white transition-all"
            >
              <X className="w-5 h-5 text-gray-700" />
            </button>
          </div>
        </div>
      )}

      {/* Map pro flow — responsive sheet/modal */}
      <PatientSheet
        open={!!mapProFlow && !!selectedMapPro}
        onClose={() => { setMapProFlow(null); setSelectedMapPro(null) }}
      >
        <div className="pb-10 overflow-y-auto scrollbar-hide flex-1">
          {mapProFlow === 'details' && (
            <div className="px-6 pt-4">
              <div className="flex justify-end mb-3">
                <button
                  onClick={() => { setMapProFlow(null); setSelectedMapPro(null) }}
                  className="w-10 h-10 bg-white border border-gray-200 shadow-sm rounded-full flex items-center justify-center hover:bg-gray-50"
                >✕</button>
              </div>
              <div className="bg-bg-primary rounded-[28px] p-5 border border-gray-100 flex items-center gap-5 mb-6">
                {selectedMapPro.img
                  ? <img src={selectedMapPro.img} alt={selectedMapPro.name} className="w-20 h-20 rounded-2xl object-cover border-2 border-white shadow-sm flex-shrink-0" />
                  : <div className="w-20 h-20 rounded-2xl border-2 border-white shadow-sm flex-shrink-0 flex items-center justify-center text-3xl font-semibold" style={{ backgroundColor: selectedMapPro.bg, color: selectedMapPro.color }}>{selectedMapPro.name[0]}</div>
                }
                <div>
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                    <span className="text-[10px] font-semibold text-emerald-600 tracking-widest uppercase">Disponible ahora</span>
                  </div>
                  <h4 className="font-semibold text-[20px] text-gray-900 leading-tight">{selectedMapPro.name}</h4>
                  <p className="text-[14px] text-gray-500 font-medium mt-0.5">{selectedMapPro.specialty}</p>
                  <div className="flex items-center gap-1 mt-1.5">
                    <Star className="w-3.5 h-3.5 fill-yellow-400 text-yellow-400" />
                    <span className="font-semibold text-[13px] text-gray-800">{selectedMapPro.rating}</span>
                    <span className="text-[12px] text-gray-400">({selectedMapPro.reviews})</span>
                  </div>
                </div>
              </div>
              <h3 className="font-semibold text-[18px] text-gray-900 mb-4">¿Cómo preferís atenderte?</h3>
              <div className="space-y-3">
                {[
                  { label: 'Virtual (En Vivo)', sub: 'Conectá por videollamada al instante.', mod: 'Videollamada', icon: VideoCamera, color: 'text-brand', bg: 'bg-blue-50' },
                  { label: 'Presencial', sub: 'Acudí al consultorio (a 1.2 km de vos).', mod: 'Presencial', icon: MapPin, color: 'text-emerald-600', bg: 'bg-emerald-50' },
                ].map(opt => (
                  <div
                    key={opt.mod}
                    onClick={() => handleMapModalitySelect(opt.mod === 'Videollamada' ? 'virtual' : 'presencial')}
                    className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex items-center gap-4 cursor-pointer hover:border-brand transition-all group"
                  >
                    <div className={`w-14 h-14 ${opt.bg} rounded-[16px] flex items-center justify-center group-hover:scale-110 transition-transform`}>
                      <opt.icon className={`w-6 h-6 ${opt.color}`} />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-[17px] text-gray-900">{opt.label}</h3>
                      <p className="text-[13px] text-gray-500 font-medium mt-0.5">{opt.sub}</p>
                    </div>
                    <CaretRight className="w-5 h-5 text-gray-300 group-hover:text-brand transition-colors" />
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      </PatientSheet>
    </div>
  )
}
