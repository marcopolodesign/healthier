import { useState, useEffect, useMemo } from 'react'
import { IdentificationBadge, CircleNotch, ArrowClockwise } from '@phosphor-icons/react'
import { ministerioService } from '../../services/ministerioService'
import { formatDate } from '../../lib/format'
import { toast } from '../../components/Toast'
import MetricCard from '../../components/super-admin/MetricCard'

/**
 * Federador — /super-admin/federador (migración 196)
 *
 * Cada paciente con identidad completa se busca en el Federador Nacional de
 * pacientes del Ministerio de Salud. "Vinculado" = ya estaba y guardamos su id
 * nacional; "Federado" = lo dimos de alta nosotros; "No está" = no figura (y el
 * modo actual no da de alta). Los errores se reintentan solos; acá se ven.
 *
 * El paciente no ve nada de esto. Sólo identidad: nada clínico sale por acá.
 */

const ESTADOS = {
  vinculado:     { label: 'Vinculado',   cls: 'bg-green-100 text-green-800' },
  federado:      { label: 'Federado',    cls: 'bg-green-100 text-green-800' },
  no_encontrado: { label: 'No está',     cls: 'bg-gray-100 text-gray-700' },
  pendiente:     { label: 'Consultando', cls: 'bg-gray-100 text-gray-700' },
  error:         { label: 'Error',       cls: 'bg-red-100 text-red-800' },
  sin_datos:     { label: 'Sin datos',   cls: 'bg-amber-100 text-amber-800' },
}

export default function SuperAdminFederador() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [soloProblemas, setSoloProblemas] = useState(false)
  const [ocupado, setOcupado] = useState(null)

  const cargar = async () => {
    setLoading(true)
    try { setRows(await ministerioService.listarFederador()) }
    catch (e) { toast.error(`No se pudo cargar: ${e.message}`) }
    setLoading(false)
  }
  useEffect(() => { cargar() }, [])

  const cuenta = (...e) => rows.filter(r => e.includes(r.federadorEstado)).length
  const visibles = useMemo(
    () => (soloProblemas ? rows.filter(r => ['error', 'no_encontrado', 'sin_datos'].includes(r.federadorEstado)) : rows),
    [rows, soloProblemas],
  )

  const reintentar = async (id) => {
    setOcupado(id)
    try {
      const r = await ministerioService.reintentarFederador(id)
      const res = r?.resultados?.[0]
      toast.success(`Resultado: ${ESTADOS[res?.estado]?.label ?? res?.estado ?? '—'}`)
      await cargar()
    } catch (e) { toast.error(e.message) }
    setOcupado(null)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-light text-text-primary flex items-center gap-2">
            <IdentificationBadge className="h-7 w-7 text-brand" /> Federador de pacientes
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            Registro nacional de pacientes del Ministerio de Salud. Sólo datos de identidad.
          </p>
        </div>
        <button onClick={cargar} className="btn-secondary flex items-center gap-1.5">
          <ArrowClockwise className="h-4 w-4" /> Actualizar
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <MetricCard label="Vinculados" value={cuenta('vinculado')} tone="ok" />
        <MetricCard label="Federados" value={cuenta('federado')} tone="ok" hint="Alta hecha por Healthier" />
        <MetricCard label="No están" value={cuenta('no_encontrado')} />
        <MetricCard label="Errores" value={cuenta('error')} tone={cuenta('error') ? 'bad' : 'neutral'} hint="Se reintentan solos" />
        <MetricCard label="Consultando" value={cuenta('pendiente')} />
      </div>

      <label className="flex items-center gap-2 text-sm text-text-secondary">
        <input type="checkbox" checked={soloProblemas} onChange={e => setSoloProblemas(e.target.checked)} />
        Sólo los que no quedaron vinculados
      </label>

      <div className="card overflow-x-auto">
        {loading ? (
          <div className="flex justify-center py-10"><CircleNotch className="h-6 w-6 animate-spin text-brand" /></div>
        ) : visibles.length === 0 ? (
          <p className="text-sm text-text-tertiary py-6 text-center">Todavía no hay pacientes consultados.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-text-tertiary text-xs">
                <th className="py-2 pr-3">Paciente</th><th className="py-2 pr-3">Estado</th><th className="py-2 pr-3">Id nacional</th>
                <th className="py-2 pr-3">Actualizado</th><th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {visibles.map(r => {
                const est = ESTADOS[r.federadorEstado] ?? { label: r.federadorEstado, cls: 'bg-gray-100' }
                return (
                  <tr key={r.id} className="border-t border-border-default align-top" data-testid="federador-fila">
                    <td className="py-2 pr-3">
                      <p className="text-text-primary">{r.fullName ?? '—'}{r.esPrueba && <span className="ml-1.5 text-[10px] uppercase text-text-tertiary">prueba</span>}</p>
                      <p className="text-xs text-text-tertiary">{r.email}</p>
                    </td>
                    <td className="py-2 pr-3">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-md ${est.cls}`}>{est.label}</span>
                      {r.federadorError && <p className="text-xs text-text-tertiary mt-1 max-w-xs break-words">{r.federadorError}</p>}
                      {r.federadorEstado === 'error' && r.federadorProximoIntento && (
                        <p className="text-xs text-text-tertiary">Reintenta {formatDate(r.federadorProximoIntento)} · intento {r.federadorIntentos}</p>
                      )}
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs">{r.federadorId ?? '—'}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{r.federadorActualizadoAt ? formatDate(r.federadorActualizadoAt) : '—'}</td>
                    <td className="py-2">
                      <button disabled={ocupado === r.id} onClick={() => reintentar(r.id)}
                        className="btn-secondary text-xs px-2.5 py-1 flex items-center gap-1">
                        <ArrowClockwise className="h-3.5 w-3.5" /> Reintentar
                      </button>
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
