import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import PatientSheet from '../../components/patient/PatientSheet'
import {
  MapPin, Clock, CaretRight, Star, VideoCamera,
  Heartbeat, Plus, Siren, Pulse,
} from '@phosphor-icons/react'

const LAST_VERTICAL_KEY = 'healthier_last_vertical'
import InteractiveMap from '../../components/patient/InteractiveMap'
import { useBottomSheet } from '../../components/patient/useBottomSheet'
import { professionalService } from '../../services/professionalService'
import { consultationsService } from '../../services/consultationsService'
import { toast } from '../../components/Toast'
import { VERTICALS, SPECIALTY_LABELS, pickProForVertical } from '../../lib/verticals'
import { latLngToPixel, reverseGeocode } from '../../lib/geo'

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
  const sheet = useBottomSheet('half')

  const [isDesktop, setIsDesktop] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 640)
  const [appState, setAppState] = useState('home')
  const [userLocation, setUserLocation] = useState(null)
  const [addressName, setAddressName] = useState('Buscando ubicación...')
  const [isLocating, setIsLocating] = useState(true)
  const [mapProFlow, setMapProFlow] = useState(null)
  const [selectedMapPro, setSelectedMapPro] = useState(null)
  const [proPool, setProPool] = useState([])
  const [availableNow, setAvailableNow] = useState(false)
  const [lastUsed, setLastUsed] = useState(() => {
    try { return JSON.parse(localStorage.getItem(LAST_VERTICAL_KEY)) } catch { return null }
  })

  // Upcoming consultations — shown prominently in the dashboard sheet
  const [upcomingConsultations, setUpcomingConsultations] = useState([])
  const [upcomingLoading, setUpcomingLoading] = useState(false)

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

  // Load upcoming consultations for the dashboard card (top 3, soonest first)
  useEffect(() => {
    if (!profile?.id) return
    setUpcomingLoading(true)
    consultationsService.getByPatient(profile.id)
      .then(data => {
        const active = data.filter(c => ['pending', 'confirmed', 'in_progress'].includes(c.status))
        active.sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt))
        setUpcomingConsultations(active.slice(0, 3))
      })
      .catch(() => {})
      .finally(() => setUpcomingLoading(false))
  }, [profile?.id])

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
    setLastUsed(entry)
    navigate(`/paciente/reservar?vertical=${v.id}`)
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
            onClick={v.comingSoon ? undefined : () => goToVertical(v)}
            className={`p-4 rounded-[12px] flex flex-col gap-1.5 transition-all border border-border-default ${
              v.comingSoon
                ? 'opacity-60 cursor-default bg-bg-secondary'
                : 'cursor-pointer hover:scale-[0.98] active:scale-95 bg-bg-secondary'
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
              <span className="text-[10px] font-bold tracking-wide uppercase px-2 py-0.5 rounded-full self-start" style={{ backgroundColor: v.bg, color: v.color }}>
                Próximamente
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )

  const sosButton = (
    <div className="flex flex-col gap-2">
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
      <div
        onClick={() => navigate('/paciente/urgente')}
        className="w-full py-4 px-5 rounded-[24px] flex items-center gap-4 cursor-pointer active:scale-95 transition-all"
        style={{ backgroundColor: '#E8927C' }}
      >
        <Siren className="w-6 h-6 text-white flex-shrink-0" />
        <div className="flex flex-col">
          <span className="font-bold text-[14px] text-white leading-none">Consulta urgente</span>
          <span className="text-[11px] text-white/80 mt-0.5">Ver a un médico sin turno previo</span>
        </div>
      </div>
    </div>
  )

  // Upcoming consultations section — shown at the top of the dashboard sheet.
  // Hidden entirely once loaded if there's nothing pending/confirmed/in_progress.
  const upcomingSection = (!upcomingLoading && upcomingConsultations.length === 0) ? null : (
    <div className="flex flex-col gap-2">
      {/* Section header with "Reservar" CTA */}
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-text-secondary tracking-wide uppercase">
          Próximas consultas
        </span>
        <button
          onClick={() => navigate('/paciente/consultas')}
          className="flex items-center gap-1 text-[12px] font-bold text-brand hover:text-brand-hover transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Reservar
        </button>
      </div>

      {upcomingLoading ? (
        <div className="h-16 bg-bg-primary rounded-[16px] border border-border-default animate-pulse" />
      ) : (
        upcomingConsultations.map(c => {
          const isVirtual = c.modality === 'video'
          const proName = c.professional?.fullName ?? 'Profesional'
          const d = c.scheduledAt ? new Date(c.scheduledAt) : null
          const dateLabel = d
            ? d.toLocaleDateString('es-AR', { weekday: 'short', day: '2-digit', month: 'short' })
            : '—'
          const timeLabel = d
            ? d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
            : '—:—'
          return (
            <div
              key={c.id}
              onClick={() => {
                if (c.modality === 'video') {
                  navigate(`/paciente/sala-espera/${c.id}`)
                } else {
                  navigate('/paciente/consultas')
                }
              }}
              className="flex items-center gap-3 px-4 py-3 rounded-[16px] bg-bg-primary border border-border-default cursor-pointer hover:border-brand/40 active:opacity-80 transition-all group"
            >
              {/* Modality dot */}
              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isVirtual ? 'bg-brand' : 'bg-emerald-500'}`} />
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-bold text-text-primary truncate leading-tight">{proName}</p>
                <p className="text-[12px] text-text-secondary font-medium mt-0.5">
                  {isVirtual ? 'Videoconsulta' : 'Presencial'} · {dateLabel} {timeLabel}
                </p>
              </div>
              <div className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold flex-shrink-0" style={{ backgroundColor: isVirtual ? '#e8f4ec' : '#ecfdf5', color: isVirtual ? '#7CB38B' : '#059669' }}>
                {isVirtual ? <VideoCamera className="w-3 h-3" /> : <MapPin className="w-3 h-3" />}
              </div>
            </div>
          )
        })
      )}
    </div>
  )

  const healthSnapshotLink = (
    <button
      onClick={() => navigate('/paciente/salud')}
      className="w-full flex items-center gap-3 px-4 py-3 rounded-[14px] bg-bg-primary border border-border-default hover:border-brand/30 active:opacity-80 transition-all group text-left"
    >
      <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: '#7CB38B18' }}>
        <Pulse className="w-4 h-4" style={{ color: '#7CB38B' }} />
      </div>
      <div className="flex-1">
        <p className="text-[13px] font-bold text-text-primary leading-tight">Resumen de salud</p>
        <p className="text-[11px] text-text-secondary font-medium mt-0.5">Condiciones · Medicamentos · Alergias</p>
      </div>
      <CaretRight className="w-4 h-4 text-text-tertiary group-hover:text-text-secondary transition-colors flex-shrink-0" />
    </button>
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
            {upcomingSection}
            {healthSnapshotLink}
            {specialtyGrid}
            <div className="flex flex-col gap-3">{sosButton}</div>
          </div>

        </div>
      )}

      {/* ── Mobile: drag-to-expand bottom sheet ── */}
      {!isDesktop && (
        <div
          className={`absolute left-0 w-full bg-bg-secondary shadow-[0_-15px_40px_rgba(0,0,0,0.08)] z-40 flex flex-col border-t border-border-default ${sheet.state === 'expanded' ? 'rounded-t-none' : 'rounded-t-[40px]'} ${!sheet.dragging ? 'transition-all duration-500 ease-[cubic-bezier(0.2,0.8,0.2,1)]' : ''}`}
          style={{ height: '100%', bottom: 0, transform: sheet.getTransform() }}
        >
          {/* Drag handle + greeting */}
          <div
            className={`w-full flex flex-col items-center pt-4 pb-2 cursor-grab active:cursor-grabbing touch-none bg-bg-secondary ${sheet.state === 'expanded' ? 'rounded-t-none' : 'rounded-t-[40px]'}`}
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

          {/* Content — only scrolls internally when fully expanded; otherwise drags the sheet */}
          <div
            className={`px-6 flex-1 pb-56 scrollbar-hide bg-bg-secondary mt-2 flex flex-col gap-5 ${sheet.state === 'expanded' ? 'overflow-y-auto' : 'overflow-hidden touch-none'}`}
            onPointerDown={sheet.state !== 'expanded' ? sheet.onPointerDown : undefined}
            onPointerMove={sheet.state !== 'expanded' ? sheet.onPointerMove : undefined}
            onPointerUp={sheet.state !== 'expanded' ? sheet.onPointerUp : undefined}
            onPointerCancel={sheet.state !== 'expanded' ? sheet.onPointerUp : undefined}
          >
            {upcomingSection}
            {healthSnapshotLink}
            {specialtyGrid}
            <div className="mb-8">{sosButton}</div>
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
                    onClick={() => handleMapModalitySelect(opt.mod === 'Videollamada' ? 'virtual' : 'presencial')}
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

        </div>
      </PatientSheet>
    </div>
  )
}
