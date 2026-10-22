import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Map, Marker } from 'react-map-gl/mapbox'
import 'mapbox-gl/dist/mapbox-gl.css'
import { MapPin, Phone, User, Warning, WarningCircle, X } from '@phosphor-icons/react'
import { emergencyService } from '../../services/emergencyService'
import { dispatchService, antiguedadUbicacion, haceCuanto } from '../../services/dispatchService'
import { haversineKm, formatDistance } from '../../lib/geo'
import { distanciaGpsDireccion, DIFERENCIA_AVISO_M } from '../../lib/direccionEmergencia'
import MarcadorMovil from './MarcadorMovil'

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN
const REFRESCO_MS = 15_000

const TRIAGE = {
  ROJO:     { badge: 'bg-red-600 text-white',      marcador: 'bg-red-600 text-white' },
  AMARILLO: { badge: 'bg-amber-400 text-gray-900', marcador: 'bg-amber-400 text-gray-900' },
  VERDE:    { badge: 'bg-emerald-500 text-gray-900', marcador: 'bg-emerald-500 text-gray-900' },
}
const ESTADO = { dispatched: 'Despachada', in_transit: 'En camino', arrived: 'Llegó' }
const ROL = { medico: 'Médico/a', enfermero: 'Enfermero/a', chofer: 'Chofer' }
const ACTIVOS = ['dispatched', 'in_transit', 'arrived']

function sintomasDe(notes) {
  if (!notes) return []
  try { const a = JSON.parse(notes); return Array.isArray(a) ? a.filter(Boolean) : [] } catch { return [] }
}
function edadDe(nacimiento) {
  if (!nacimiento) return null
  const n = new Date(`${String(nacimiento).slice(0, 10)}T12:00:00`)
  if (Number.isNaN(n.getTime())) return null
  const hoy = new Date()
  let e = hoy.getFullYear() - n.getFullYear()
  if (hoy.getMonth() < n.getMonth() || (hoy.getMonth() === n.getMonth() && hoy.getDate() < n.getDate())) e--
  return e
}
function cronometro(desde, ahora) {
  const t = Math.max(0, Math.floor((ahora - new Date(desde).getTime()) / 1000))
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60
  const dos = n => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${dos(m)}:${dos(s)}` : `${dos(m)}:${dos(s)}`
}

/**
 * Un traslado "En curso" para el despacho (Mateo, 2026-10-22; diseño revisado
 * por Felipe): panel lateral de ~480 px y alto completo — no modal, para que
 * el operador siga viendo entrar pedidos en la cola — que en pantallas chicas
 * ocupa todo. Mapa chico con la ambulancia en vivo y el paciente, estado,
 * paciente, dirección y quién va. "Marcar terminada" fijo al pie.
 */
export default function PanelTraslado({ emergencyId, onClose, onTerminar, terminando }) {
  const [t, setT] = useState(undefined)
  const [error, setError] = useState('')
  const [ahora, setAhora] = useState(Date.now())
  const lectura = useRef(0)

  const leer = useCallback(async () => {
    const n = ++lectura.current
    try {
      const fila = await emergencyService.trasladoParaDespacho(emergencyId)
      if (n !== lectura.current) return
      setT(fila)
      setError('')
    } catch (e) {
      if (n === lectura.current) setError(e?.message || 'No pudimos cargar el traslado')
    }
  }, [emergencyId])

  useEffect(() => {
    setT(undefined)
    leer()
    const iv = setInterval(leer, REFRESCO_MS)
    let espera = null
    const quitar = dispatchService.suscribirUbicaciones(() => {
      if (espera) return
      espera = setTimeout(() => { espera = null; leer() }, 3000)
    })
    return () => { clearInterval(iv); if (espera) clearTimeout(espera); quitar() }
  }, [leer])

  useEffect(() => {
    const iv = setInterval(() => setAhora(Date.now()), 1000)
    return () => clearInterval(iv)
  }, [])

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const movil = t?.ambulancia ?? null
  const paciente = t?.patientLatitude != null ? { lat: Number(t.patientLatitude), lng: Number(t.patientLongitude) } : null
  const amb = movil?.ubicacion ? { lat: Number(movil.ubicacion.latitude), lng: Number(movil.ubicacion.longitude) } : null
  const vista = useMemo(() => {
    const puntos = [paciente, amb].filter(Boolean)
    if (puntos.length === 0) return null
    if (puntos.length === 1 || (haversineKm(puntos[0], puntos[1]) ?? 0) < 0.1) {
      return { longitude: puntos[0].lng, latitude: puntos[0].lat, zoom: 15 }
    }
    const lngs = puntos.map(p => p.lng), lats = puntos.map(p => p.lat)
    return { bounds: [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], fitBoundsOptions: { padding: 48 } }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t?.id, !!amb])

  const sintomas = sintomasDe(t?.notes)
  const edad = edadDe(t?.patient?.birthDate)
  const alergias = t?.patient?.allergies?.trim()
  const km = paciente && amb ? haversineKm(paciente, amb) : null
  const vieja = antiguedadUbicacion(movil?.ubicacion, ahora) !== 'vivo'
  const difGps = distanciaGpsDireccion(t)
  const triage = TRIAGE[t?.triageCode] ?? TRIAGE.ROJO
  const enCurso = t && ACTIVOS.includes(t.status)

  return (
    <div className="fixed inset-0 z-50 lg:inset-y-0 lg:left-auto lg:right-0 lg:w-[480px] bg-bg-primary lg:border-l lg:border-border-default lg:shadow-[-12px_0_30px_rgba(0,0,0,0.08)] flex flex-col" role="dialog" aria-label="Traslado en curso" data-testid="panel-traslado">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border-default flex-shrink-0">
        <h2 className="font-semibold text-text-primary">Traslado en curso</h2>
        <button onClick={onClose} className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-bg-surface" aria-label="Cerrar">
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {t === undefined && !error && <div className="h-[220px] rounded-2xl bg-bg-surface animate-pulse" />}
        {error && (
          <div className="flex items-start gap-2 p-3 rounded-xl bg-danger/5 text-sm text-danger">
            <WarningCircle className="h-5 w-5 shrink-0" /> {error}
            <button onClick={leer} className="ml-auto font-semibold underline">Reintentar</button>
          </div>
        )}
        {t === null && <p className="text-sm text-text-secondary">No existe o no tenés acceso.</p>}

        {t && (
          <>
            {vista && (
              <div className="relative h-[220px] rounded-2xl overflow-hidden border border-border-default">
                <Map
                  key={t.id}
                  mapboxAccessToken={MAPBOX_TOKEN}
                  initialViewState={vista}
                  mapStyle="mapbox://styles/mapbox/light-v11"
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
                  attributionControl={{ compact: true }}
                >
                  {paciente && (
                    <Marker longitude={paciente.lng} latitude={paciente.lat} anchor="center">
                      <div className={`w-8 h-8 rounded-[9px] border-2 border-white flex items-center justify-center shadow ${triage.marcador}`}>
                        <User className="w-4 h-4" weight="fill" />
                      </div>
                    </Marker>
                  )}
                  {amb && movil && (
                    <Marker longitude={amb.lng} latitude={amb.lat} anchor="top" offset={[0, -18]}>
                      <MarcadorMovil movil={movil} ahora={ahora} />
                    </Marker>
                  )}
                </Map>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-[11px] font-semibold uppercase px-2 py-0.5 rounded-full bg-sky-50 text-sky-700">{ESTADO[t.status] || t.status}</span>
              {t.dispatchCode && <span className="text-text-secondary">{t.dispatchCode}</span>}
              {t.dispatchedAt && <span className="text-text-secondary tabular-nums">Despachada · {cronometro(t.dispatchedAt, ahora)}</span>}
            </div>
            <p className="text-sm text-text-secondary">
              {km != null
                ? `A ${formatDistance(km)} del paciente${vieja ? ` · posición de ${haceCuanto(movil?.ubicacion?.updatedAt, ahora)}` : ''}`
                : movil ? 'El móvil todavía no reportó su posición' : 'Sin móvil asignado'}
            </p>

            <div className="space-y-1">
              <p className="text-xl font-semibold text-text-primary">{t.patient?.fullName || 'Paciente'}</p>
              {(edad != null || t.patient?.bloodType) && (
                <p className="text-sm text-text-secondary">{[edad != null ? `${edad} años` : null, t.patient?.bloodType ? `Grupo ${t.patient.bloodType}` : null].filter(Boolean).join(' · ')}</p>
              )}
            </div>
            {alergias && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-danger/5 text-sm font-semibold text-danger">
                <WarningCircle className="h-5 w-5 shrink-0" weight="fill" /> Alergias: {alergias}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={`text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${triage.badge}`}>{t.triageCode}</span>
              {sintomas.map((s, i) => <span key={i} className="text-[13px] bg-bg-surface text-text-primary px-2.5 py-1 rounded-full">{s}</span>)}
            </div>

            {t.direccion && (
              <div className="card space-y-1">
                <p className="flex items-start gap-2 font-semibold text-text-primary"><MapPin className="h-5 w-5 shrink-0 text-text-secondary" /> {t.direccion}</p>
                {t.direccionPiso && <p className="text-sm text-text-secondary">Piso / depto: {t.direccionPiso}</p>}
                {t.direccionReferencias && <p className="text-sm text-text-secondary">Referencias: {t.direccionReferencias}</p>}
                {difGps != null && difGps > DIFERENCIA_AVISO_M && (
                  <p className="flex items-start gap-2 mt-2 p-2.5 rounded-xl bg-amber-50 text-[13px] text-text-primary">
                    <Warning className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" weight="fill" />
                    El GPS del teléfono estaba a {formatDistance(difGps / 1000)} de esta dirección.
                  </p>
                )}
              </div>
            )}

            <div className="card space-y-1">
              <p className="font-semibold text-text-primary">Quién va</p>
              {movil ? (
                <>
                  <p className="text-sm text-text-primary">{movil.label}{movil.plate ? ` · ${movil.plate}` : ''}</p>
                  {(movil.tripulacion ?? []).length === 0
                    ? <p className="text-sm text-text-secondary">Sin tripulación cargada</p>
                    : movil.tripulacion.map(x => <p key={x.id} className="text-sm text-text-secondary">{ROL[x.crewRole] || x.crewRole}: {x.profile?.fullName || '—'}</p>)}
                </>
              ) : <p className="text-sm text-text-secondary">{t.medico?.fullName ? `Médico: ${t.medico.fullName}` : 'Sin móvil asignado'}</p>}
            </div>

            <div className="grid grid-cols-2 gap-2">
              {t.patient?.phone && (
                <a href={`tel:${t.patient.phone}`} className="btn-secondary flex items-center justify-center gap-2 min-h-14"><Phone className="h-4 w-4" /> Paciente</a>
              )}
              {t.medico?.phone && (
                <a href={`tel:${t.medico.phone}`} className="btn-secondary flex items-center justify-center gap-2 min-h-14"><Phone className="h-4 w-4" /> Médico</a>
              )}
            </div>
          </>
        )}
      </div>

      {enCurso && onTerminar && (
        <div className="flex-shrink-0 p-4 border-t border-border-default">
          <button className="btn-primary w-full min-h-14" disabled={terminando} onClick={() => onTerminar(t)} data-testid="panel-terminar">
            {terminando ? 'Terminando...' : 'Marcar terminada'}
          </button>
        </div>
      )}
    </div>
  )
}
