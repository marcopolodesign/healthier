import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Warning, CircleNotch, Check, Phone,
  User, CheckCircle, PhoneCall, MapPinLine,
} from '@phosphor-icons/react'
import { emergencyService, getSosSettings, SOS_FALLBACK } from '../../services/emergencyService'
import { emergencyTrackingService, esReciente, FRESCURA_MINUTOS } from '../../services/emergencyTrackingService'
import { getRoute, formatMeters, formatMinutes } from '../../lib/directions'
import { mpService } from '../../services/mpService'
import { brandLabel } from '../../components/payment/cardBrand'
import InteractiveMap from '../../components/patient/InteractiveMap'
import PatientSheet from '../../components/patient/PatientSheet'
import MPCardHolder from '../../components/payment/MPCardHolder'
import { toast } from '../../components/Toast'
import {
  EMERGENCY_SYMPTOMS, TRIAGE_SEVERITY_ORDER, computeTriageCode, symptomLabelsFromIds,
} from '../../data/emergencySymptoms'

// SAME Buenos Aires — the honest fallback for real risk of life. Telehealth
// SOS is never a substitute for it; this line was missing from the old flow.
const SAME_PHONE = '107'

// Status order the tracking phase walks through, oldest → newest.
const TRACKING_STEPS = [
  { status: 'dispatched', label: 'Despachada' },
  { status: 'in_transit', label: 'En camino' },
  { status: 'arrived', label: 'Llegó' },
]

const LOCATION_TIMEOUT_MS = 8000

// Wrapped with our own timeout on top of the native `timeout` option — some
// browsers never invoke either callback while a permission prompt is stuck
// (silently denied at the OS level, tab backgrounded, etc), and an emergency
// flow can never be allowed to hang forever waiting on the location API.
function getCurrentPosition() {
  const native = new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) { reject(new Error('no-geolocation')); return }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      err => reject(err),
      { enableHighAccuracy: true, timeout: LOCATION_TIMEOUT_MS, maximumAge: 0 },
    )
  })
  let timeoutId
  const hardTimeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('location-timeout')), LOCATION_TIMEOUT_MS)
  })
  return Promise.race([native, hardTimeout]).finally(() => clearTimeout(timeoutId))
}

function formatElapsed(totalSeconds) {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// Pantalla honesta de "no se puede seguir" — misma estética para las dos
// razones por las que el flujo se corta antes de despachar: nadie elegible
// ahora mismo (`noProfessional`) o el servicio deshabilitado desde
// /super-admin/verticales (`unavailable`). Sin cola ni reintento automático en
// ninguno de los dos casos — se le avisa al paciente y decide él.
function SosBlockedScreen({ title, body, onBack }) {
  return (
    <div className="absolute inset-0 bg-white z-[100] flex flex-col items-center justify-center p-6 animate-fade-in">
      <div className="w-16 h-16 rounded-full bg-amber-50 flex items-center justify-center mb-4">
        <Warning className="w-8 h-8 text-amber-600" />
      </div>
      <h2 className="text-[22px] font-light text-gray-900 mb-2 text-center">{title}</h2>
      <p className="text-gray-500 font-medium text-[15px] text-center mb-3 max-w-xs">{body}</p>
      <a
        href={`tel:${SAME_PHONE}`}
        className="flex items-center gap-2 text-danger font-semibold text-[15px] mb-8"
      >
        <PhoneCall className="w-5 h-5" /> Si es riesgo de vida, llamá al {SAME_PHONE} (SAME)
      </a>
      <button onClick={onBack} className="btn-primary px-8 py-3">
        Volver al inicio
      </button>
    </div>
  )
}

export default function Emergency({ profile }) {
  const navigate = useNavigate()

  // phase: 'loading' | 'triage' | 'confirm' | 'dispatching' | 'noProfessional' | 'unavailable' | 'tracking' | 'closing'
  const [phase, setPhase] = useState('loading')

  // ── Triage ──────────────────────────────────────────────────────────────
  // Flat, ungrouped list for the selection screen — severity is still computed
  // exactly as before (rojo > amarillo > verde wins), it's just not shown
  // until the confirm screen. Fixed order preserved from the catalog so the
  // patient always sees the same sequence.
  const [selectedSymptoms, setSelectedSymptoms] = useState([])
  const allSymptoms = useMemo(
    () => TRIAGE_SEVERITY_ORDER.flatMap(code => EMERGENCY_SYMPTOMS[code].items),
    [],
  )
  const triageCode = useMemo(() => computeTriageCode(selectedSymptoms), [selectedSymptoms])

  // ── Payment method — capturing it here is only the method for the eventual
  // charge, which happens after the service ends (see the honest "no se cobra
  // ahora" copy on the confirm screen). No charging logic lives in this file. ─
  const [defaultCard, setDefaultCard] = useState(null)
  const [cardLoading, setCardLoading] = useState(true)
  const [showAddCard, setShowAddCard] = useState(false)
  const [mpPublicKey, setMpPublicKey] = useState(null)

  // ── SOS settings — precio y disponibilidad, /super-admin/verticales ─────
  const [sosSettings, setSosSettings] = useState(null)

  // ── Dispatch / tracking ──────────────────────────────────────────────────
  const [emergency, setEmergency] = useState(null) // camelCased emergencies row, incl. .professional
  const [locationWarning, setLocationWarning] = useState(false)
  const [elapsedSec, setElapsedSec] = useState(0)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)
  const [cancelling, setCancelling] = useState(false)

  // ── Dónde está el profesional, en vivo ──────────────────────────────────
  // Se dibuja SÓLO si el dato es real y reciente. Antes de esto la app mobile
  // interpolaba un punto inventado; acá nunca hubo nada. Si no hay posición
  // fresca, se dice — no se muestra un marcador quieto que parece en vivo.
  const [tracking, setTracking] = useState(null)
  const [trackingRoute, setTrackingRoute] = useState(null)
  const [, redibujar] = useState(0)
  const ultimaRutaRef = useRef('')

  // ── Resume check on mount — a dispatched/in_transit/arrived row must send
  // the patient straight back into tracking, per the State Resilience rule.
  // Se pide junto con la config de S.O.S.: una emergencia activa manda por
  // encima del toggle de disponibilidad — si ya está en curso, se sigue
  // acompañando aunque el servicio se haya deshabilitado después. ──────────
  useEffect(() => {
    if (!profile?.id) return
    let cancelled = false
    Promise.all([
      emergencyService.getActiveForPatient(profile.id),
      getSosSettings(),
    ])
      .then(([active, settings]) => {
        if (cancelled) return
        setSosSettings(settings)
        if (active) {
          setEmergency(active)
          setPhase('tracking')
        } else if (!settings.enabled) {
          setPhase('unavailable')
        } else {
          setPhase('triage')
        }
      })
      .catch(() => { if (!cancelled) setPhase('triage') })
    return () => { cancelled = true }
  }, [profile?.id])

  // Saved card — capture only, the charge happens after the service ends.
  // getMyCards() orders by created_at desc, so [0] is always the most recent
  // — reused after a successful add-card so the just-saved card is selected.
  const loadDefaultCard = useCallback(() => {
    setCardLoading(true)
    return mpService.getMyCards()
      .then(({ data }) => setDefaultCard(data?.[0] ?? null))
      .catch(() => setDefaultCard(null))
      .finally(() => setCardLoading(false))
  }, [])

  useEffect(() => { loadDefaultCard() }, [loadDefaultCard])

  // MP public key — needed to mount the CardPayment brick (see MPCardHolder).
  useEffect(() => {
    mpService.getPaymentPlatformConfig()
      .then(({ data }) => setMpPublicKey(data?.publicKey ?? null))
      .catch(() => setMpPublicKey(null))
  }, [])

  const handleCardSaved = () => {
    setShowAddCard(false)
    toast.success('Tarjeta guardada')
    loadDefaultCard()
  }

  // Realtime updates while tracking — the only source of truth for status.
  useEffect(() => {
    if (phase !== 'tracking' || !emergency?.id) return
    const cleanup = emergencyService.subscribeForPatient(emergency.id, updated => {
      setEmergency(prev => (prev ? { ...prev, ...updated } : updated))
      if (updated.status === 'completed') {
        setPhase('closing')
        setTimeout(() => navigate('/paciente/dashboard'), 2500)
      } else if (updated.status === 'cancelled') {
        toast.info('La emergencia fue cancelada')
        navigate('/paciente/dashboard')
      }
    })
    return cleanup
  }, [phase, emergency?.id, navigate])

  // Posición del profesional — carga inicial + realtime sobre `emergency_tracking`.
  useEffect(() => {
    if (phase !== 'tracking' || !emergency?.id) return
    emergencyTrackingService.getByEmergency(emergency.id).then(setTracking).catch(() => {})
    return emergencyTrackingService.suscribir(emergency.id, ({ evento, tracking: t }) => {
      setTracking(evento === 'DELETE' ? null : t)
    })
  }, [phase, emergency?.id])

  // La frescura se vuelve falsa por el paso del tiempo, no por un evento: si el
  // profesional pierde señal no llega nada, así que hay que revisarlo solo.
  useEffect(() => {
    if (phase !== 'tracking') return
    const iv = setInterval(() => redibujar(n => n + 1), 20_000)
    return () => clearInterval(iv)
  }, [phase])

  // Ruta real entre el profesional y el paciente. Sin ruta no se dibuja línea.
  useEffect(() => {
    if (!tracking || !esReciente(tracking)) return
    const desde = { lat: Number(tracking.latitude), lng: Number(tracking.longitude) }
    const hasta = (emergency?.patientLatitude != null && emergency?.patientLongitude != null)
      ? { lat: Number(emergency.patientLatitude), lng: Number(emergency.patientLongitude) }
      : null
    if (!hasta) return
    const clave = `${desde.lat.toFixed(4)},${desde.lng.toFixed(4)}`
    if (clave === ultimaRutaRef.current) return
    ultimaRutaRef.current = clave
    const ctrl = new AbortController()
    getRoute(desde, hasta, tracking.travelMode ?? 'driving', ctrl.signal)
      .then(r => { if (r) setTrackingRoute(r) })
      .catch(() => {/* sin ruta se muestran igual los dos marcadores */})
    return () => ctrl.abort()
  }, [tracking, emergency?.patientLatitude, emergency?.patientLongitude])

  // Elapsed time since dispatch — honest, ticks every second, never a fake ETA countdown.
  useEffect(() => {
    if (phase !== 'tracking' || !emergency?.createdAt) return
    const createdMs = new Date(emergency.createdAt).getTime()
    const tick = () => setElapsedSec(Math.max(0, Math.floor((Date.now() - createdMs) / 1000)))
    tick()
    const iv = setInterval(tick, 1000)
    return () => clearInterval(iv)
  }, [phase, emergency?.createdAt])

  const toggleSymptom = id => {
    setSelectedSymptoms(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id])
  }

  const handleConfirmSOS = async () => {
    if (!triageCode || phase === 'dispatching') return
    setPhase('dispatching')
    setLocationWarning(false)

    let coords = null
    try {
      coords = await getCurrentPosition()
    } catch {
      setLocationWarning(true)
    }

    try {
      const result = await emergencyService.create({
        patientId: profile.id,
        triageCode,
        symptoms: symptomLabelsFromIds(selectedSymptoms),
        latitude: coords?.lat ?? null,
        longitude: coords?.lng ?? null,
        priceAtRequest: sosSettings?.price ?? SOS_FALLBACK.price,
        paymentMethodId: defaultCard?.id ?? null,
      })

      if (result?.noProfessional) {
        setPhase('noProfessional')
        return
      }

      setEmergency(result)
      setPhase('tracking')
    } catch {
      toast.error('No pudimos solicitar el SOS. Intentá de nuevo.')
      setPhase('confirm')
    }
  }

  const handleCancel = async () => {
    if (!emergency?.id) return
    setCancelling(true)
    try {
      await emergencyService.cancel(emergency.id)
      toast.info('Emergencia cancelada')
      navigate('/paciente/dashboard')
    } catch {
      toast.error('No pudimos cancelar. Intentá de nuevo.')
      setCancelling(false)
      setShowCancelConfirm(false)
    }
  }

  // ── Loading — resuming state, keep it invisible/instant ──────────────────
  if (phase === 'loading') {
    return (
      <div className="absolute inset-0 bg-bg-primary flex items-center justify-center">
        <CircleNotch className="w-8 h-8 text-brand animate-spin" />
      </div>
    )
  }

  // ── Closing — brief honest confirmation before returning home ────────────
  if (phase === 'closing') {
    return (
      <div className="absolute inset-0 bg-white z-[100] flex flex-col items-center justify-center p-6 animate-fade-in">
        <div className="w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center mb-4">
          <CheckCircle className="w-8 h-8 text-emerald-600" weight="fill" />
        </div>
        <h2 className="text-[22px] font-light text-gray-900 mb-2 text-center">Atención finalizada</h2>
        <p className="text-gray-500 font-medium text-[15px] text-center">Te llevamos al inicio…</p>
      </div>
    )
  }

  // ── No professional available — honest, no queue, no auto-retry ──────────
  if (phase === 'noProfessional') {
    return (
      <SosBlockedScreen
        title="No hay profesionales disponibles en este momento"
        body="Por ahora no encontramos a nadie para atenderte por esta vía."
        onBack={() => navigate('/paciente/dashboard')}
      />
    )
  }

  // ── Servicio deshabilitado desde /super-admin/verticales — honesto, sin
  // insistir con reintentos, misma estética que "no hay profesionales" ───────
  if (phase === 'unavailable') {
    return (
      <SosBlockedScreen
        title="El servicio de S.O.S. no está disponible en este momento"
        body="Estamos ajustando la disponibilidad. Probá de nuevo más tarde."
        onBack={() => navigate('/paciente/dashboard')}
      />
    )
  }

  // ── Tracking — driven only by the real DB row + realtime updates ─────────
  if (phase === 'tracking' && emergency) {
    const triage = EMERGENCY_SYMPTOMS[emergency.triageCode] ?? null
    const currentStepIndex = TRACKING_STEPS.findIndex(s => s.status === emergency.status)
    const patientCoords = (emergency.patientLatitude != null && emergency.patientLongitude != null)
      ? { lat: emergency.patientLatitude, lng: emergency.patientLongitude }
      : null
    const proName = emergency.professional?.fullName || 'Profesional asignado'

    const proEnVivo = esReciente(tracking)
    const proCoords = proEnVivo
      ? { lat: Number(tracking.latitude), lng: Number(tracking.longitude) }
      : null
    const etaMin = tracking?.etaMinutes ?? trackingRoute?.durationMin ?? null
    const distanciaM = tracking?.distanceMeters ?? trackingRoute?.distanceMeters ?? null

    return (
      <div className="absolute inset-0 flex flex-col">
        <InteractiveMap
          appState="emergency_matched"
          sheetState="collapsed"
          verticales={[]}
          onMarkerClick={() => {}}
          userLocation={patientCoords}
          emergencyPro={proCoords}
          emergencyRoute={proEnVivo ? trackingRoute?.coordinates ?? null : null}
          emergencyColor={triage?.color ?? '#dc2626'}
        />

        {/* Below PatientSheet's z-[80] on purpose — the "Cancelar S.O.S" confirm
            modal it opens must render above this panel, not behind it. */}
        <div className="absolute inset-0 z-10 flex flex-col justify-end sm:justify-start pointer-events-none animate-fade-in">
          <div className="w-full sm:w-[380px] bg-white rounded-t-[40px] sm:rounded-[28px] p-7 flex flex-col shadow-[0_-15px_40px_rgba(0,0,0,0.2)] sm:shadow-[0_8px_40px_rgba(0,0,0,0.15)] border-t sm:border border-gray-100 pointer-events-auto animate-slide-up-spring sm:absolute sm:left-4 sm:bottom-4">
            <div className="w-14 h-1.5 bg-gray-200 rounded-full mx-auto mb-5 sm:hidden" />

            <div className="flex items-center justify-between mb-4">
              <div className={`px-3 py-1.5 rounded-full text-[11px] font-semibold tracking-widest uppercase inline-flex items-center gap-2 border ${triage?.badgeClass ?? 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                <span className={`w-2 h-2 rounded-full animate-pulse ${triage?.dotClass ?? 'bg-gray-400'}`} /> {emergency.triageCode ?? '—'}
              </div>
              <span className="text-[13px] font-medium text-gray-400">{emergency.dispatchCode ?? '—'}</span>
            </div>

            {/* Status timeline — real DB status, no fake ETA */}
            <div className="flex items-center gap-1 mb-5">
              {TRACKING_STEPS.map((step, i) => {
                const reached = currentStepIndex >= i
                return (
                  <div key={step.status} className="flex-1 flex flex-col gap-1.5">
                    <div className={`h-1.5 rounded-full ${reached ? 'bg-brand' : 'bg-gray-150 bg-gray-100'}`} />
                    <span className={`text-[11px] font-semibold text-center ${reached ? 'text-gray-900' : 'text-gray-400'}`}>{step.label}</span>
                  </div>
                )
              })}
            </div>

            <div className="flex justify-between items-end mb-5">
              <div>
                <h2 className="text-[26px] font-light text-gray-900 leading-none mb-1">
                  {emergency.status === 'arrived' ? 'Llegó a tu ubicación' : emergency.status === 'in_transit' ? 'En camino' : 'Emergencia despachada'}
                </h2>
                <p className="text-gray-500 font-medium text-[14px]">Tiempo transcurrido</p>
              </div>
              <p className="font-light text-[34px] text-gray-900 leading-none tabular-nums">{formatElapsed(elapsedSec)}</p>
            </div>

            {/* Dónde está — o por qué no lo sabemos. Las dos cosas se dicen. */}
            {proEnVivo ? (
              <div className="flex items-center gap-3 rounded-[20px] bg-emerald-50 border border-emerald-100 px-4 py-3 mb-4">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                <span className="text-[13px] font-medium text-emerald-700 flex-1">Ubicación en vivo</span>
                {(etaMin != null || distanciaM != null) && (
                  <span className="text-[13px] font-semibold text-emerald-800 tabular-nums">
                    {formatMinutes(etaMin)} · {formatMeters(distanciaM)}
                  </span>
                )}
              </div>
            ) : (
              <div className="rounded-[20px] bg-gray-50 border border-gray-100 px-4 py-3 mb-4">
                <span className="text-[13px] text-gray-500 leading-snug">
                  {tracking
                    ? `Perdimos la señal hace más de ${FRESCURA_MINUTOS} min. ${proName} sigue a cargo de tu emergencia.`
                    : `${proName} ya tiene tu emergencia. En cuanto salga vas a ver dónde está.`}
                </span>
              </div>
            )}

            <div className="bg-bg-primary rounded-[24px] p-5 mb-5 border border-gray-100 shadow-sm">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 bg-white rounded-[16px] flex items-center justify-center border border-gray-200 shadow-sm overflow-hidden shrink-0">
                  {emergency.professional?.avatarUrl
                    ? <img src={emergency.professional.avatarUrl} alt={proName} className="w-full h-full object-cover" />
                    : <User className="w-6 h-6 text-gray-400" />
                  }
                </div>
                <div className="min-w-0">
                  <h4 className="font-semibold text-[17px] text-gray-900 leading-tight truncate">{proName}</h4>
                  <p className="text-gray-500 text-[13px] font-medium mt-0.5">Profesional asignado</p>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              {emergency.professional?.phone ? (
                <a
                  href={`tel:${emergency.professional.phone}`}
                  className="w-full bg-gray-900 text-white py-4 rounded-[24px] font-semibold text-[16px] shadow-[0_10px_30px_rgba(0,0,0,0.2)] flex justify-center items-center gap-3 hover:bg-black active:scale-95 transition-transform"
                >
                  <Phone className="h-5 w-5" /> Llamar
                </a>
              ) : (
                <div className="w-full bg-gray-50 text-gray-400 py-4 rounded-[24px] font-medium text-[14px] text-center">
                  El profesional todavía no cargó un teléfono de contacto
                </div>
              )}
              <button
                onClick={() => setShowCancelConfirm(true)}
                className="w-full py-3.5 rounded-[20px] font-semibold text-danger hover:bg-danger/5 transition-colors"
              >
                Cancelar S.O.S
              </button>
            </div>
          </div>
        </div>

        <PatientSheet open={showCancelConfirm} onClose={() => setShowCancelConfirm(false)} maxWidth="max-w-md">
          <div className="px-6 pt-2 pb-8">
            <h2 className="text-[20px] font-light text-gray-900 mb-2 text-center leading-tight">¿Cancelar la emergencia?</h2>
            <p className="text-gray-500 text-[14px] text-center mb-7 leading-snug">
              El profesional asignado va a dejar de estar en camino hacia vos.
            </p>
            <div className="flex flex-col gap-3">
              <button onClick={handleCancel} disabled={cancelling} className="btn-danger w-full py-4 text-[15px]">
                {cancelling ? 'Cancelando…' : 'Sí, cancelar'}
              </button>
              <button onClick={() => setShowCancelConfirm(false)} className="btn-secondary w-full py-4 text-[15px]">
                Seguir esperando
              </button>
            </div>
          </div>
        </PatientSheet>
      </div>
    )
  }

  // ── Confirm — real price, honest "not charged yet" copy, real geolocation ─
  if (phase === 'confirm' || phase === 'dispatching') {
    const triage = triageCode ? EMERGENCY_SYMPTOMS[triageCode] : null
    return (
      <>
      <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm z-50 flex flex-col justify-end sm:items-center sm:justify-center animate-fade-in">
        <div className="absolute top-4 left-4 sm:top-6 sm:left-6 z-[60]">
          <button onClick={() => setPhase('triage')} className="w-12 h-12 bg-white rounded-full flex items-center justify-center hover:bg-gray-50 shadow-sm">
            <ArrowLeft className="h-6 w-6 text-gray-900" />
          </button>
        </div>
        <div className="w-full sm:max-w-lg bg-white rounded-t-[40px] sm:rounded-[28px] shadow-[0_-20px_50px_rgba(0,0,0,0.2)] sm:shadow-2xl pb-10 pt-4 animate-slide-up-spring relative overflow-hidden border-t sm:border border-gray-100">
          <div className="p-8 relative z-10">
            <div className="w-14 h-1.5 bg-gray-200 rounded-full mx-auto mb-8 sm:hidden" />
            <div className="flex items-center gap-4 mb-7">
              <div className="w-16 h-16 rounded-[20px] bg-danger/10 flex items-center justify-center border border-danger/20 shadow-sm">
                <Warning className="h-8 w-8 text-danger" />
              </div>
              <div>
                <h2 className="text-[28px] font-light tracking-tight leading-none mb-1 text-gray-900">Confirmar S.O.S</h2>
                {/* Triage code — computed from the flat selection, shown here for the
                    first time (the triage screen itself no longer reveals it). */}
                {triage && (
                  <div className={`mt-1 px-3 py-1 rounded-full text-[11px] font-semibold tracking-widest uppercase inline-flex items-center gap-2 border w-fit ${triage.badgeClass}`}>
                    <span className={`w-2 h-2 rounded-full ${triage.dotClass}`} /> {triage.label}
                  </div>
                )}
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-6 flex items-start gap-3">
              <Warning className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-[13px] text-amber-700 leading-snug">
                El costo del servicio es ${sosSettings?.price ?? SOS_FALLBACK.price}. <span className="font-semibold">No se cobra ahora</span> — se abona al finalizar la atención.
              </p>
            </div>

            {locationWarning && (
              <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4 mb-6 flex items-start gap-3">
                <MapPinLine className="w-5 h-5 text-gray-500 shrink-0 mt-0.5" />
                <p className="text-[13px] text-gray-600 leading-snug">
                  No pudimos acceder a tu ubicación — el profesional va a necesitar que se la compartas por otro medio.
                </p>
              </div>
            )}

            <div className="mb-7 px-1">
              <h4 className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-3">Método de pago</h4>
              <div className="flex items-center justify-between bg-gray-50 p-4 rounded-[20px] border border-gray-100">
                {cardLoading ? (
                  <span className="text-[14px] font-medium text-gray-400">Cargando método de pago…</span>
                ) : defaultCard ? (
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-7 rounded bg-white border border-gray-200 flex items-center justify-center text-[9px] text-gray-700 font-semibold tracking-wide">
                      {brandLabel(defaultCard.cardBrand).slice(0, 5).toUpperCase()}
                    </div>
                    <span className="font-semibold text-[16px] text-gray-800">•••• {defaultCard.lastFour ?? '????'}</span>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowAddCard(true)}
                    className="text-[14px] font-semibold text-brand underline underline-offset-2"
                  >
                    No tenés una tarjeta guardada — añadir una
                  </button>
                )}
              </div>
              {/* Secondary path when a card already exists — this only captures the
                  method, it's never charged here (see the amber notice above). */}
              {!cardLoading && defaultCard && (
                <button
                  onClick={() => setShowAddCard(true)}
                  className="mt-2 text-[13px] font-semibold text-gray-500 underline underline-offset-2"
                >
                  Añadir otra tarjeta
                </button>
              )}
            </div>

            <button
              onClick={handleConfirmSOS}
              disabled={phase === 'dispatching'}
              className={`w-full py-5 rounded-[24px] font-semibold text-[18px] transition-all flex justify-center items-center gap-3 tracking-wide
                ${phase === 'dispatching' ? 'bg-gray-200 text-gray-500' : 'bg-danger text-white shadow-[0_8px_25px_rgba(217,83,79,0.3)] hover:bg-danger-hover active:scale-95'}`}
            >
              {phase === 'dispatching'
                ? <><CircleNotch className="w-6 h-6 animate-spin" /> Buscando profesional…</>
                : <>SOLICITAR S.O.S (${sosSettings?.price ?? SOS_FALLBACK.price})</>
              }
            </button>
          </div>
        </div>
      </div>

      {/* Añadir tarjeta — mismo Brick que usa Perfil (MPCardHolder), reutilizado
          tal cual: sólo captura el método de pago, nunca cobra acá. PatientSheet
          es `fixed z-[80]`, así que siempre queda arriba del backdrop `z-50` de
          esta pantalla de confirmación (mismo criterio que la hoja de cancelar
          en la pantalla de tracking, más abajo en este archivo). */}
      <PatientSheet open={showAddCard} onClose={() => setShowAddCard(false)} maxWidth="max-w-md">
        <div className="px-6 pt-4 pb-4 flex justify-between items-center flex-shrink-0 border-b border-gray-100">
          <button onClick={() => setShowAddCard(false)} className="w-10 h-10 bg-white border border-gray-100 shadow-sm rounded-full flex items-center justify-center hover:bg-bg-primary">
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <p className="font-semibold text-[15px] text-gray-900">Añadir tarjeta</p>
          <div className="w-10" />
        </div>
        <div className="overflow-y-auto scrollbar-hide flex-1 p-6 pb-8 bg-bg-primary">
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
            {mpPublicKey ? (
              <MPCardHolder
                publicKey={mpPublicKey}
                mode="save"
                payerEmail={profile?.email ?? ''}
                submitLabel="Guardar tarjeta"
                onSuccess={handleCardSaved}
                onError={err => toast.error(err || 'No pudimos guardar la tarjeta.')}
              />
            ) : (
              <p className="text-sm text-gray-500 text-center py-6">
                Guardar tarjetas no está disponible en este momento. Probá de nuevo más tarde.
              </p>
            )}
          </div>
          <p className="text-[12px] text-gray-400 text-center mt-4 px-4">
            Los datos de tu tarjeta se procesan directamente con Mercado Pago. Healthier solo guarda la marca y los últimos 4 dígitos.
          </p>
        </div>
      </PatientSheet>
      </>
    )
  }

  // ── Triage — symptom checklist, honest 107/SAME note ─────────────────────
  return (
    <div className="absolute inset-0 bg-bg-primary flex flex-col animate-fade-in">
      <div className="flex items-center gap-3 px-4 pt-6 pb-4 sm:px-6 sm:pt-8 flex-shrink-0">
        <button
          onClick={() => navigate('/paciente/dashboard')}
          className="w-11 h-11 bg-white border border-gray-100 rounded-full flex items-center justify-center shadow-sm hover:bg-gray-50 shrink-0"
        >
          <ArrowLeft className="h-5 w-5 text-gray-900" />
        </button>
        <div>
          <h1 className="text-[20px] sm:text-[22px] font-light tracking-tight text-gray-900 leading-none">Emergencia S.O.S</h1>
          <p className="text-[13px] text-gray-500 font-medium mt-1">Contanos qué te está pasando</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 sm:px-6 pb-32">
        <div className="w-full sm:max-w-lg mx-auto">
          <div className="flex items-start gap-3 mb-5 p-4 bg-danger/5 border border-danger/20 rounded-2xl">
            <PhoneCall className="w-5 h-5 text-danger shrink-0 mt-0.5" />
            <p className="text-[13px] text-gray-700 leading-snug">
              <span className="font-semibold">Si hay riesgo de vida, llamá directamente al {SAME_PHONE} (SAME Buenos Aires).</span> Este flujo conecta con un profesional de Healthier, no reemplaza a una ambulancia de urgencias.
            </p>
          </div>

          {/* Sin encabezados de grupo, sin colores de severidad y sin badge en
              vivo — Mateo pidió que el triage no se le muestre al paciente
              mientras elige (feedback 2026-08-03). El orden interno del
              catálogo se mantiene (rojo → amarillo → verde) para que el mapeo
              a `computeTriageCode` siga siendo el mismo, pero acá no se ve.
              El código sí se calcula igual y aparece recién en "Confirmar
              S.O.S". */}
          <div className="space-y-2.5">
            {allSymptoms.map(item => {
              const checked = selectedSymptoms.includes(item.id)
              return (
                <label
                  key={item.id}
                  className={`flex items-center gap-4 py-4 px-4 rounded-2xl border cursor-pointer transition-colors ${checked ? 'bg-white border-gray-200 shadow-sm' : 'bg-transparent border-gray-100 hover:bg-white/60'}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleSymptom(item.id)}
                    className="sr-only"
                  />
                  <span className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center shrink-0 transition-colors ${checked ? 'border-gray-900 bg-gray-900' : 'border-gray-300 bg-white'}`}>
                    {checked && <Check className="w-4 h-4 text-white" weight="bold" />}
                  </span>
                  <span className="text-[15px] font-medium text-gray-800">{item.label}</span>
                </label>
              )
            })}
          </div>
        </div>
      </div>

      <div className="flex-shrink-0 p-4 sm:p-6 bg-gradient-to-t from-bg-primary via-bg-primary/95 to-transparent">
        <div className="w-full sm:max-w-lg mx-auto">
          <button
            onClick={() => setPhase('confirm')}
            disabled={!triageCode}
            className={`w-full py-5 rounded-[24px] font-semibold text-[17px] flex justify-center items-center gap-2 transition-all
              ${triageCode ? 'bg-danger text-white shadow-[0_8px_25px_rgba(217,83,79,0.3)] hover:bg-danger-hover active:scale-95' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}
          >
            Continuar
          </button>
        </div>
      </div>
    </div>
  )
}
