import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import PatientBottomNav from '../../components/patient/PatientBottomNav'
import {
  Search, Stethoscope, Apple, BrainCircuit, Dumbbell, MapPin,
  Clock, ChevronRight, Star, ShieldCheck, Video,
  Loader2, Sparkles, AlertTriangle, Mic,
  Heart, Moon, Flame, PawPrint,
} from 'lucide-react'
import InteractiveMap from '../../components/patient/InteractiveMap'
import { useBottomSheet } from '../../components/patient/useBottomSheet'
import { aiService } from '../../services/aiService'
import { consultationsService } from '../../services/consultationsService'
import { toast } from '../../components/Toast'

const VERTICALS = [
  { id: 'clinica',     nombre: 'Clínica',      icon: Stethoscope, color: '#2563EB', bg: '#EFF6FF', shadow: 'rgba(37,99,235,0.15)',  eta: '3 min' },
  { id: 'nutricion',   nombre: 'Nutrición',    icon: Apple,       color: '#059669', bg: '#ECFDF5', shadow: 'rgba(5,150,105,0.15)',  eta: '10 min' },
  { id: 'mente',       nombre: 'Psicología',   icon: BrainCircuit,color: '#7C3AED', bg: '#F5F3FF', shadow: 'rgba(124,58,237,0.15)', eta: '15 min' },
  { id: 'fisico',      nombre: 'Kinesiología', icon: Dumbbell,    color: '#EA580C', bg: '#FFF7ED', shadow: 'rgba(234,88,12,0.15)',  eta: '5 min' },
  { id: 'veterinaria', nombre: 'Veterinaria',  icon: PawPrint,    color: '#0284C7', bg: '#F0F9FF', shadow: 'rgba(2,132,199,0.15)',  eta: '8 min' },
]

const MARKER_PRO_MAP = {
  clinica:   { name: 'Dr. Martín López',      specialty: 'Médico Clínico',      rating: '4.9', reviews: 256, img: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=200&q=80', color: '#2563EB', bg: '#EFF6FF', icon: Stethoscope },
  nutricion: { name: 'Lic. Ana Gómez',        specialty: 'Nutrición Clínica',   rating: '4.8', reviews: 204, img: 'https://images.unsplash.com/photo-1594824432258-f6a26563b7e7?auto=format&fit=crop&w=200&q=80', color: '#059669', bg: '#ECFDF5', icon: Apple },
  fisico:    { name: 'Lic. Matías Fernández', specialty: 'Kinesiología y Rehab', rating: '4.9', reviews: 312, img: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=200&q=80', color: '#EA580C', bg: '#FFF7ED', icon: Dumbbell },
}

export default function PatientDashboard({ profile }) {
  const navigate = useNavigate()
  const sheet = useBottomSheet('half')

  const [isDesktop, setIsDesktop] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 640)
  const [appState, setAppState] = useState('home')
  const [searchQuery, setSearchQuery] = useState('')
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [aiResponse, setAiResponse] = useState(null)
  const [userLocation, setUserLocation] = useState(null)
  const [addressName, setAddressName] = useState('Buscando ubicación...')
  const [isLocating, setIsLocating] = useState(true)
  const [mapProFlow, setMapProFlow] = useState(null)
  const [selectedMapPro, setSelectedMapPro] = useState(null)
  const [selectedMapModality, setSelectedMapModality] = useState(null)
  const [mapPaymentStatus, setMapPaymentStatus] = useState('idle')

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
            try {
              const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`)
              const data = await res.json()
              const street = data.address.road || data.address.suburb || data.address.city || 'Ubicación Actual'
              const num = data.address.house_number ? ` ${data.address.house_number}` : ''
              setAddressName(`${street}${num}`)
            } catch {
              setAddressName('Ubicación Actual')
            }
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

  const handleAITriage = async () => {
    if (!searchQuery.trim()) return
    setIsAnalyzing(true)
    setAiResponse(null)
    try {
      const res = await aiService.triage(searchQuery)
      setAiResponse(res)
    } catch {
      toast.error('Error al analizar síntomas')
    } finally {
      setIsAnalyzing(false)
    }
  }

  const handleMarkerClick = type => {
    if (MARKER_PRO_MAP[type]) {
      setSelectedMapPro(MARKER_PRO_MAP[type])
      setMapProFlow('details')
      setMapPaymentStatus('idle')
    }
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

  const firstName = profile?.fullName?.split(' ')[0] || 'Paciente'

  // ── Shared content blocks ────────────────────────────────

  const vitalsRow = (
    <div className="flex gap-3 py-1">
      <div className="bg-red-50/50 border border-red-100 rounded-[16px] p-3 flex-1 flex flex-col justify-center items-center shadow-sm">
        <Heart className="w-5 h-5 text-red-500 mb-1" />
        <span className="font-black text-gray-900 text-[15px]">72 <span className="text-[10px] font-bold text-gray-400">BPM</span></span>
      </div>
      <div className="bg-blue-50/50 border border-blue-100 rounded-[16px] p-3 flex-1 flex flex-col justify-center items-center shadow-sm">
        <Moon className="w-5 h-5 text-blue-500 mb-1" />
        <span className="font-black text-gray-900 text-[15px]">7h <span className="text-[10px] font-bold text-gray-400">20M</span></span>
      </div>
      <div className="bg-orange-50/50 border border-orange-100 rounded-[16px] p-3 flex-1 flex flex-col justify-center items-center shadow-sm">
        <Flame className="w-5 h-5 text-orange-500 mb-1" />
        <span className="font-black text-gray-900 text-[15px]">4.2 <span className="text-[10px] font-bold text-gray-400">KCAL</span></span>
      </div>
    </div>
  )

  const aiTriageBar = (expandOnClick) => (
    <div
      className={`bg-[#F8FAFC] p-4 rounded-[24px] flex flex-col gap-3 shadow-sm border border-gray-100 transition-all focus-within:ring-2 focus-within:ring-blue-100 focus-within:border-blue-200 ${searchQuery ? 'border-blue-200 bg-blue-50/30' : ''}`}
      onClick={expandOnClick}
    >
      <div className="flex items-center gap-3">
        <Search className={`h-5 w-5 ${searchQuery ? 'text-brand' : 'text-gray-400'}`} />
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Escribí o dictá tus síntomas..."
          className="bg-transparent border-none outline-none w-full text-[16px] font-medium placeholder-gray-400 text-gray-900"
        />
        {!searchQuery && (
          <button className="p-2 bg-white rounded-full shadow-sm hover:bg-gray-50 flex-shrink-0">
            <Mic className="w-4 h-4 text-gray-400" />
          </button>
        )}
        {searchQuery && (
          <button
            onClick={e => { e.stopPropagation(); handleAITriage() }}
            disabled={isAnalyzing}
            className="bg-brand p-2.5 rounded-full hover:bg-brand-hover transition-colors flex-shrink-0 shadow-md"
          >
            {isAnalyzing
              ? <Loader2 className="w-4 h-4 text-white animate-spin" />
              : <Sparkles className="w-4 h-4 text-white" />
            }
          </button>
        )}
      </div>

      {aiResponse && (
        <div className="bg-white p-4 rounded-xl border border-blue-100 shadow-sm mt-2 animate-fade-in relative overflow-hidden">
          <div className="absolute top-0 left-0 w-1.5 h-full bg-brand" />
          <div className="flex gap-3 items-start">
            <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Sparkles className="w-4 h-4 text-brand" />
            </div>
            <div className="flex-1">
              <p className="text-[14px] text-gray-700 leading-snug mb-3 font-medium">
                {aiResponse.mensaje.replace(/\*(.*?)\*/g, '')}
              </p>
              <p className="text-[11px] text-gray-400">*Consultá a un médico para diagnóstico exacto.*</p>
              {(() => {
                const rec = VERTICALS.find(v => v.id === aiResponse.recomendacion_id)
                if (!rec) return null
                return (
                  <button
                    onClick={() => navigate(`/paciente/ondemand/${rec.id}`)}
                    className="w-full mt-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm font-bold flex items-center justify-center gap-2 hover:bg-white hover:border-blue-300 transition-colors text-gray-900"
                  >
                    Agendar con {rec.nombre} <ChevronRight className="w-4 h-4 text-gray-400" />
                  </button>
                )
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  )

  const specialtyGrid = (
    <div className="grid grid-cols-2 gap-3">
      {VERTICALS.filter(v => v.id !== 'veterinaria').map(v => (
        <div
          key={v.id}
          onClick={() => navigate(`/paciente/ondemand/${v.id}`)}
          className="p-4 rounded-[24px] cursor-pointer flex flex-col gap-2 transition-all hover:scale-[0.98] active:scale-95 border border-gray-100 bg-white group"
          style={{ boxShadow: `0 8px 24px ${v.shadow}` }}
        >
          <div className="w-11 h-11 rounded-[14px] flex items-center justify-center mb-1 transition-transform group-hover:scale-110" style={{ backgroundColor: v.bg }}>
            <v.icon className="h-[20px] w-[20px]" style={{ color: v.color }} />
          </div>
          <span className="font-bold text-[16px] text-gray-900 tracking-tight leading-tight">{v.nombre}</span>
          <span className="text-[12px] font-medium text-gray-400">{v.eta} espera</span>
        </div>
      ))}
    </div>
  )

  const sosAndVet = (
    <>
      {/* SOS button */}
      <div
        onClick={() => navigate('/paciente/sos')}
        className="w-full bg-white py-5 px-4 rounded-[24px] shadow-[0_8px_24px_rgba(220,38,38,0.12)] flex items-center justify-center cursor-pointer hover:border-red-200 active:scale-95 transition-all border border-red-100 relative overflow-hidden group"
      >
        <div className="absolute inset-0 bg-red-50 translate-y-full group-active:translate-y-0 transition-transform duration-300" />
        <div className="flex flex-col items-center justify-center text-center relative z-10">
          <span className="font-black text-[18px] tracking-wide leading-none mb-1 text-red-600">EMERGENCIA S.O.S</span>
          <span className="font-medium text-[12px] text-gray-500">Presioná para solicitar ambulancia</span>
        </div>
      </div>

      {/* Veterinary */}
      {(() => {
        const vet = VERTICALS.find(v => v.id === 'veterinaria')
        return (
          <div
            onClick={() => navigate(`/paciente/ondemand/${vet.id}`)}
            className="w-full p-4 rounded-[24px] cursor-pointer flex items-center gap-4 transition-transform hover:scale-[0.98] active:scale-95 shadow-sm border border-gray-100 bg-white group"
          >
            <div className="w-12 h-12 rounded-[16px] flex items-center justify-center transition-transform group-hover:scale-110" style={{ backgroundColor: vet.bg }}>
              <vet.icon className="h-[22px] w-[22px]" style={{ color: vet.color }} />
            </div>
            <div className="flex flex-col flex-1">
              <span className="font-black text-[17px] text-gray-900 tracking-tight leading-tight">{vet.nombre}</span>
              <span className="text-[13px] text-gray-500 font-medium">Atención para mascotas</span>
            </div>
            <span className="text-[12px] font-bold px-3 py-1.5 rounded-full bg-gray-50 text-gray-600">{vet.eta}</span>
          </div>
        )
      })()}
    </>
  )

  const avatarEl = (
    <div className="w-11 h-11 bg-gray-100 rounded-full overflow-hidden border-2 border-white shadow-sm flex-shrink-0">
      {profile?.avatarUrl
        ? <img src={profile.avatarUrl} alt="Perfil" className="w-full h-full object-cover" />
        : <div className="w-full h-full flex items-center justify-center text-gray-400 font-bold">{firstName[0]}</div>
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
        onMarkerClick={handleMarkerClick}
        userLocation={userLocation}
      />

      {/* Location header */}
      <div className="absolute top-4 sm:top-6 w-full px-6 z-30 flex justify-start items-center pointer-events-none">
        <div className="flex flex-col bg-white/70 backdrop-blur-[20px] px-2 py-2 rounded-[20px] shadow-[0_8px_30px_rgba(0,0,0,0.06)] border border-white/50 pointer-events-auto cursor-pointer transition-all self-start max-w-[70%]">
          <div className="flex items-center gap-2 pr-2">
            <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center shadow-sm flex-shrink-0">
              {isLocating
                ? <Loader2 className="h-4 w-4 text-brand animate-spin" />
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

      {/* ── Desktop: Google Maps-style floating panel (bottom-left) ── */}
      {isDesktop && (
        <div
          className="absolute left-4 z-40 w-[360px] bg-white/90 backdrop-blur-[20px] rounded-[28px] shadow-[0_8px_40px_rgba(0,0,0,0.12)] flex flex-col border border-white/80 overflow-hidden"
          style={{ bottom: '16px', maxHeight: 'calc(100dvh - 32px)' }}
        >
          {/* Panel header */}
          <div className="px-5 pt-5 pb-3 flex justify-between items-center flex-shrink-0 border-b border-gray-100/80">
            <div>
              <h2 className="text-[22px] font-black tracking-tight text-gray-900 leading-none">Hola, {firstName}</h2>
              <p className="text-[13px] font-medium text-gray-500 mt-0.5">¿Cómo te sentís hoy?</p>
            </div>
            {avatarEl}
          </div>

          {/* Scrollable body — all sections always visible */}
          <div className="overflow-y-auto scrollbar-hide flex-1 px-5 pt-4 pb-4 flex flex-col gap-4">
            {vitalsRow}
            {aiTriageBar(undefined)}
            {specialtyGrid}
            <div className="flex flex-col gap-3">{sosAndVet}</div>
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
          className={`absolute left-0 w-full bg-white rounded-t-[40px] shadow-[0_-15px_40px_rgba(0,0,0,0.08)] z-40 flex flex-col border-t border-gray-100 ${!sheet.dragging ? 'transition-transform duration-500 ease-[cubic-bezier(0.2,0.8,0.2,1)]' : ''}`}
          style={{ height: '85%', bottom: 0, transform: sheet.getTransform() }}
        >
          {/* Drag handle + greeting */}
          <div
            className="w-full flex flex-col items-center pt-4 pb-2 cursor-grab active:cursor-grabbing touch-none bg-white rounded-t-[40px]"
            onPointerDown={sheet.onPointerDown}
            onPointerMove={sheet.onPointerMove}
            onPointerUp={sheet.onPointerUp}
            onPointerCancel={sheet.onPointerUp}
          >
            <div className="w-12 h-1.5 bg-gray-200 rounded-full mb-5 pointer-events-none" />
            <div className="w-full px-6 flex justify-between items-center pointer-events-none mb-2">
              <div>
                <h2 className="text-[28px] font-black tracking-tight text-gray-900 leading-none">Hola, {firstName}</h2>
                <p className="text-[14px] font-medium text-gray-500 mt-1">¿Cómo te sentís hoy?</p>
              </div>
              <div className="w-12 h-12 bg-gray-100 rounded-full overflow-hidden border-2 border-white shadow-sm flex-shrink-0">
                {profile?.avatarUrl
                  ? <img src={profile.avatarUrl} alt="Perfil" className="w-full h-full object-cover" />
                  : <div className="w-full h-full flex items-center justify-center text-gray-400 font-bold text-lg">{firstName[0]}</div>
                }
              </div>
            </div>
          </div>

          {/* Scrollable content */}
          <div className="px-6 flex-1 overflow-y-auto pb-32 scrollbar-hide bg-white mt-2 flex flex-col gap-5">
            {vitalsRow}
            {aiTriageBar(() => sheet.setState('expanded'))}
            {specialtyGrid}

            {/* SOS + Vet — revealed when expanded */}
            <div className={`transition-all duration-500 ease-in-out overflow-hidden flex flex-col gap-4 ${sheet.state === 'expanded' ? 'max-h-[500px] opacity-100 mb-8' : 'max-h-0 opacity-0 m-0'}`}>
              {sosAndVet}
            </div>
          </div>
        </div>
      )}

      {/* Map pro flow overlay */}
      {mapProFlow && selectedMapPro && (
        <div className="absolute inset-0 bg-gray-900/50 backdrop-blur-sm z-[80] flex flex-col justify-end animate-fade-in">
          <button
            onClick={() => { setMapProFlow(null); setSelectedMapPro(null); setSelectedMapModality(null) }}
            className="absolute top-4 right-6 z-[90] w-10 h-10 bg-white border border-gray-200 shadow-sm rounded-full flex items-center justify-center hover:bg-gray-50"
          >
            ✕
          </button>

          <div className="w-full bg-white rounded-t-[40px] shadow-[0_-20px_50px_rgba(0,0,0,0.2)] pb-10 pt-6 animate-slide-up-spring">
            {mapProFlow === 'details' && (
              <div className="px-6">
                <div className="bg-[#F8FAFC] rounded-[28px] p-5 border border-gray-100 flex items-center gap-5 mb-6">
                  <img src={selectedMapPro.img} alt={selectedMapPro.name} className="w-20 h-20 rounded-[20px] object-cover border-2 border-white shadow-sm flex-shrink-0" />
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
                    { label: 'Virtual (En Vivo)', sub: 'Conectá por videollamada al instante.', mod: 'Videollamada', icon: Video, color: 'text-brand', bg: 'bg-blue-50' },
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
                      <ChevronRight className="w-5 h-5 text-gray-300 group-hover:text-brand transition-colors" />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {mapProFlow === 'payment' && (
              <div className="px-6 animate-fade-in">
                <div className="flex items-center gap-3 mb-6">
                  <button onClick={() => setMapProFlow('details')} className="w-10 h-10 bg-white border border-gray-100 rounded-full flex items-center justify-center shadow-sm hover:bg-gray-50" disabled={mapPaymentStatus !== 'idle'}>
                    ←
                  </button>
                  <h2 className="text-[24px] font-black text-gray-900 leading-none tracking-tight">Confirmar Reserva</h2>
                </div>
                <div className="bg-[#F8FAFC] rounded-[24px] p-5 border border-gray-100 mb-6">
                  <div className="flex items-center gap-4 mb-4 pb-4 border-b border-gray-200">
                    <img src={selectedMapPro.img} alt={selectedMapPro.name} className="w-12 h-12 rounded-full object-cover border border-white shadow-sm" />
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
                  {mapPaymentStatus === 'processing' ? <><Loader2 className="w-5 h-5 animate-spin" /> Procesando...</>
                   : mapPaymentStatus === 'success' ? <>✓ ¡Reserva Exitosa!</>
                   : <>Pagar $20.00 y Conectar</>}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
