import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import PatientSheet from '../../components/patient/PatientSheet'
import {
  MapPin, CaretRight, Star, VideoCamera, CalendarBlank,
  Heartbeat, X, MagnifyingGlass, Siren, FileText, ClipboardText,
} from '@phosphor-icons/react'
import { track } from '../../utils/analytics'
import { SUPPORT_PHONE_DISPLAY, supportWhatsAppLink } from '../../lib/support'
import WhatsAppMark from '../../components/icons/WhatsAppMark'

import InteractiveMap from '../../components/patient/InteractiveMap'
import ActiveAppointmentBanner from '../../components/patient/ActiveAppointmentBanner'
import ActivePharmacyOrderCard from '../../components/patient/ActivePharmacyOrderCard'
import MedicoCabeceraCard from '../../components/patient/MedicoCabeceraCard'
import MedicoCabeceraModal from '../../components/patient/MedicoCabeceraModal'
import TourPaciente from '../../components/patient/TourPaciente'
import PatientHeader from '../../components/patient/PatientHeader'
import OnDemandCarousel from '../../components/patient/OnDemandCarousel'
import { professionalService } from '../../services/professionalService'
import { historiaClinicaService } from '../../services/historiaClinicaService'
import { emergencyService, getSosSettings } from '../../services/emergencyService'
import { pickProForVertical } from '../../lib/verticals'
import { useVerticales } from '../../hooks/useVerticales'
import { useEspecialidades } from '../../hooks/useEspecialidades'
import { latLngToPixel, haversineKm, formatDistance } from '../../lib/geo'

// Orden fijo del carrusel on demand (spec 2026-09-23) — no el orden de
// `VERTICALS`, que trae también las que no tienen consulta inmediata.
const ORDEN_ONDEMAND = ['clinica', 'pediatria', 'mente', 'nutricion']

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN


// Fallback pixel offsets used when a pro has no geo coordinates yet
const FALLBACK_SLOTS = [
  { x: -120, y: -180 },
  { x:  220, y:  -90 },
  { x: -200, y:   80 },
  { x:  150, y:  190 },
  { x:   50, y: -240 },
]

export default function PatientDashboard({ profile }) {
  // Habilitación de cada vertical: sale de `vertical_settings`, no del código.
  const { verticales: VERTICALS } = useVerticales()
  const { porSlug, porVertical } = useEspecialidades()

  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  // ── "Tu médico de cabecera" (2026-08-21) ──────────────────────────────────
  // El profesional que refirió a este paciente (`referred_by_professional_id`,
  // migración 115). Se trae UNA vez acá porque tanto la tarjeta persistente
  // como el popup post-onboarding lo necesitan, y evita que cada uno haga su
  // propio fetch redundante.
  const [medicoCabecera, setMedicoCabecera] = useState(null)
  const [showMedicoCabeceraModal, setShowMedicoCabeceraModal] = useState(false)
  // Estado local, no el de `profile`: nadie refresca el `profile` global de
  // App.jsx después de un `PATCH`, así que sin esto la tarjeta reaparecería en
  // cuanto el componente re-renderizara por cualquier otra razón.
  const [medicoCabeceraDismissed, setMedicoCabeceraDismissed] = useState(!!profile?.medicoCabeceraDismissed)
  // Cuántas recetas emitidas tiene — subtítulo del acceso "Mis recetas" (ver `ACCESOS`).
  const [recetasCount, setRecetasCount] = useState(0)
  useEffect(() => {
    if (!profile?.id) return
    let cancelled = false
    historiaClinicaService.getIssuedPrescriptions(profile.id)
      // Aditivo: si falla, el dashboard se muestra igual sin el acceso.
      .then(r => { if (!cancelled) setRecetasCount(r.length) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [profile?.id])
  useEffect(() => {
    if (!profile?.referredByProfessionalId) return
    let cancelled = false
    professionalService.getByUserId(profile.referredByProfessionalId)
      .then(pro => { if (!cancelled) setMedicoCabecera(pro) })
      .catch(() => {}) // aditivo — nunca bloquea el resto del dashboard
    return () => { cancelled = true }
  }, [profile?.referredByProfessionalId])

  // El popup se abre UNA sola vez, recién saliendo del onboarding —
  // `referralService.destinoDelReferido()` es quien manda acá con
  // `?ref_popup=1`. Se saca el parámetro apenas se lee (con `replace`, sin
  // agregar una entrada al historial) para que un refresh no lo vuelva a
  // abrir — la tarjeta persistente de abajo queda como el único re-ingreso.
  useEffect(() => {
    if (searchParams.get('ref_popup') !== '1' || !medicoCabecera) return
    setShowMedicoCabeceraModal(true)
    track('referral_post_onboarding_popup_view', { professional_id: medicoCabecera.userId, flow: 'paciente' })
    setSearchParams(prev => { prev.delete('ref_popup'); return prev }, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, medicoCabecera])

  const [userLocation, setUserLocation] = useState(null)
  // El precio de la consulta inmediata ya no se calcula acá: lo fija la vertical
  // (`vertical_settings.ondemand_price`) y viene con ella desde `useVerticales`.
  // Antes se hacía una búsqueda de profesionales POR VERTICAL sólo para sacar el
  // mínimo de sus precios — n consultas a la base en cada carga del dashboard,
  // para un número que ahora es un dato de configuración.
  const [showMap, setShowMap] = useState(false)
  const [mapProFlow, setMapProFlow] = useState(null)
  const [selectedMapPro, setSelectedMapPro] = useState(null)
  const [proPool, setProPool] = useState([])
  const [activeEmergency, setActiveEmergency] = useState(null)
  // Disponibilidad del servicio S.O.S. — /super-admin/verticales (migración
  // 087). Arranca en `true` (fail-open, misma filosofía que
  // `getSosSettings()`): mientras se resuelve el fetch es mejor mostrar el
  // botón un instante de más que ocultarlo por un fetch lento o caído.
  const [sosEnabled, setSosEnabled] = useState(true)

  // One pro per vertical, keyed by vertical id
  const markersByVertical = useMemo(() => {
    const result = {}
    VERTICALS.forEach(v => {
      if (v.comingSoon) return   // no map pin for coming-soon verticals
      const pro = pickProForVertical(proPool, v.id, porVertical)
      if (pro) result[v.id] = pro
    })
    return result
  }, [proPool, VERTICALS, porVertical])

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
    [markersByVertical, userLocation, VERTICALS]
  )

  // ── Carrusel "Atención inmediata" (spec 2026-09-23) ──────────────────────
  // Sólo entran las verticales con AL MENOS UN profesional on demand
  // disponible ahora mismo — misma consulta que ya usa el flujo on demand
  // (OnDemand.jsx) y el mapa: `onDemand: true, onlyLive: true` respeta el TTL
  // de presencia existente (ON_DEMAND_PRESENCE_TTL_MS). Se trae UNA vez, sin
  // filtro de especialidad, y se agrupa acá por vertical — así son 4
  // verticales resueltas con 1 sola consulta en vez de 4.
  const [onDemandLivePros, setOnDemandLivePros] = useState([])
  useEffect(() => {
    professionalService.search({ onDemand: true, onlyLive: true })
      .then(setOnDemandLivePros)
      .catch(() => {}) // aditivo — sin datos, el carrusel muestra el estado "sin nadie en línea"
  }, [])

  const verticalesConOnDemand = useMemo(() => {
    return ORDEN_ONDEMAND
      .map(id => VERTICALS.find(v => v.id === id))
      .filter(v => v && !v.comingSoon)
      .filter(v => {
        const slugs = porVertical[v.id] || []
        return onDemandLivePros.some(p => slugs.includes(p.specialty))
      })
  }, [VERTICALS, porVertical, onDemandLivePros])

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

  // Active emergency resume banner — a dispatched/in_transit/arrived SOS is a
  // non-terminal record and must offer a way back into the tracking screen
  // (State Resilience rule). Re-checked on tab focus so the banner clears
  // itself once the emergency is resolved elsewhere. Fetched alongside the SOS
  // enabled/disabled toggle since both come from the same mount/focus trigger.
  const lastEmergencyFetchRef = useRef(0)
  useEffect(() => {
    if (!profile?.id) return
    let cancelled = false
    const load = () => {
      lastEmergencyFetchRef.current = Date.now()
      emergencyService.getActiveForPatient(profile.id)
        .then(data => { if (!cancelled) setActiveEmergency(data) })
        .catch(() => {}) // silent — the banner is additive, never blocks the home
      // Sin .catch: getSosSettings() ya falla abierto (nunca rechaza) — ver su
      // propio comentario en emergencyService.js.
      getSosSettings().then(({ enabled }) => { if (!cancelled) setSosEnabled(enabled) })
    }
    load()
    // Throttled to at most once every 30s — a tab getting focused/blurred
    // repeatedly (alt-tabbing, switching apps) shouldn't refire this on every
    // visibilitychange event.
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastEmergencyFetchRef.current < 30_000) return
      load()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => { cancelled = true; document.removeEventListener('visibilitychange', onVisible) }
  }, [profile?.id])

  const handleMarkerClick = type => {
    const pro = markersByVertical[type]
    if (!pro) return
    const vert = VERTICALS.find(v => v.id === type)
    setSelectedMapPro({
      name:       pro.profiles?.fullName || 'Profesional',
      specialty:  porSlug[pro.specialty] || pro.specialty,
      // Rating stays numeric-or-null: the sheet only renders the badge when the
      // professional actually has reviews, so a pro with none shows nothing
      // instead of a fabricated score.
      rating:     pro.averageRating != null ? Number(pro.averageRating) : null,
      reviews:    pro.totalReviews ?? 0,
      img:        pro.profiles?.avatarUrl || null,
      color:      vert.color,
      bg:         vert.bg,
      icon:       vert.icon,
      userId:     pro.userId,
      verticalId: type,
      latitude:   pro.latitude ?? null,
      longitude:  pro.longitude ?? null,
    })
    setMapProFlow('details')
  }

  // Real straight-line distance from the patient to the selected pro's office.
  // null whenever either side lacks coordinates — the UI then omits the phrase
  // rather than showing a made-up number.
  const selectedProDistance = useMemo(() => {
    if (!selectedMapPro) return null
    return formatDistance(haversineKm(userLocation, {
      lat: selectedMapPro.latitude,
      lng: selectedMapPro.longitude,
    }))
  }, [selectedMapPro, userLocation])

  const handleMapModalitySelect = modality => {
    if (!selectedMapPro) return
    const { verticalId, userId } = selectedMapPro
    setMapProFlow(null)
    setSelectedMapPro(null)
    // modality === null → land on the wizard's modality step so the patient
    // picks modality + date themselves ("agendar para otro día").
    const modalityParam = modality ? `&modality=${modality}` : ''
    navigate(`/paciente/reservar?vertical=${verticalId}&proId=${userId}${modalityParam}`)
  }

  // ── Shared content blocks ────────────────────────────────
  //
  // El carrusel "Agendá con un profesional" (antes `specialtyGrid`, con
  // `goToVertical`) se mudó a la pestaña Turnos — spec 2026-09-23: "se saca
  // del Inicio, vive en Turnos". Ver `Consultations.jsx`. El hero de on
  // demand con las fotos por vertical también se reemplazó — ahora vive en
  // `OnDemandCarousel.jsx`, con el drag+degradé interpolado del spec.

  // Vista previa estática del mapa con la Static Images API de Mapbox — mismo
  // estilo (light-v11) que el mapa interactivo, así la miniatura y lo que se
  // abre al tocar son la misma cosa. Se centra en la ubicación del paciente
  // cuando la tenemos; si no, en el centro de CABA.
  const staticMapUrl = (() => {
    const lng = userLocation?.lng ?? -58.4173
    const lat = userLocation?.lat ?? -34.6118
    const zoom = userLocation ? 13 : 11
    return `https://api.mapbox.com/styles/v1/mapbox/light-v11/static/${lng},${lat},${zoom},0/640x260@2x?access_token=${MAPBOX_TOKEN}&attribution=false&logo=false`
  })()

  // "Profesionales cerca tuyo" — tarjeta-mapa, spec 2026-09-23. Usa la
  // vista previa real de Mapbox (ya existía) en vez del mockup decorativo del
  // diseño de referencia: es información real, no un placeholder.
  const mapCta = (
    <button
      data-tour="pac-mapa"
      onClick={() => { track('view_map_click', { flow: 'paciente' }); setShowMap(true) }}
      className="w-full bg-bg-secondary border border-brand/30 rounded-3xl shadow-[0_1px_4px_rgba(45,42,38,0.06)] overflow-hidden text-left active:scale-[0.98] transition-all"
    >
      <img
        src={staticMapUrl}
        alt=""
        loading="lazy"
        className="w-full h-[130px] object-cover"
      />
      <div className="p-4 flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold text-[17px] text-text-primary leading-none">Profesionales cerca tuyo</span>
          <span className="shrink-0 flex items-center gap-1.5 bg-brand rounded-full px-3.5 py-2 text-white text-[13px] font-semibold">
            Ver el mapa <CaretRight className="w-3.5 h-3.5" />
          </span>
        </div>
        <p className="text-[13px] text-text-secondary leading-snug">
          Fijate qué profesionales hay disponibles cerca tuyo para una atención presencial o virtual inmediata.
        </p>
      </div>
    </button>
  )

  // "4 accesos iguales" — spec 2026-09-23: historia clínica, recetas, buscar
  // por nombre, soporte. `Buscar por nombre` acá apunta a la lista de
  // disponibles-ahora nueva (§3 del spec), NO a `/paciente/buscar` (esa
  // busca entre TODOS los profesionales cobrables, disponibles o no — sigue
  // existiendo, sólo que ya no tiene acceso directo desde el Inicio).
  const ACCESOS = [
    {
      key: 'historia', icon: ClipboardText, label: 'Historia clínica electrónica', sub: 'Tus estudios y evoluciones',
      onClick: () => { track('quick_access_click', { access: 'historia_clinica', flow: 'paciente' }); navigate('/paciente/historia-clinica') },
    },
    {
      key: 'recetas', icon: FileText,
      label: 'Mis recetas',
      sub: recetasCount > 0 ? (recetasCount === 1 ? '1 receta emitida' : `${recetasCount} recetas emitidas`) : 'Sin recetas emitidas',
      onClick: () => { track('quick_access_click', { access: 'recetas', flow: 'paciente' }); navigate('/paciente/recetas') },
    },
    {
      key: 'buscar', tour: 'pac-buscar', icon: MagnifyingGlass, label: 'Buscar por nombre', sub: 'Quién está disponible ahora',
      onClick: () => { track('quick_access_click', { access: 'buscar_disponibles', flow: 'paciente' }); navigate('/paciente/buscar-disponibles') },
    },
    {
      key: 'soporte', icon: null, label: 'Contactá a soporte', sub: `WhatsApp ${SUPPORT_PHONE_DISPLAY}`,
      href: supportWhatsAppLink('Hola, soy paciente en Healthier y necesito ayuda con:'),
      onClick: () => track('support_whatsapp_click', { flow: 'paciente' }),
    },
  ]

  const accesosGrid = (
    <div className="grid grid-cols-2 gap-2.5">
      {ACCESOS.map(a => {
        const Tag = a.href ? 'a' : 'button'
        return (
          <Tag
            key={a.key}
            data-tour={a.tour}
            {...(a.href ? { href: a.href, target: '_blank', rel: 'noreferrer' } : {})}
            onClick={a.onClick}
            className="bg-bg-secondary border border-border-default rounded-[24px] p-4 flex flex-col text-left hover:border-brand/40 active:opacity-90 transition-colors"
          >
            <div className="flex items-center justify-between">
              <span className="w-10 h-10 rounded-full bg-brand-muted flex items-center justify-center">
                {a.icon ? <a.icon className="w-5 h-5 text-brand" /> : <WhatsAppMark className="w-5 h-5" />}
              </span>
              <CaretRight className="w-[18px] h-[18px] text-text-muted" />
            </div>
            <div className="mt-5 flex flex-col">
              <span className="font-medium text-[14px] text-text-primary leading-tight">{a.label}</span>
              <span className="text-[11px] text-text-secondary mt-0.5 leading-snug">{a.sub}</span>
            </div>
          </Tag>
        )
      })}
    </div>
  )

  // El toggle sólo esconde la ENTRADA a un SOS nuevo. Una emergencia ya en
  // curso (activeEmergencyBanner) se sigue mostrando siempre — deshabilitar el
  // servicio no puede dejar a un paciente con una emergencia activa sin forma
  // de volver a la pantalla de tracking.
  const sosButton = sosEnabled && (
    <button
      data-tour="pac-sos"
      onClick={() => { track('sos_click', { flow: 'paciente' }); navigate('/paciente/sos') }}
      className="w-full py-5 px-5 rounded-2xl bg-danger flex items-center gap-4 text-left active:scale-[0.98] transition-all"
    >
      <Heartbeat className="w-7 h-7 text-white flex-shrink-0" />
      <div className="flex flex-col">
        <span className="font-semibold text-[15px] text-white leading-none">EMERGENCIA S.O.S</span>
        <span className="text-[12px] text-white/80 mt-0.5">Solicitar atención de inmediato</span>
      </div>
      <CaretRight className="w-4 h-4 text-white/70 flex-shrink-0 ml-auto" />
    </button>
  )

  // Re-entry point for an SOS already dispatched — outranks the regular
  // appointment banner since an active emergency is the more urgent thing to
  // resume. Renders nothing when there isn't one (State Resilience rule: a
  // non-terminal `emergencies` row must offer a way back into tracking).
  const activeEmergencyBanner = activeEmergency && (
    <button
      onClick={() => navigate('/paciente/sos')}
      className="w-full rounded-[28px] bg-danger/95 border border-white/20 shadow-[0_8px_24px_rgba(217,83,79,0.35)] p-5 flex items-center gap-4 text-left active:scale-[0.98] transition-all"
    >
      <div className="w-11 h-11 rounded-full bg-white/15 flex items-center justify-center flex-shrink-0">
        <Siren className="w-5 h-5 text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-[10px] font-semibold tracking-widest uppercase text-white/80">Emergencia en curso</span>
        <p className="text-[15px] font-semibold text-white leading-tight mt-1 truncate">
          Código {activeEmergency.dispatchCode ?? '—'}
        </p>
      </div>
      <CaretRight className="w-5 h-5 text-white flex-shrink-0" />
    </button>
  )

  // ── Render ───────────────────────────────────────────────

  return (
    <div className="absolute inset-0">
      {/* `listo` espera a que hayan llegado las verticales y el estado del
          S.O.S.: los `aplica()` de los pasos se evalúan una sola vez al
          arrancar, y con `VERTICALS` todavía vacío el paso de consulta
          inmediata se perdería en silencio. */}
      <TourPaciente
        hayOnDemand={verticalesConOnDemand.length > 0}
        sosActivo={sosEnabled}
        listo={VERTICALS.length > 0}
      />

      <div className="absolute inset-0 overflow-y-auto scrollbar-hide bg-bg-primary">

        {/* Bloque de borde a borde: arranca pegado al tope (sin redondeo
            arriba) y cierra redondeado abajo. El header (Hola + avatar +
            campana) y el padding del texto viven DENTRO de `OnDemandCarousel`
            — así el degradé de fondo queda de borde a borde de verdad y el
            texto/tarjetas tienen su propio padding adentro. */}
        <div className="rounded-b-[32px] overflow-hidden">
          <OnDemandCarousel
            verticals={verticalesConOnDemand}
            header={<PatientHeader profile={profile} />}
          />
        </div>

        {/* Banners de flujo crítico — consulta activa / turno próximo /
            emergencia en curso. Antes vivían DENTRO del bloque verde; con el
            carrusel ahora dueño de ese fondo (degradé por especialidad, no
            más un verde parejo), se muestran acá debajo, apenas se sale del
            carrusel — siguen siendo lo primero que se ve después de él.
            `empty:hidden` los saca sin dejar el padding cuando ninguno de los
            dos tiene algo que mostrar (los dos devuelven `null`). */}
        <div className="px-6 patient-column pt-5 w-full flex flex-col gap-3 empty:hidden empty:pt-0">
          {activeEmergencyBanner}
          <ActiveAppointmentBanner profile={profile} />
        </div>

        {/* El pedido de farmacia en curso. Sale solo cuando no hay ninguno,
            así que no ocupa lugar para el que nunca compró. */}
        <div className="px-6 patient-column pt-5 w-full empty:hidden">
          <ActivePharmacyOrderCard profile={profile} />
        </div>

        {/* "Tu médico de cabecera" — sólo si vino referido y no la cerró. */}
        {medicoCabecera && !medicoCabeceraDismissed && (
          <div className="px-6 patient-column pt-5 w-full">
            <MedicoCabeceraCard
              profile={profile}
              professional={medicoCabecera}
              onOpen={() => setShowMedicoCabeceraModal(true)}
              onDismissed={() => setMedicoCabeceraDismissed(true)}
            />
          </div>
        )}

        <div className="px-6 patient-column pt-6 pb-32 flex flex-col gap-5 w-full">
          {mapCta}
          {accesosGrid}
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
              {/* Professional details — deliberately unboxed: no card background,
                  no border, no padding. The sheet itself is the surface. */}
              <div className="flex items-center gap-5 mb-6">
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
                  {/* Only shown when the professional has real reviews behind it. */}
                  {selectedMapPro.reviews > 0 && selectedMapPro.rating != null ? (
                    <div className="flex items-center gap-1 mt-1.5">
                      <Star className="w-3.5 h-3.5 fill-yellow-400 text-yellow-400" />
                      <span className="font-semibold text-[13px] text-gray-800">{selectedMapPro.rating.toFixed(1)}</span>
                      <span className="text-[12px] text-gray-400">
                        ({selectedMapPro.reviews} {selectedMapPro.reviews === 1 ? 'reseña' : 'reseñas'})
                      </span>
                    </div>
                  ) : (
                    <span className="inline-block text-[12px] text-gray-400 font-medium mt-1.5">Todavía sin reseñas</span>
                  )}
                </div>
              </div>
              <h3 className="font-semibold text-[18px] text-gray-900 mb-4">¿Cómo preferís atenderte?</h3>
              <div className="space-y-3">
                {[
                  {
                    key: 'virtual',
                    label: 'Virtual (En Vivo)',
                    sub: 'Conectá por videollamada al instante.',
                    modality: 'virtual',
                    icon: VideoCamera,
                    color: 'text-brand',
                    bg: 'bg-blue-50',
                  },
                  {
                    key: 'presencial',
                    label: 'Presencial',
                    // Real distance when we have both the patient's position and the
                    // professional's office coordinates; plain copy otherwise.
                    sub: selectedProDistance
                      ? `Acudí al consultorio (a ${selectedProDistance} de vos).`
                      : 'Acudí al consultorio del profesional.',
                    modality: 'presencial',
                    icon: MapPin,
                    color: 'text-emerald-600',
                    bg: 'bg-emerald-50',
                  },
                  {
                    key: 'agendar',
                    label: 'Agendar turno para otro día',
                    sub: 'Elegí modalidad, fecha y horario.',
                    modality: null,
                    icon: CalendarBlank,
                    color: 'text-brand-tertiary',
                    bg: 'bg-brand-tertiary-muted',
                  },
                ].map(opt => (
                  <div
                    key={opt.key}
                    onClick={() => handleMapModalitySelect(opt.modality)}
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

      <MedicoCabeceraModal
        open={showMedicoCabeceraModal}
        onClose={() => setShowMedicoCabeceraModal(false)}
        professional={medicoCabecera}
      />
    </div>
  )
}
