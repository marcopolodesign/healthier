import { useState, useEffect, useMemo, useCallback } from 'react'
import { Siren, Phone, Ambulance, Clock, MapPin } from '@phosphor-icons/react'
import { dispatchService, ubicacionEsReciente } from '../../services/dispatchService'
import { emergencyService } from '../../services/emergencyService'
import { mpService } from '../../services/mpService'
import { toast } from '../../components/Toast'
import Modal from '../../components/Modal'
import { haversineKm, formatDistance } from '../../lib/geo'

const TRIAGE_BADGE = {
  ROJO:     'bg-red-50 text-red-600',
  AMARILLO: 'bg-amber-50 text-amber-600',
  VERDE:    'bg-emerald-50 text-emerald-600',
}

const ESTADO_EN_CURSO = {
  dispatched: 'Despachada',
  in_transit: 'En camino',
  arrived:    'Llegó',
}

const REFRESH_MS = 15_000

function parseSintomas(notes) {
  if (!notes) return []
  try {
    const arr = JSON.parse(notes)
    return Array.isArray(arr) ? arr.filter(Boolean) : []
  } catch {
    return []
  }
}

function formatElapsed(totalSeconds) {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** Cuánto hace que se creó la solicitud, en vivo. */
function useElapsed(createdAt, tick) {
  return useMemo(() => {
    if (!createdAt) return '00:00'
    const sec = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000))
    return formatElapsed(sec)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createdAt, tick])
}

function SolicitudCard({ req, tick, onAsignar }) {
  const elapsed = useElapsed(req.createdAt, tick)
  const sintomas = parseSintomas(req.notes)
  return (
    <div className="card space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-full ${TRIAGE_BADGE[req.triageCode] || 'bg-gray-100 text-gray-500'}`}>
            {req.triageCode || '—'}
          </span>
          <p className="font-semibold text-text-primary text-sm">{req.patient?.fullName || 'Paciente'}</p>
        </div>
        <div className="flex items-center gap-1 text-text-secondary text-sm tabular-nums shrink-0">
          <Clock className="h-3.5 w-3.5" />
          {elapsed}
        </div>
      </div>

      {req.patient?.phone && (
        <p className="flex items-center gap-1.5 text-xs text-text-secondary">
          <Phone className="h-3.5 w-3.5 shrink-0" /> {req.patient.phone}
        </p>
      )}

      {sintomas.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {sintomas.map((s, i) => (
            <span key={i} className="text-[11px] bg-bg-surface text-text-secondary px-2 py-0.5 rounded-full">{s}</span>
          ))}
        </div>
      )}

      <button className="btn-primary w-full" onClick={() => onAsignar(req)}>
        Asignar móvil
      </button>
    </div>
  )
}

export default function DespachoCola({ profile }) {
  const [entidad, setEntidad] = useState(null)
  const [cola, setCola] = useState([])
  const [enCurso, setEnCurso] = useState([])
  const [ambulancias, setAmbulancias] = useState([])
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  const [modalReq, setModalReq] = useState(null)
  const [asignando, setAsignando] = useState(null)
  const [terminando, setTerminando] = useState(null)

  const cargar = useCallback(async (providerId) => {
    try {
      const [colaData, enCursoData, ambData] = await Promise.all([
        emergencyService.colaDeDespacho(),
        emergencyService.enCursoParaDespacho(),
        dispatchService.listarAmbulancias(providerId),
      ])
      setCola(colaData)
      setEnCurso(enCursoData)
      setAmbulancias(ambData)
    } catch {
      toast.error('Error al cargar la cola de despacho')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    dispatchService.miEntidad()
      .then(e => { setEntidad(e); return cargar(e?.id) })
      .catch(() => { toast.error('Error al cargar tu entidad'); setLoading(false) })
  }, [cargar])

  // Refresco de listas cada 15s.
  useEffect(() => {
    if (!entidad) return
    const iv = setInterval(() => cargar(entidad.id), REFRESH_MS)
    return () => clearInterval(iv)
  }, [entidad, cargar])

  // Tic del cronómetro de espera, cada segundo.
  useEffect(() => {
    const iv = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(iv)
  }, [])

  const confirmarAsignacion = async (ambulanceId) => {
    if (!modalReq || !entidad) return
    setAsignando(ambulanceId)
    try {
      await emergencyService.asignarAmbulancia({
        emergencyId: modalReq.id,
        ambulanceId,
        providerId: entidad.id,
        operatorId: profile?.id,
      })
      toast.success('Móvil asignado')
      setModalReq(null)
      cargar(entidad.id)
    } catch (err) {
      toast.error(err?.message || 'Error al asignar el móvil')
    } finally {
      setAsignando(null)
    }
  }

  /**
   * Terminar el traslado ES el cobro (decisión de Mateo, 2026-09-12): en el
   * mismo movimiento se captura la reserva que se le hizo al paciente al
   * pedir. Separarlo en dos botones dejaba reservas colgadas hasta que vencen
   * solas — o sea, servicios prestados y no cobrados.
   *
   * El orden importa: primero se cobra, después se cierra. Si el cobro falla,
   * el traslado sigue en curso y el operador lo ve — al revés quedaría
   * cerrado y sin cobrar, que es la mitad que nadie vuelve a mirar.
   */
  const terminar = async (req) => {
    setTerminando(req.id)
    try {
      const { error: errorCobro } = await mpService.capturarEmergencia(req.id)
      if (errorCobro) {
        toast.error(`No se pudo cobrar: ${errorCobro}. El traslado sigue abierto.`)
        return
      }
      await emergencyService.updateStatus(req.id, 'completed')
      await emergencyService.liberarAmbulancia(req.ambulancia?.id)
      toast.success('Traslado terminado y cobrado')
      cargar(entidad?.id)
    } catch (err) {
      toast.error(err?.message || 'Error al terminar el traslado')
    } finally {
      setTerminando(null)
    }
  }

  const opcionesModal = useMemo(() => {
    if (!modalReq) return []
    const paciente = (modalReq.patientLatitude != null && modalReq.patientLongitude != null)
      ? { lat: modalReq.patientLatitude, lng: modalReq.patientLongitude }
      : null
    return ambulancias
      .filter(a => a.status === 'disponible')
      .map(a => {
        const fresca = ubicacionEsReciente(a.ubicacion)
        const distanciaKm = (fresca && paciente) ? haversineKm(paciente, a.ubicacion) : null
        return { ambulancia: a, distanciaKm }
      })
      .sort((a, b) => {
        if (a.distanciaKm == null && b.distanciaKm == null) return 0
        if (a.distanciaKm == null) return 1
        if (b.distanciaKm == null) return -1
        return a.distanciaKm - b.distanciaKm
      })
  }, [modalReq, ambulancias])

  if (loading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="h-8 w-48 bg-bg-surface rounded-lg animate-pulse" />
        <div className="grid md:grid-cols-2 gap-4">
          {[1, 2].map(i => <div key={i} className="h-40 bg-bg-surface rounded-lg animate-pulse" />)}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
          <Siren className="h-6 w-6 text-brand" /> Cola de despacho
        </h1>
        <p className="text-text-secondary mt-1">{entidad?.name}</p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Esperando móvil */}
        <div className="space-y-3">
          <h2 className="font-semibold text-text-primary">Esperando móvil ({cola.length})</h2>
          {cola.length === 0 ? (
            <div className="card text-center py-12">
              <p className="text-text-secondary text-sm">No hay solicitudes esperando</p>
            </div>
          ) : (
            <div className="space-y-3">
              {cola.map(req => (
                <SolicitudCard key={req.id} req={req} tick={tick} onAsignar={setModalReq} />
              ))}
            </div>
          )}
        </div>

        {/* En curso */}
        <div className="space-y-3">
          <h2 className="font-semibold text-text-primary">En curso ({enCurso.length})</h2>
          {enCurso.length === 0 ? (
            <div className="card text-center py-12">
              <p className="text-text-secondary text-sm">No hay traslados en curso</p>
            </div>
          ) : (
            <div className="space-y-3">
              {enCurso.map(req => (
                <div key={req.id} className="card space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-full bg-sky-50 text-sky-600">
                      {ESTADO_EN_CURSO[req.status] || req.status}
                    </span>
                    <p className="text-sm text-text-secondary">{req.ambulancia?.label || '—'} {req.ambulancia?.plate ? `· ${req.ambulancia.plate}` : ''}</p>
                  </div>
                  <p className="font-medium text-text-primary text-sm">{req.patient?.fullName || 'Paciente'}</p>
                  {req.patient?.phone && (
                    <p className="flex items-center gap-1.5 text-xs text-text-secondary">
                      <Phone className="h-3.5 w-3.5 shrink-0" /> {req.patient.phone}
                    </p>
                  )}
                  <button
                    className="btn-secondary w-full"
                    disabled={terminando === req.id}
                    onClick={() => terminar(req)}
                  >
                    {terminando === req.id ? 'Terminando...' : 'Marcar terminada'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <Modal open={!!modalReq} onClose={() => setModalReq(null)} title="Asignar móvil" size="lg">
        {modalReq && (
          <div className="space-y-4">
            <p className="text-sm text-text-secondary">
              Paciente: <span className="font-medium text-text-primary">{modalReq.patient?.fullName || '—'}</span>
            </p>
            <p className="text-xs text-text-tertiary">La más cercana no siempre es la más rápida — mirá el tránsito.</p>

            {opcionesModal.length === 0 ? (
              <div className="text-center py-10">
                <Ambulance className="h-10 w-10 text-text-muted mx-auto mb-2" />
                <p className="text-text-secondary text-sm">No hay móviles disponibles</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[50vh] overflow-y-auto">
                {opcionesModal.map(({ ambulancia: a, distanciaKm }) => (
                  <div key={a.id} className="flex items-center justify-between gap-3 p-3 rounded-xl border border-border-default">
                    <div className="min-w-0">
                      <p className="font-medium text-text-primary text-sm">{a.label} {a.plate ? `· ${a.plate}` : ''}</p>
                      <p className="text-xs text-text-secondary">
                        {(a.tripulacion || []).map(t => t.profile?.fullName).filter(Boolean).join(', ') || 'Sin tripulación'}
                      </p>
                      <p className="text-xs text-text-tertiary flex items-center gap-1 mt-0.5">
                        <MapPin className="h-3 w-3 shrink-0" />
                        {distanciaKm != null ? `${formatDistance(distanciaKm)} en línea recta` : 'Sin posición reciente'}
                      </p>
                    </div>
                    <button
                      className="btn-primary shrink-0"
                      disabled={asignando === a.id}
                      onClick={() => confirmarAsignacion(a.id)}
                    >
                      {asignando === a.id ? '...' : 'Asignar'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
