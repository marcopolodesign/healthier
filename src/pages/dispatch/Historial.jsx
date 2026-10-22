import { useCallback, useEffect, useMemo, useState } from 'react'
import { ClockCounterClockwise, FileImage, MagnifyingGlass, CircleNotch } from '@phosphor-icons/react'
import { dispatchService } from '../../services/dispatchService'
import { emergencyService } from '../../services/emergencyService'
import { COBRO, cobroDe, duracionMin, formatDuracion } from '../../lib/cobroEmergencia'
import PanelHistorial from '../../components/dispatch/PanelHistorial'

/**
 * Historial del despacho (Nacho, 2026-10-22: "el operador tiene que ver
 * despachos previos en otro tab"; diseño revisado por Felipe). Los traslados
 * terminados o cancelados de la entidad, con su detalle en un panel lateral.
 */
const TRIAGE_BADGE = {
  ROJO: 'bg-red-50 text-red-600',
  AMARILLO: 'bg-amber-50 text-amber-600',
  VERDE: 'bg-emerald-50 text-emerald-600',
}
const RANGOS = [
  { id: 'hoy', label: 'Hoy' },
  { id: '7', label: '7 días' },
  { id: '30', label: '30 días' },
]
const ESTADOS = [
  { id: 'completed', label: 'Terminadas' },
  { id: 'cancelled', label: 'Canceladas' },
  { id: 'todas', label: 'Todas' },
]
const POR_PAGINA = 30

function desdeDe(rango) {
  const d = new Date()
  if (rango === 'hoy') d.setHours(0, 0, 0, 0)
  else d.setDate(d.getDate() - Number(rango))
  return d.toISOString()
}

/** "Hoy 14:32" / "Ayer 09:10" / "20 oct 18:05". */
export function cuandoFue(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  const hora = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0)
  const dia = new Date(d); dia.setHours(0, 0, 0, 0)
  const dif = Math.round((hoy - dia) / 86400000)
  if (dif === 0) return `Hoy ${hora}`
  if (dif === 1) return `Ayer ${hora}`
  return `${d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })} ${hora}`
}

function Chips({ opciones, valor, onChange, etiqueta }) {
  return (
    <div className="flex gap-1 p-1 rounded-full bg-bg-surface" role="radiogroup" aria-label={etiqueta}>
      {opciones.map(o => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={valor === o.id}
          onClick={() => onChange(o.id)}
          className={`px-3.5 py-1.5 rounded-full text-sm font-medium transition-colors ${valor === o.id ? 'bg-white text-text-primary shadow-sm' : 'text-text-secondary'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function ChapaCobro({ e }) {
  const c = COBRO[cobroDe(e)]
  return (
    <span title={c.ayuda} className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-bg-surface text-text-secondary whitespace-nowrap">
      {e.status === 'cancelled' && cobroDe(e) === 'sin_pago' ? 'Cancelada' : c.label}
    </span>
  )
}

export default function DespachoHistorial() {
  const [entidad, setEntidad] = useState(null)
  const [rango, setRango] = useState('hoy')
  const [estado, setEstado] = useState('completed')
  const [busqueda, setBusqueda] = useState('')
  const [filas, setFilas] = useState([])
  const [hayMas, setHayMas] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [abierto, setAbierto] = useState(null)

  useEffect(() => {
    dispatchService.miEntidad()
      .then(setEntidad)
      .catch(() => { setError('No pudimos cargar tu entidad'); setCargando(false) })
  }, [])

  const cargar = useCallback(async ({ offset = 0 } = {}) => {
    if (!entidad?.id) return
    setCargando(true)
    setError('')
    try {
      const nuevas = await emergencyService.historialDeDespacho({
        providerId: entidad.id, desde: desdeDe(rango), estado, limite: POR_PAGINA, offset,
      })
      setFilas(prev => (offset ? [...prev, ...nuevas] : nuevas))
      setHayMas(nuevas.length === POR_PAGINA)
    } catch (e) {
      setError(e?.message || 'No pudimos cargar el historial')
    } finally {
      setCargando(false)
    }
  }, [entidad?.id, rango, estado])

  useEffect(() => { cargar() }, [cargar])

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    if (!q) return filas
    return filas.filter(e =>
      (e.pacienteNombre || e.patient?.fullName || '').toLowerCase().includes(q) || (e.dispatchCode || '').toLowerCase().includes(q))
  }, [filas, busqueda])

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
          <ClockCounterClockwise className="h-6 w-6 text-brand" /> Historial
        </h1>
        <p className="text-text-secondary mt-1">{entidad?.name}</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Chips opciones={RANGOS} valor={rango} onChange={setRango} etiqueta="Rango" />
        <Chips opciones={ESTADOS} valor={estado} onChange={setEstado} etiqueta="Estado" />
        <label className="relative flex-1 min-w-[220px]">
          <MagnifyingGlass className="h-4 w-4 text-text-tertiary absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            className="form-input pl-9"
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            placeholder="Buscar paciente o código"
            aria-label="Buscar paciente o código"
          />
        </label>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      {!cargando && !error && visibles.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-text-secondary text-sm">No hubo traslados en este rango.</p>
        </div>
      ) : (
        <>
          {/* Desktop: tabla de 6 columnas. */}
          <div className="hidden md:block card p-0 overflow-hidden">
            <table className="w-full text-sm" data-testid="historial-tabla">
              <thead className="text-left text-text-secondary border-b border-border-default">
                <tr>
                  <th className="font-medium px-4 py-3">Pedido</th>
                  <th className="font-medium px-4 py-3">Paciente</th>
                  <th className="font-medium px-4 py-3">Triage</th>
                  <th className="font-medium px-4 py-3">Móvil</th>
                  <th className="font-medium px-4 py-3 text-right">Duración</th>
                  <th className="font-medium px-4 py-3">Cobro</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map(e => (
                  <tr
                    key={e.id}
                    onClick={() => setAbierto(e.id)}
                    className="border-b border-border-default last:border-0 cursor-pointer hover:bg-bg-surface"
                    data-testid="historial-fila"
                  >
                    <td className="px-4 py-3 align-top">
                      <p className="text-text-primary tabular-nums">{cuandoFue(e.createdAt)}</p>
                      <p className="text-xs text-text-secondary">{e.dispatchCode || '—'}</p>
                    </td>
                    <td className="px-4 py-3 align-top font-medium text-text-primary">{e.pacienteNombre || e.patient?.fullName || 'Paciente'}</td>
                    <td className="px-4 py-3 align-top">
                      <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-full ${TRIAGE_BADGE[e.triageCode] || 'bg-gray-100 text-gray-500'}`}>{e.triageCode || '—'}</span>
                    </td>
                    <td className="px-4 py-3 align-top text-text-primary">
                      {[e.ambulancia?.label, e.medico?.fullName].filter(Boolean).join(' · ') || '—'}
                    </td>
                    <td className="px-4 py-3 align-top text-right tabular-nums text-text-primary">{formatDuracion(duracionMin(e))}</td>
                    <td className="px-4 py-3 align-top">
                      <span className="flex items-center gap-1.5">
                        <ChapaCobro e={e} />
                        {e.ordenes?.length > 0 && <FileImage className="h-4 w-4 text-text-secondary" aria-label="Tiene orden de traslado" />}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Celular: tarjetas. */}
          <div className="md:hidden space-y-3">
            {visibles.map(e => (
              <button key={e.id} type="button" onClick={() => setAbierto(e.id)} className="card w-full text-left space-y-1.5" data-testid="historial-tarjeta">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 min-w-0">
                    <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-full ${TRIAGE_BADGE[e.triageCode] || 'bg-gray-100 text-gray-500'}`}>{e.triageCode || '—'}</span>
                    <span className="font-semibold text-text-primary truncate">{e.pacienteNombre || e.patient?.fullName || 'Paciente'}</span>
                  </span>
                  <span className="text-sm text-text-secondary tabular-nums shrink-0">{cuandoFue(e.createdAt)}</span>
                </div>
                <p className="text-sm text-text-secondary">{[e.dispatchCode, e.ambulancia?.label, e.medico?.fullName].filter(Boolean).join(' · ')}</p>
                <div className="flex items-center gap-2">
                  <ChapaCobro e={e} />
                  <span className="text-sm text-text-secondary tabular-nums">{formatDuracion(duracionMin(e))}</span>
                  {e.ordenes?.length > 0 && <FileImage className="h-4 w-4 text-text-secondary" aria-label="Tiene orden de traslado" />}
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      {cargando && <div className="flex justify-center py-4"><CircleNotch className="h-5 w-5 animate-spin text-brand" /></div>}
      {!cargando && hayMas && !busqueda && (
        <button className="btn-secondary w-full" onClick={() => cargar({ offset: filas.length })}>Ver más</button>
      )}

      {abierto && <PanelHistorial emergencyId={abierto} onClose={() => setAbierto(null)} />}
    </div>
  )
}
