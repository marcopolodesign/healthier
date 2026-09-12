import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Warning, CircleNotch, Check, Phone,
  User, CheckCircle, PhoneCall, MapPinLine, Ambulance, ShieldCheck,
} from '@phosphor-icons/react'
import { emergencyService, getSosSettings, SOS_FALLBACK } from '../../services/emergencyService'
import { emergencyTrackingService, esReciente, FRESCURA_MINUTOS } from '../../services/emergencyTrackingService'
import { getRoute, formatMeters, formatMinutes } from '../../lib/directions'
import { mpService } from '../../services/mpService'
import InteractiveMap from '../../components/patient/InteractiveMap'
import PatientSheet from '../../components/patient/PatientSheet'
import SavedCardSelector from '../../components/payment/SavedCardSelector'
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

/**
 * A qué pantalla corresponde cada fila. Es lo único que decide dónde cae el
 * paciente al entrar o al recargar: el estado de la base manda sobre
 * cualquier cosa que tenga el componente en memoria.
 *
 * `pending` no alcanza para decidir solo. Entre la reserva en la tarjeta y el
 * triage la fila sigue en `pending`, y si el paciente recarga justo ahí,
 * mandarlo de vuelta a pagar le muestra un error de "ya está paga" por algo
 * que hizo bien. `paid_at` es lo que distingue los dos momentos.
 */
function pantallaPara(emergencia) {
  switch (emergencia.status) {
    case 'pending':           return emergencia.paidAt ? 'triage' : 'pago'
    case 'awaiting_dispatch': return 'esperando'
    case 'dispatched':
    case 'in_transit':
    case 'arrived':           return 'tracking'
    default:                  return 'pago'
  }
}

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

  /*
   * El orden lo fijó la reunión del 2026-09-11: primero el cobro, después el
   * triage, después la entidad que despacha, y recién ahí la ambulancia.
   *
   *   pago → triage → esperando → tracking
   *
   * Antes era triage → confirmar, y en ese "confirmar" el sistema sorteaba un
   * profesional al azar y lo despachaba. No había cobro, ni entidad, ni
   * operador: la ambulancia era una palabra del copy.
   *
   * phase: 'loading' | 'pago' | 'triage' | 'esperando' | 'tracking' | 'closing' | 'unavailable'
   */
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

  // ── El cobro ────────────────────────────────────────────────────────────
  // Es una PREAUTORIZACIÓN: se reserva el monto en la tarjeta y se captura
  // recién cuando el traslado termina (mp-capture action=capture-emergency).
  // Cobrarle de una a alguien que está pidiendo una ambulancia, y devolverle
  // después si no sale, es peor que reservar.
  const [mpPublicKey, setMpPublicKey] = useState(null)
  const [selectedCardId, setSelectedCardId] = useState(null)
  const [agregandoTarjeta, setAgregandoTarjeta] = useState(false)
  const [pagando, setPagando] = useState(false)
  const [errorPago, setErrorPago] = useState('')
  const cardSelectorRef = useRef(null)

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
          // Una emergencia ya abierta manda por encima del toggle de
          // disponibilidad: si está en curso se sigue acompañando aunque el
          // servicio se haya deshabilitado después.
          setEmergency(active)
          setPhase(pantallaPara(active))
        } else if (!settings.enabled) {
          setPhase('unavailable')
        } else {
          setPhase('pago')
        }
      })
      .catch(() => { if (!cancelled) setPhase('pago') })
    return () => { cancelled = true }
  }, [profile?.id])

  // MP public key — needed to mount the CardPayment brick (see MPCardHolder).
  useEffect(() => {
    mpService.getPaymentPlatformConfig()
      .then(({ data }) => setMpPublicKey(data?.publicKey ?? null))
      .catch(() => setMpPublicKey(null))
  }, [])

  // Realtime updates while tracking — the only source of truth for status.
  useEffect(() => {
    if (!emergency?.id || (phase !== 'tracking' && phase !== 'esperando')) return
    const cleanup = emergencyService.subscribeForPatient(emergency.id, updated => {
      setEmergency(prev => (prev ? { ...prev, ...updated } : updated))
      // Es el evento que el paciente está esperando en la pantalla de espera:
      // el operador le asignó un móvil.
      if (updated.status === 'dispatched') {
        setPhase('tracking')
        /*
         * El payload de realtime es la FILA CRUDA: trae `ambulance_id` y
         * `provider_id`, no el móvil ni la entidad. Sin este refetch la
         * pantalla decía "Ambulancia asignada / En camino hacia vos" sin la
         * patente, sin el nombre de la entidad y sin el teléfono de guardia
         * —o sea, sin el botón de llamar a despacho, que es lo único que el
         * paciente puede hacer mientras espera.
         */
        emergencyService.getActiveForPatient(profile.id)
          .then(completa => { if (completa?.id === updated.id) setEmergency(completa) })
          .catch(() => {/* el estado ya cambió; esto sólo suma los nombres */})
      }
      if (updated.status === 'completed') {
        setPhase('closing')
        setTimeout(() => navigate('/paciente/dashboard'), 2500)
      } else if (updated.status === 'cancelled') {
        toast.info('La emergencia fue cancelada')
        navigate('/paciente/dashboard')
      }
    })
    return cleanup
  }, [phase, emergency?.id, profile?.id, navigate])

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
      .then(r => { if (r) setTrackingRoute(r); else ultimaRutaRef.current = '' })
      .catch(e => {
        // Se libera el freno para que la próxima posición vuelva a intentar:
        // un solo pedido fallido dejaba la pantalla sin ruta para siempre.
        if (e?.name !== 'AbortError') ultimaRutaRef.current = ''
      })
    return () => ctrl.abort()
  }, [tracking, emergency?.patientLatitude, emergency?.patientLongitude])

  // Elapsed time since dispatch — honest, ticks every second, never a fake ETA countdown.
  useEffect(() => {
    if (!emergency?.createdAt || (phase !== 'tracking' && phase !== 'esperando')) return
    const createdMs = new Date(emergency.createdAt).getTime()
    const tick = () => setElapsedSec(Math.max(0, Math.floor((Date.now() - createdMs) / 1000)))
    tick()
    const iv = setInterval(tick, 1000)
    return () => clearInterval(iv)
  }, [phase, emergency?.createdAt])

  const toggleSymptom = id => {
    setSelectedSymptoms(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id])
  }

  /**
   * Paso 1 y 2 — la solicitud y la reserva en la tarjeta.
   *
   * La fila se escribe ANTES de cobrar, a propósito: si acá se corta la red,
   * `getActiveForPatient()` la encuentra en `pending` y el paciente vuelve a
   * esta misma pantalla. Al revés (cobrar y después escribir) deja una
   * reserva en la tarjeta sin ninguna emergencia que la explique.
   */
  const asegurarSolicitud = useCallback(async () => {
    if (emergency?.id) return emergency

    let coords = null
    try {
      coords = await getCurrentPosition()
    } catch {
      // La ubicación no frena una emergencia. Se avisa y se sigue: el operador
      // se la va a pedir por teléfono.
      setLocationWarning(true)
    }

    const fila = await emergencyService.crearSolicitud({
      patientId: profile.id,
      latitude: coords?.lat ?? null,
      longitude: coords?.lng ?? null,
      priceAtRequest: sosSettings?.price ?? SOS_FALLBACK.price,
    })
    setEmergency(fila)
    return fila
  }, [emergency, profile?.id, sosSettings?.price])

  /** Reserva hecha → al triage. El monto lo puso el servidor, no esta pantalla. */
  const trasReservar = async (resultado, fila) => {
    if (resultado?.error || !resultado?.data?.approved) {
      // El error REAL de Mercado Pago, no uno genérico: es lo único que le
      // permite al paciente entender si tiene que cambiar de tarjeta.
      setErrorPago(resultado?.error || resultado?.data?.statusDetail || 'No pudimos reservar el monto en tu tarjeta.')
      return
    }
    setEmergency(prev => ({ ...(prev ?? fila), paidAt: new Date().toISOString() }))
    setPhase('triage')
  }

  /** Tarjeta guardada — necesita re-tokenizar con el CVV (lo hace el selector). */
  const handlePagar = async () => {
    if (!selectedCardId || pagando) return
    setPagando(true)
    setErrorPago('')
    try {
      const fila = await asegurarSolicitud()
      const chargeInfo = await cardSelectorRef.current?.getSavedCardCharge()
      const resultado = await mpService.createPayment({
        emergencyId: fila.id,
        ...chargeInfo,
        description: 'Servicio de emergencias',
      })
      await trasReservar(resultado, fila)
    } catch (err) {
      setErrorPago(err?.message || 'No pudimos procesar el pago.')
    } finally {
      setPagando(false)
    }
  }

  /** Tarjeta nueva — el Brick tiene su propio botón y ya trae el token. */
  const handleNewCardCharge = async (chargeInfo) => {
    setPagando(true)
    setErrorPago('')
    try {
      const fila = await asegurarSolicitud()
      const resultado = await mpService.createPayment({
        emergencyId: fila.id,
        ...chargeInfo,
        description: 'Servicio de emergencias',
      })
      await trasReservar(resultado, fila)
    } catch (err) {
      setErrorPago(err?.message || 'No pudimos procesar el pago.')
    } finally {
      setPagando(false)
    }
  }

  /** Paso 3 — el triage. Con esto entra a la cola de la entidad. */
  const handleConfirmarTriage = async () => {
    if (!triageCode || !emergency?.id || pagando) return
    setPagando(true)
    try {
      const fila = await emergencyService.confirmarTriage({
        emergencyId: emergency.id,
        triageCode,
        symptoms: symptomLabelsFromIds(selectedSymptoms),
      })
      setEmergency(prev => ({ ...prev, ...fila }))
      setPhase('esperando')
    } catch {
      toast.error('No pudimos enviar tu pedido. Intentá de nuevo.')
    } finally {
      setPagando(false)
    }
  }

  const handleCancel = async () => {
    if (!emergency?.id) return
    setCancelling(true)
    try {
      await emergencyService.cancel(emergency.id)
      // Se libera la reserva de la tarjeta. No es una devolución: nunca se
      // capturó nada, así que el banco suelta la retención solo. Si esto
      // falla, la cancelación igual vale — la barrida de MP la libera sola
      // al vencer — pero queda en el log para poder mirarlo.
      if (emergency.paidAt) {
        const { error } = await mpService.liberarEmergencia(emergency.id)
        if (error) console.error('No se pudo liberar la reserva de la emergencia:', error)
      }
      toast.info('Emergencia cancelada — no se te cobró nada')
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

  // ── Esperando móvil — el estado que faltaba ──────────────────────────────
  // Entre "pagué y conté qué me pasa" y "la ambulancia salió" hay un rato real
  // en el que decide una persona. Antes no existía en la pantalla porque no
  // existía en el flujo: el sistema sorteaba solo y saltaba directo al mapa.
  if (phase === 'esperando' && emergency) {
    const triage = EMERGENCY_SYMPTOMS[emergency.triageCode] ?? null
    return (
      <div className="absolute inset-0 bg-bg-primary flex flex-col items-center justify-center p-6 animate-fade-in">
        <div className="w-full sm:max-w-md flex flex-col items-center">
          <div className="relative flex items-center justify-center mb-7">
            <div className="absolute w-28 h-28 rounded-full bg-danger/10 animate-[ping_2.5s_cubic-bezier(0,0,0.2,1)_infinite]" />
            <div className="w-20 h-20 rounded-full bg-danger flex items-center justify-center shadow-[0_10px_30px_rgba(217,83,79,0.35)] relative">
              <Ambulance className="w-10 h-10 text-white" />
            </div>
          </div>

          {triage && (
            <div className={`px-3 py-1.5 rounded-full text-[11px] font-semibold tracking-widest uppercase inline-flex items-center gap-2 border mb-4 ${triage.badgeClass}`}>
              <span className={`w-2 h-2 rounded-full animate-pulse ${triage.dotClass}`} /> {emergency.triageCode}
            </div>
          )}

          <h2 className="text-[24px] font-light text-gray-900 mb-2 text-center leading-tight">
            Estamos asignando una ambulancia
          </h2>
          <p className="text-gray-500 font-medium text-[15px] text-center mb-6 leading-snug">
            Tu pedido ya está en el despacho. Un operador está eligiendo el móvil
            que llega más rápido hasta donde estás.
          </p>

          <div className="w-full bg-white rounded-[24px] border border-gray-100 shadow-sm p-5 mb-5">
            <div className="flex justify-between items-end">
              <div>
                <p className="text-gray-500 font-medium text-[13px]">Esperando desde hace</p>
                <p className="text-[11px] text-gray-400 mt-1">Te avisamos apenas salga</p>
              </div>
              <p className="font-light text-[32px] text-gray-900 leading-none tabular-nums">{formatElapsed(elapsedSec)}</p>
            </div>
          </div>

          <div className="w-full flex items-start gap-3 rounded-[20px] bg-emerald-50 border border-emerald-100 px-4 py-3 mb-5">
            <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            <p className="text-[13px] text-emerald-800 leading-snug">
              Reservamos ${emergency.priceAtRequest ?? sosSettings?.price ?? SOS_FALLBACK.price} en tu tarjeta.
              Se cobra sólo si la ambulancia sale.
            </p>
          </div>

          <a
            href={`tel:${SAME_PHONE}`}
            className="flex items-center gap-2 text-danger font-semibold text-[15px] mb-6"
          >
            <PhoneCall className="w-5 h-5" /> Si es riesgo de vida, llamá al {SAME_PHONE} (SAME)
          </a>

          <button
            onClick={() => setShowCancelConfirm(true)}
            className="w-full py-3.5 rounded-[20px] font-semibold text-danger hover:bg-danger/5 transition-colors"
          >
            Cancelar pedido
          </button>
        </div>

        <PatientSheet open={showCancelConfirm} onClose={() => setShowCancelConfirm(false)} maxWidth="max-w-md">
          <div className="px-6 pt-2 pb-8">
            <h2 className="text-[20px] font-light text-gray-900 mb-2 text-center leading-tight">¿Cancelar el pedido?</h2>
            <p className="text-gray-500 text-[14px] text-center mb-7 leading-snug">
              Todavía no salió ningún móvil. Liberamos lo que reservamos en tu tarjeta —
              no se te cobra nada.
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

  // ── Tracking — driven only by the real DB row + realtime updates ─────────
  if (phase === 'tracking' && emergency) {
    const triage = EMERGENCY_SYMPTOMS[emergency.triageCode] ?? null
    const currentStepIndex = TRACKING_STEPS.findIndex(s => s.status === emergency.status)
    const patientCoords = (emergency.patientLatitude != null && emergency.patientLongitude != null)
      ? { lat: emergency.patientLatitude, lng: emergency.patientLongitude }
      : null
    const movil = emergency.ambulancia ?? null
    const entidad = emergency.entidad ?? null
    const nombreMovil = movil?.label || 'La ambulancia'
    // Macarena fue clara en la reunión: el paciente habla con DESPACHO, no con
    // el médico ni con el chofer. El teléfono que se muestra es el de guardia
    // de la entidad; el del profesional queda como último recurso cuando la
    // entidad todavía no cargó el suyo.
    const telefono = entidad?.dispatchPhone || emergency.professional?.phone || null
    const telefonoEsDespacho = Boolean(entidad?.dispatchPhone)

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
                    ? `Perdimos la señal hace más de ${FRESCURA_MINUTOS} min. ${nombreMovil} sigue yendo hacia vos.`
                    : `${nombreMovil} ya salió. En cuanto empiece a reportar vas a ver dónde está.`}
                </span>
              </div>
            )}

            <div className="bg-bg-primary rounded-[24px] p-5 mb-5 border border-gray-100 shadow-sm">
              <div className="flex items-center gap-4">
                <div
                  className="w-14 h-14 rounded-[16px] flex items-center justify-center border shadow-sm shrink-0"
                  style={{
                    backgroundColor: `${entidad?.color ?? '#DC2626'}15`,
                    borderColor: `${entidad?.color ?? '#DC2626'}33`,
                  }}
                >
                  <Ambulance className="w-7 h-7" style={{ color: entidad?.color ?? '#DC2626' }} />
                </div>
                <div className="min-w-0">
                  <h4 className="font-semibold text-[17px] text-gray-900 leading-tight truncate">
                    {movil?.label ?? 'Ambulancia asignada'}
                  </h4>
                  <p className="text-gray-500 text-[13px] font-medium mt-0.5 truncate">
                    {[entidad?.name, movil?.plate].filter(Boolean).join(' · ') || 'En camino hacia vos'}
                  </p>
                </div>
              </div>
              {emergency.professional?.fullName && (
                <div className="flex items-center gap-3 mt-4 pt-4 border-t border-gray-100">
                  <div className="w-9 h-9 bg-white rounded-full flex items-center justify-center border border-gray-200 overflow-hidden shrink-0">
                    {emergency.professional.avatarUrl
                      ? <img src={emergency.professional.avatarUrl} alt="" className="w-full h-full object-cover" />
                      : <User className="w-4 h-4 text-gray-400" />
                    }
                  </div>
                  <p className="text-[13px] text-gray-600 font-medium truncate">
                    Va {emergency.professional.fullName}
                  </p>
                </div>
              )}
            </div>

            <div className="space-y-3">
              {telefono ? (
                <a
                  href={`tel:${telefono}`}
                  className="w-full bg-gray-900 text-white py-4 rounded-[24px] font-semibold text-[16px] shadow-[0_10px_30px_rgba(0,0,0,0.2)] flex justify-center items-center gap-3 hover:bg-black active:scale-95 transition-transform"
                >
                  <Phone className="h-5 w-5" /> {telefonoEsDespacho ? 'Llamar a despacho' : 'Llamar'}
                </a>
              ) : (
                <a
                  href={`tel:${SAME_PHONE}`}
                  className="w-full bg-gray-50 border border-gray-200 text-gray-700 py-4 rounded-[24px] font-semibold text-[15px] flex justify-center items-center gap-3"
                >
                  <PhoneCall className="h-5 w-5 text-danger" /> Si empeora, llamá al {SAME_PHONE}
                </a>
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
              La ambulancia va a dejar de estar en camino hacia vos.
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

  // ── Cobro — PRIMER paso del flujo (reunión 2026-09-11) ───────────────────
  // Es una reserva, no un cobro: `mp-payment` manda `capture:false` y el
  // importe queda retenido hasta que el traslado termina. El monto lo pone el
  // servidor leyendo /super-admin/verticales — acá se muestra, no se manda.
  if (phase === 'pago') {
    const precio = sosSettings?.price ?? SOS_FALLBACK.price
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
            <p className="text-[13px] text-gray-500 font-medium mt-1">Paso 1 de 2 — tu forma de pago</p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 sm:px-6 pb-8">
          <div className="w-full sm:max-w-lg mx-auto">
            <div className="flex items-start gap-3 mb-5 p-4 bg-danger/5 border border-danger/20 rounded-2xl">
              <PhoneCall className="w-5 h-5 text-danger shrink-0 mt-0.5" />
              <p className="text-[13px] text-gray-700 leading-snug">
                <span className="font-semibold">Si hay riesgo de vida, llamá directamente al {SAME_PHONE} (SAME Buenos Aires).</span>{' '}
                El servicio público de emergencias sigue siendo la vía más rápida ante un riesgo inmediato.
              </p>
            </div>

            <div className="bg-white rounded-[24px] border border-gray-100 shadow-sm p-6 mb-5">
              <div className="flex items-center gap-4 mb-5">
                <div className="w-14 h-14 rounded-[18px] bg-danger/10 flex items-center justify-center border border-danger/20 shrink-0">
                  <Ambulance className="h-7 w-7 text-danger" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-semibold text-[17px] text-gray-900 leading-tight">Ambulancia con médico de urgencias</h3>
                  <p className="text-gray-500 text-[13px] font-medium mt-0.5">Va hasta donde estés</p>
                </div>
              </div>
              <div className="flex items-center justify-between pt-4 border-t border-gray-100">
                <span className="text-[15px] font-semibold text-gray-900">Total</span>
                <span className="text-[22px] font-light text-gray-900 tabular-nums">${precio}</span>
              </div>
            </div>

            {/* La frase más importante de la pantalla: lo que pasa con su plata. */}
            <div className="flex items-start gap-3 rounded-[20px] bg-emerald-50 border border-emerald-100 px-4 py-3.5 mb-5">
              <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              <p className="text-[13px] text-emerald-800 leading-snug">
                <span className="font-semibold">Reservamos ${precio} en tu tarjeta, no te lo cobramos todavía.</span>{' '}
                Se cobra sólo si la ambulancia sale. Si cancelás antes, liberamos la reserva.
              </p>
            </div>

            {locationWarning && (
              <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4 mb-5 flex items-start gap-3">
                <MapPinLine className="w-5 h-5 text-gray-500 shrink-0 mt-0.5" />
                <p className="text-[13px] text-gray-600 leading-snug">
                  No pudimos acceder a tu ubicación — el despacho te la va a pedir por teléfono.
                </p>
              </div>
            )}

            {errorPago && (
              <div className="bg-danger/5 border border-danger/20 rounded-2xl p-4 mb-5 flex items-start gap-3">
                <Warning className="w-5 h-5 text-danger shrink-0 mt-0.5" />
                <p className="text-[13px] text-gray-700 leading-snug">{errorPago}</p>
              </div>
            )}

            {mpPublicKey ? (
              <SavedCardSelector
                ref={cardSelectorRef}
                selectedCardId={selectedCardId}
                onCardSelected={setSelectedCardId}
                publicKey={mpPublicKey}
                payerEmail={profile?.email ?? ''}
                amount={precio}
                disabled={pagando}
                onNewCardCharge={handleNewCardCharge}
                onAddCardModeChange={setAgregandoTarjeta}
              />
            ) : (
              <p className="text-sm text-gray-500 text-center py-6">
                No pudimos cargar los medios de pago. Probá de nuevo en unos segundos.
              </p>
            )}
          </div>
        </div>

        {/* Se esconde mientras el Brick de tarjeta nueva está abierto: ese trae
            su propio botón de submit y dos botones confunden. */}
        {!agregandoTarjeta && (
          <div className="flex-shrink-0 p-4 sm:p-6 bg-gradient-to-t from-bg-primary via-bg-primary/95 to-transparent">
            <div className="w-full sm:max-w-lg mx-auto">
              <button
                onClick={handlePagar}
                disabled={!selectedCardId || pagando}
                className={`w-full py-5 rounded-[24px] font-semibold text-[17px] flex justify-center items-center gap-3 transition-all
                  ${selectedCardId && !pagando
                    ? 'bg-danger text-white shadow-[0_8px_25px_rgba(217,83,79,0.3)] hover:bg-danger-hover active:scale-95'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}
              >
                {pagando
                  ? <><CircleNotch className="w-6 h-6 animate-spin" /> Reservando…</>
                  : <>Reservar ${precio} y continuar</>
                }
              </button>
            </div>
          </div>
        )}
      </div>
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
          <p className="text-[13px] text-gray-500 font-medium mt-1">Paso 2 de 2 — contanos qué te está pasando</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 sm:px-6 pb-32">
        <div className="w-full sm:max-w-lg mx-auto">
          <div className="flex items-start gap-3 mb-5 p-4 bg-danger/5 border border-danger/20 rounded-2xl">
            <PhoneCall className="w-5 h-5 text-danger shrink-0 mt-0.5" />
            <p className="text-[13px] text-gray-700 leading-snug">
              <span className="font-semibold">Si hay riesgo de vida, llamá directamente al {SAME_PHONE} (SAME Buenos Aires).</span> Healthier despacha una ambulancia con un médico de urgencias; el servicio público de emergencias sigue siendo la vía más rápida ante un riesgo inmediato.
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
            onClick={handleConfirmarTriage}
            disabled={!triageCode || pagando}
            className={`w-full py-5 rounded-[24px] font-semibold text-[17px] flex justify-center items-center gap-2 transition-all
              ${triageCode && !pagando ? 'bg-danger text-white shadow-[0_8px_25px_rgba(217,83,79,0.3)] hover:bg-danger-hover active:scale-95' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}
          >
            {pagando
              ? <><CircleNotch className="w-6 h-6 animate-spin" /> Enviando…</>
              : <>Pedir la ambulancia</>
            }
          </button>
        </div>
      </div>
    </div>
  )
}
