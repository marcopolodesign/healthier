// TODO (future): WhatsApp push on assignment
// When a patient fires an emergency, the professional should receive a WhatsApp
// message with a deeplink: /profesional/emergencias?id=<emergencia_id>
// See emergencyService.js for full implementation notes.
// The Realtime subscription here only fires if the browser tab is already open.

import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Ambulance, MapPin, NavigationArrow, Phone,
  CheckCircle, ArrowLeft, Warning, Pulse, UserCircle, Broadcast, WifiSlash,
} from '@phosphor-icons/react'
import { emergencyService, EMERGENCY_TERMINAL_STATUSES } from '../../services/emergencyService'
import { emergencyTrackingService } from '../../services/emergencyTrackingService'
import { useCompartirUbicacionEmergencia } from '../../hooks/useCompartirUbicacionEmergencia'
import { formatMeters, formatMinutes } from '../../lib/directions'
import { toast } from '../../components/Toast'

// ── Design tokens per triage code ─────────────────────────────
const CODE = {
  ROJO:     { bg: 'bg-red-50',    border: 'border-red-200',    text: 'text-red-600',    dot: 'bg-red-500',    btnAccept: 'bg-red-600 hover:bg-red-700',    label: 'Código Rojo',     Icon: Warning },
  AMARILLO: { bg: 'bg-amber-50',  border: 'border-amber-200',  text: 'text-amber-600',  dot: 'bg-amber-500',  btnAccept: 'bg-amber-500 hover:bg-amber-600',  label: 'Código Amarillo', Icon: Pulse },
  VERDE:    { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-600', dot: 'bg-emerald-500', btnAccept: 'bg-emerald-600 hover:bg-emerald-700', label: 'Código Verde',    Icon: CheckCircle },
}

// ── Demo fixtures — DEV ONLY. Used when ?demo=<phase> is in the URL.
// Gated behind import.meta.env.DEV below (search params are ignored in
// production builds so this fixture data can never reach a real professional).
// camelCased to match what emergencyService now returns for real rows.
const DEMO = {
  standby: null,
  dispatched: {
    id: 'demo-1', dispatchCode: 'UTM-8842', triageCode: 'ROJO',
    status: 'dispatched', createdAt: new Date(Date.now() - 90_000).toISOString(),
    patientLatitude: -34.5956, patientLongitude: -58.3843,
    patient: { fullName: 'Juan García', phone: '+54 11 4321-0000' },
  },
  in_transit: {
    id: 'demo-2', dispatchCode: 'UTM-8842', triageCode: 'ROJO',
    status: 'in_transit', createdAt: new Date(Date.now() - 300_000).toISOString(),
    patientLatitude: -34.5956, patientLongitude: -58.3843,
    patient: { fullName: 'Juan García', phone: '+54 11 4321-0000' },
  },
  arrived: {
    id: 'demo-3', dispatchCode: 'UTM-8842', triageCode: 'ROJO',
    status: 'arrived', createdAt: new Date(Date.now() - 900_000).toISOString(),
    patientLatitude: -34.5956, patientLongitude: -58.3843,
    patient: { fullName: 'Juan García', phone: null },
  },
}

function elapsed(isoDate) {
  const secs = Math.floor((Date.now() - new Date(isoDate)) / 1000)
  if (secs < 60) return `hace ${secs}s`
  if (secs < 3600) return `hace ${Math.floor(secs / 60)}min`
  return `hace ${Math.floor(secs / 3600)}h`
}

export default function ProfessionalEmergencias({ profile }) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  // ?id=<uuid> — load a specific emergency (deeplink / reconnect)
  const emergenciaId = searchParams.get('id')
  // ?demo=standby|dispatched|in_transit|arrived — inject mock state for previewing.
  // DEV-ONLY: in production builds import.meta.env.DEV is false, so the param
  // is ignored entirely and the real DB path below always runs — no fixture
  // data (fake patient, fake coords, fake dispatch code) can ever reach prod.
  const demoPhase = import.meta.env.DEV ? searchParams.get('demo') : null

  const [emergency, setEmergency] = useState(demoPhase !== null ? DEMO[demoPhase] ?? null : undefined)
  const [loading, setLoading] = useState(demoPhase === null)
  const [updating, setUpdating] = useState(false)
  const [, forceRender] = useState(0)
  const unsubRef = useRef(null)

  // Tick elapsed time every 30s
  useEffect(() => {
    const t = setInterval(() => forceRender(n => n + 1), 30_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    // Demo mode — skip all DB calls
    if (demoPhase !== null) return

    if (!profile?.id) return

    const load = emergenciaId
      ? emergencyService.getById(emergenciaId)
      : emergencyService.getActiveForProfessional(profile.id)

    load
      .then(e => setEmergency(e))
      .catch(() => toast.error('Error al cargar la emergencia'))
      .finally(() => setLoading(false))

    // Realtime only when not pinned to a specific ID
    if (!emergenciaId) {
      unsubRef.current = emergencyService.subscribe(profile.id, (updated) => {
        setEmergency(EMERGENCY_TERMINAL_STATUSES.includes(updated.status) ? null : updated)
        if (updated.status === 'dispatched' && navigator.vibrate) {
          navigator.vibrate([200, 100, 200])
        }
      })
    }
    return () => unsubRef.current?.()
  }, [profile?.id, emergenciaId, demoPhase])

  /*
   * Mientras está en camino, el paciente tiene que poder ver dónde está — es
   * lo único que convierte "un médico va para allá" en algo verificable. Sólo
   * se comparte en `in_transit`: antes de aceptar no hay motivo para tener el
   * GPS abierto, y después de llegar tampoco.
   */
  const destinoPaciente = emergency?.patientLatitude != null && emergency?.patientLongitude != null
    ? { lat: Number(emergency.patientLatitude), lng: Number(emergency.patientLongitude) }
    : null

  const seguimiento = useCompartirUbicacionEmergencia({
    activo: demoPhase === null && emergency?.status === 'in_transit',
    emergencyId: emergency?.id,
    professionalId: profile?.id,
    patientId: emergency?.patientId,
    destino: destinoPaciente,
  })

  // ── Mutations ──────────────────────────────────────────────
  const mutate = async (newStatus, afterFn) => {
    if (!emergency) return
    if (demoPhase !== null) { setEmergency(prev => ({ ...prev, status: newStatus })); return }
    setUpdating(true)
    try {
      await emergencyService.updateStatus(emergency.id, newStatus)
      setEmergency(prev => ({ ...prev, status: newStatus }))
      afterFn?.()
    } catch {
      toast.error('Error al actualizar')
    } finally {
      setUpdating(false)
    }
  }

  const accept       = () => mutate('in_transit')

  const markArrived = () => mutate('arrived', () => {
    // Cierra el traslado con un último dato explícito: llegó. Sin esto el
    // paciente se quedaba con el ETA de la penúltima publicación.
    if (demoPhase !== null || !emergency || !profile?.id || !seguimiento.posicion) return
    emergencyTrackingService.publicar({
      emergencyId: emergency.id,
      professionalId: profile.id,
      patientId: emergency.patientId,
      lat: seguimiento.posicion.lat,
      lng: seguimiento.posicion.lng,
      etaMinutes: 0,
      distanceMeters: 0,
      status: 'llegado',
    }).catch(() => {})
  })

  const closeEmergency = async () => {
    if (demoPhase === null && emergency?.id) {
      await emergencyTrackingService.dejarDeCompartir(emergency.id).catch(() => {})
    }
    await mutate('completed')
    if (demoPhase === null) navigate('/profesional/dashboard')
  }

  // ── Derived ────────────────────────────────────────────────
  const cs          = CODE[emergency?.triageCode] ?? CODE.ROJO
  const patientName = emergency?.patient?.fullName ?? null
  const patientPhone = emergency?.patient?.phone ?? null
  const mapsUrl     = emergency?.patientLatitude
    ? `https://maps.google.com/?q=${emergency.patientLatitude},${emergency.patientLongitude}&navigate=yes`
    : null

  // ── LOADING ────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-bg-primary flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  // ── STANDBY ────────────────────────────────────────────────
  if (!emergency) {
    return (
      <div className="min-h-screen bg-bg-primary flex flex-col">
        <div className="flex items-center gap-3 px-5 pt-12 pb-6 border-b border-border-default">
          <button onClick={() => navigate('/profesional/dashboard')} className="w-10 h-10 rounded-full bg-bg-secondary flex items-center justify-center">
            <ArrowLeft className="w-5 h-5 text-text-primary" />
          </button>
          <h1 className="text-xl font-medium text-text-primary">Emergencias</h1>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 text-center">
          <div className="w-20 h-20 rounded-full bg-emerald-50 flex items-center justify-center">
            <CheckCircle className="w-10 h-10 text-emerald-500" />
          </div>
          <h2 className="font-bold text-2xl text-text-primary">En guardia</h2>
          <p className="text-text-secondary text-base leading-relaxed">
            No hay emergencias activas asignadas. Serás notificado cuando llegue una nueva.
          </p>
          <div className="flex items-center gap-2 mt-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-sm text-emerald-600 font-medium">Escuchando en tiempo real</span>
          </div>
        </div>
      </div>
    )
  }

  // ── INCOMING (dispatched) ──────────────────────────────────
  if (emergency.status === 'dispatched') {
    return (
      <div className="min-h-screen bg-gray-950 flex flex-col">
        <div className={`flex flex-col items-center gap-3 px-5 pt-14 pb-8 ${cs.bg} animate-pulse`}>
          <cs.Icon className={`w-16 h-16 ${cs.text}`} />
          <span className={`text-xs font-black tracking-widest uppercase ${cs.text}`}>Nueva Emergencia Asignada</span>
          <h1 className={`font-black text-5xl ${cs.text}`}>{cs.label}</h1>
        </div>

        <div className="flex-1 flex flex-col gap-4 px-5 py-6">
          <div className="bg-white rounded-3xl p-5 flex flex-col gap-3">
            <Row label="Código"    value={<span className="font-black text-text-primary text-lg tracking-wider">{emergency.dispatchCode}</span>} />
            <Divider />
            {patientName && <Row label="Paciente"  value={patientName} />}
            <Row label="Recibida"  value={elapsed(emergency.createdAt)} />
            {emergency.patientLatitude && (
              <Row label="Ubicación" value={`${Number(emergency.patientLatitude).toFixed(4)}, ${Number(emergency.patientLongitude).toFixed(4)}`} small />
            )}
          </div>

          <div className="mt-auto">
            <Btn loading={updating} onClick={accept} color={cs.btnAccept} icon={<Ambulance className="w-6 h-6" />}>
              Aceptar emergencia
            </Btn>
          </div>
        </div>
      </div>
    )
  }

  // ── EN ROUTE (in_transit) ──────────────────────────────────
  if (emergency.status === 'in_transit') {
    return (
      <div className="min-h-screen bg-bg-primary flex flex-col">
        <div className="bg-gray-950 px-5 pt-12 pb-5 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className={`w-3 h-3 rounded-full ${cs.dot} animate-pulse`} />
            <span className="text-xs font-black tracking-widest text-white uppercase">En camino</span>
          </div>
          <h1 className="text-white font-black text-3xl">{emergency.dispatchCode}</h1>
          <p className={`text-sm font-bold ${cs.text}`}>{cs.label}</p>
        </div>

        <div className="flex-1 flex flex-col gap-4 px-5 py-6">
          {/* Estado del envío de ubicación — honesto: si no se está mandando,
              se dice. El paciente ve exactamente lo mismo del otro lado. */}
          {seguimiento.error ? (
            <div className="flex items-center gap-2.5 rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3">
              <WifiSlash className="w-5 h-5 text-amber-600 shrink-0" />
              <span className="text-sm font-medium text-amber-700">{seguimiento.error}</span>
            </div>
          ) : seguimiento.compartiendo ? (
            <div className="flex items-center gap-2.5 rounded-2xl bg-emerald-50 border border-emerald-200 px-4 py-3">
              <Broadcast className="w-5 h-5 text-emerald-600 shrink-0" weight="fill" />
              <span className="text-sm font-medium text-emerald-700 flex-1">
                El paciente está viendo dónde estás
              </span>
              {seguimiento.ruta && (
                <span className="text-sm font-bold text-emerald-700 shrink-0">
                  {formatMinutes(seguimiento.ruta.durationMin)} · {formatMeters(seguimiento.ruta.distanceMeters)}
                </span>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2.5 rounded-2xl bg-bg-secondary border border-border-default px-4 py-3">
              <Broadcast className="w-5 h-5 text-text-tertiary shrink-0" />
              <span className="text-sm text-text-secondary">Buscando tu ubicación…</span>
            </div>
          )}

          {/* Primary CTA — navigate */}
          {mapsUrl ? (
            <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
              className="w-full bg-gray-950 text-white py-5 rounded-[24px] font-black text-xl flex items-center justify-center gap-3 shadow-lg active:scale-95 transition-transform">
              <NavigationArrow className="w-6 h-6" /> Navegar al paciente
            </a>
          ) : (
            <div className="w-full bg-gray-100 text-text-secondary py-5 rounded-[24px] font-bold text-lg flex items-center justify-center gap-2">
              <MapPin className="w-5 h-5" /> Ubicación no disponible
            </div>
          )}

          {/* Secondary CTA — call patient */}
          {patientPhone ? (
            <a href={`tel:${patientPhone}`}
              className="w-full border-2 border-gray-950 text-gray-950 py-4 rounded-[24px] font-bold text-lg flex items-center justify-center gap-3 active:scale-95 transition-transform">
              <Phone className="w-5 h-5" /> Llamar al paciente
            </a>
          ) : (
            <div className="w-full border-2 border-border-default text-text-tertiary py-4 rounded-[24px] font-bold text-base flex items-center justify-center gap-3 opacity-50 cursor-not-allowed">
              <Phone className="w-5 h-5" /> Llamar al paciente <span className="text-xs font-normal">(número no disponible)</span>
            </div>
          )}

          {/* Patient info */}
          <div className="bg-white rounded-3xl p-5 flex flex-col gap-3 border border-border-default">
            {patientName && <Row label="Paciente"    value={patientName} />}
            <Row label="Código"      value={<span className={`font-black ${cs.text}`}>{cs.label}</span>} />
            <Row label="Despacho"    value={<span className="font-mono">{emergency.dispatchCode}</span>} />
            {emergency.patientLatitude && (
              <Row label="Coordenadas" value={`${Number(emergency.patientLatitude).toFixed(5)}, ${Number(emergency.patientLongitude).toFixed(5)}`} small />
            )}
          </div>

          <div className="mt-auto">
            <Btn loading={updating} onClick={markArrived} color="bg-emerald-600 hover:bg-emerald-700" icon={<CheckCircle className="w-6 h-6" />}>
              Llegué al paciente
            </Btn>
          </div>
        </div>
      </div>
    )
  }

  // ── ARRIVED ────────────────────────────────────────────────
  // Parse the patient's actually-reported symptoms from notes (JSON array set
  // by mobile triage). Never fall back to a generic per-code list as if it
  // were "reported" — that was clinically misleading (shown even when notes
  // was empty). If there's nothing real to show, say so honestly.
  let storedSymptoms = null
  if (emergency.notes) {
    try { storedSymptoms = JSON.parse(emergency.notes) } catch { /* ignore */ }
  }
  const hasReportedSymptoms = Array.isArray(storedSymptoms) && storedSymptoms.length > 0

  return (
    <div className="min-h-screen bg-bg-primary flex flex-col px-6 pt-14 pb-10 gap-6 overflow-y-auto">
      {/* Header */}
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="w-20 h-20 rounded-full bg-emerald-50 flex items-center justify-center">
          <UserCircle className="w-10 h-10 text-emerald-600" />
        </div>
        <h1 className="font-black text-4xl text-text-primary">¡Llegaste!</h1>
        <p className="text-text-secondary text-base leading-relaxed">
          {patientName ? `Estás con ${patientName}.` : 'Estás con el paciente.'}{' '}
          La consulta continúa de forma presencial.
        </p>
        <span className={`font-bold text-sm ${cs.text}`}>{cs.label} · {emergency.dispatchCode}</span>
      </div>

      {/* Symptom summary — only ever shows what the patient actually reported */}
      <div className={`rounded-3xl border p-5 flex flex-col gap-3 ${cs.bg} ${cs.border}`}>
        <div className="flex items-center gap-2">
          <cs.Icon className={`w-5 h-5 ${cs.text}`} />
          <span className={`font-black text-sm uppercase tracking-wide ${cs.text}`}>
            {hasReportedSymptoms ? 'Síntomas reportados por el paciente' : 'Sin síntomas registrados'}
          </span>
        </div>
        {hasReportedSymptoms ? (
          <>
            <p className="text-sm text-text-secondary">El paciente seleccionó estos síntomas durante el triage.</p>
            <ul className="flex flex-col gap-2 mt-1">
              {storedSymptoms.map(s => (
                <li key={s} className="flex items-center gap-2.5">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${cs.dot}`} />
                  <span className="text-sm font-medium text-text-primary">{s}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-sm text-text-secondary">
            No quedó registro de síntomas para esta emergencia. Llamá al paciente para relevarlos.
          </p>
        )}
      </div>

      {/* Patient info recap */}
      <div className="bg-white rounded-3xl p-5 flex flex-col gap-3 border border-border-default">
        {patientName && <Row label="Paciente"  value={patientName} />}
        <Row label="Código"    value={<span className={`font-black ${cs.text}`}>{cs.label}</span>} />
        <Row label="Despacho"  value={<span className="font-mono">{emergency.dispatchCode}</span>} />
      </div>

      <Btn loading={updating} onClick={closeEmergency} color="bg-gray-950 hover:bg-gray-800" icon={<CheckCircle className="w-6 h-6" />}>
        Cerrar emergencia
      </Btn>
    </div>
  )
}

// ── Shared micro-components ────────────────────────────────────

function Row({ label, value, small = false }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-text-secondary text-sm shrink-0">{label}</span>
      <span className={`font-semibold text-text-primary text-right ${small ? 'text-xs font-mono' : ''}`}>{value}</span>
    </div>
  )
}

function Divider() {
  return <div className="h-px bg-border-default" />
}

function Btn({ children, onClick, color, icon, loading }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={`w-full py-5 rounded-[24px] text-white font-black text-xl flex items-center justify-center gap-3 shadow-lg active:scale-95 transition-transform disabled:opacity-60 ${color}`}
    >
      {loading
        ? <div className="w-6 h-6 border-[3px] border-white border-t-transparent rounded-full animate-spin" />
        : <>{icon}{children}</>
      }
    </button>
  )
}
