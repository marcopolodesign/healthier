import { useState, useEffect, useMemo } from 'react'
import { Buildings, CircleNotch, ArrowClockwise, Check, X } from '@phosphor-icons/react'
import { ministerioService } from '../../services/ministerioService'
import { formatDate } from '../../lib/format'
import { toast } from '../../components/Toast'
import MetricCard from '../../components/super-admin/MetricCard'

/**
 * Consultorios — /super-admin/consultorios (migración 196)
 *
 * Cada dirección de consultorio que cargó un profesional, contra el Registro
 * Federal de Establecimientos de Salud (REFES). Lo que matchea solo queda
 * "Consultorio habilitado" en el perfil público; lo que no, cae acá en
 * "Para revisar" y el super admin lo aprueba o lo rechaza a mano. Nada se
 * bloquea mientras tanto: el profesional sigue atendiendo igual, sólo sin la
 * chapa.
 */

const ESTADOS = {
  revisar:          { label: 'Para revisar',     cls: 'bg-amber-100 text-amber-800' },
  pendiente:        { label: 'Consultando',      cls: 'bg-gray-100 text-gray-700' },
  error:            { label: 'Reintentando',     cls: 'bg-red-100 text-red-800' },
  verificado:       { label: 'Verificado',       cls: 'bg-green-100 text-green-800' },
  aprobado_manual:  { label: 'Aprobado a mano',  cls: 'bg-green-100 text-green-800' },
  rechazado_manual: { label: 'Rechazado',        cls: 'bg-gray-200 text-gray-700' },
}

const FILTROS = [
  { id: 'revisar', label: 'Para revisar', estados: ['revisar', 'error', 'pendiente'] },
  { id: 'habilitados', label: 'Habilitados', estados: ['verificado', 'aprobado_manual'] },
  { id: 'rechazados', label: 'Rechazados', estados: ['rechazado_manual'] },
  { id: 'todos', label: 'Todos', estados: null },
]

export default function SuperAdminConsultorios() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [filtro, setFiltro] = useState('revisar')
  const [ocupado, setOcupado] = useState(null)

  const cargar = async () => {
    setLoading(true)
    try { setRows(await ministerioService.listarConsultorios()) }
    catch (e) { toast.error(`No se pudieron cargar los consultorios: ${e.message}`) }
    setLoading(false)
  }
  useEffect(() => { cargar() }, [])

  const cuenta = (...e) => rows.filter(r => e.includes(r.refesEstado)).length
  const visibles = useMemo(() => {
    const f = FILTROS.find(x => x.id === filtro)
    return f?.estados ? rows.filter(r => f.estados.includes(r.refesEstado)) : rows
  }, [rows, filtro])

  const accion = async (id, fn, okMsg) => {
    setOcupado(id)
    try { await fn(); toast.success(okMsg); await cargar() }
    catch (e) { toast.error(e.message) }
    setOcupado(null)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-light text-text-primary flex items-center gap-2">
            <Buildings className="h-7 w-7 text-brand" /> Consultorios
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            Dirección del consultorio contra el Registro Federal de Establecimientos de Salud. Lo que no matchea solo se decide acá.
          </p>
        </div>
        <button onClick={cargar} className="btn-secondary flex items-center gap-1.5">
          <ArrowClockwise className="h-4 w-4" /> Actualizar
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricCard label="Para revisar" value={cuenta('revisar')} tone={cuenta('revisar') ? 'bad' : 'neutral'} />
        <MetricCard label="Habilitados" value={cuenta('verificado', 'aprobado_manual')} tone="ok" hint={`${cuenta('verificado')} automáticos`} />
        <MetricCard label="Reintentando" value={cuenta('error', 'pendiente')} />
        <MetricCard label="Rechazados" value={cuenta('rechazado_manual')} />
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTROS.map(f => (
          <button key={f.id} onClick={() => setFiltro(f.id)}
            className={`px-3 py-1.5 rounded-full text-sm border ${filtro === f.id ? 'bg-brand text-white border-brand' : 'bg-white border-border-default text-text-secondary'}`}>
            {f.label}
          </button>
        ))}
      </div>

      <div className="card overflow-x-auto">
        {loading ? (
          <div className="flex justify-center py-10"><CircleNotch className="h-6 w-6 animate-spin text-brand" /></div>
        ) : visibles.length === 0 ? (
          <p className="text-sm text-text-tertiary py-6 text-center">No hay consultorios en esta lista.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-text-tertiary text-xs">
                <th className="py-2 pr-3">Profesional</th><th className="py-2 pr-3">Dirección</th><th className="py-2 pr-3">Estado</th>
                <th className="py-2 pr-3">REFES</th><th className="py-2 pr-3">Actualizado</th><th className="py-2">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map(r => {
                const est = ESTADOS[r.refesEstado] ?? { label: r.refesEstado, cls: 'bg-gray-100' }
                const candidatos = r.refesRaw?.candidatos ?? []
                return (
                  <tr key={r.id} className="border-t border-border-default align-top" data-testid="consultorio-fila">
                    <td className="py-2 pr-3">
                      <p className="text-text-primary">{r.profile?.fullName ?? '—'}</p>
                      <p className="text-xs text-text-tertiary">{r.profile?.email}</p>
                    </td>
                    <td className="py-2 pr-3 max-w-xs">{r.address}</td>
                    <td className="py-2 pr-3">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-md whitespace-nowrap ${est.cls}`}>{est.label}</span>
                      {r.refesError && <p className="text-xs text-text-tertiary mt-1 max-w-xs break-words">{r.refesError}</p>}
                    </td>
                    <td className="py-2 pr-3 text-xs">
                      {r.refesNombre ? <><p className="text-text-primary">{r.refesNombre}</p><p className="font-mono text-text-tertiary">{r.refesId}</p></> : null}
                      {!r.refesNombre && candidatos.map(c => (
                        <p key={c.refesId} className="text-text-secondary">{c.nombre} · <span className="font-mono">{c.refesId}</span></p>
                      ))}
                      {!r.refesNombre && !candidatos.length && '—'}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap">{r.refesActualizadoAt ? formatDate(r.refesActualizadoAt) : '—'}</td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-1.5">
                        {!['verificado', 'aprobado_manual'].includes(r.refesEstado) && (
                          <button disabled={ocupado === r.id}
                            onClick={() => accion(r.id, () => ministerioService.decidirConsultorio(r.id, 'aprobar'), 'Consultorio aprobado')}
                            className="btn-secondary text-xs px-2.5 py-1 flex items-center gap-1" data-testid="consultorio-aprobar">
                            <Check className="h-3.5 w-3.5" /> Aprobar
                          </button>
                        )}
                        {r.refesEstado !== 'rechazado_manual' && (
                          <button disabled={ocupado === r.id}
                            onClick={() => accion(r.id, () => ministerioService.decidirConsultorio(r.id, 'rechazar'), 'Consultorio rechazado')}
                            className="btn-secondary text-xs px-2.5 py-1 flex items-center gap-1">
                            <X className="h-3.5 w-3.5" /> Rechazar
                          </button>
                        )}
                        <button disabled={ocupado === r.id}
                          onClick={() => accion(r.id, () => ministerioService.reintentarConsultorio(r.id), 'Consultado de nuevo')}
                          className="btn-secondary text-xs px-2.5 py-1 flex items-center gap-1">
                          <ArrowClockwise className="h-3.5 w-3.5" /> Reintentar
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
