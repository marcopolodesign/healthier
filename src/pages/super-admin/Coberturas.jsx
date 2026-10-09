import { useState, useEffect, useMemo } from 'react'
import { IdentificationCard, CircleNotch, ArrowClockwise } from '@phosphor-icons/react'
import { supabase } from '../../lib/supabase'
import { formatDate } from '../../lib/format'
import MetricCard from '../../components/super-admin/MetricCard'

/**
 * Coberturas — /super-admin/coberturas
 *
 * Cada consulta al listado de obras sociales por DNI (Edge Function
 * `cobertura-sugerida`, tabla `cobertura_consultas`, migración 194): cuántas
 * precargaron una obra social, cuántas figuraban en el listado pero no
 * matchearon con el catálogo de recetas, y cuántas fallaron.
 *
 * La lista "Sin match" es la que sirve para trabajar: cada código que aparece
 * ahí se suma al puente `cobertura_rnos` (con una migración) y desde ese momento
 * se precarga solo.
 *
 * Sólo lectura. No muestra DNIs: la tabla guarda un hash.
 */

const RESULTADOS = {
  encontrada: { label: 'Precargada', cls: 'bg-green-100 text-green-800' },
  sin_match:  { label: 'Sin match',  cls: 'bg-amber-100 text-amber-800' },
  sin_datos:  { label: 'Sin datos',  cls: 'bg-gray-100 text-gray-700' },
  error:      { label: 'Error',      cls: 'bg-red-100 text-red-800' },
  limite:     { label: 'Límite',     cls: 'bg-red-100 text-red-800' },
}

export default function SuperAdminCoberturas() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  const cargar = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('cobertura_consultas')
      .select('id, created_at, resultado, rnos, cobertura_nombre, financiador_nombre, error, paciente:profiles!paciente_id(full_name)')
      .order('created_at', { ascending: false })
      .limit(500)
    setRows(data ?? [])
    setLoading(false)
  }
  useEffect(() => { cargar() }, [])

  const cuenta = r => rows.filter(x => x.resultado === r).length
  const sinMatch = useMemo(() => {
    const m = new Map()
    for (const r of rows) {
      if (r.resultado !== 'sin_match') continue
      const k = r.rnos || r.cobertura_nombre
      m.set(k, { rnos: r.rnos, nombre: r.cobertura_nombre, veces: (m.get(k)?.veces ?? 0) + 1 })
    }
    return [...m.values()].sort((a, b) => b.veces - a.veces)
  }, [rows])

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-light text-text-primary flex items-center gap-2">
            <IdentificationCard className="h-7 w-7 text-brand" /> Coberturas por DNI
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            Obra social precargada desde el listado de obras sociales al cargar el DNI. Últimas 500 consultas.
          </p>
        </div>
        <button onClick={cargar} className="btn-secondary flex items-center gap-1.5">
          <ArrowClockwise className="h-4 w-4" /> Actualizar
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <MetricCard label="Precargadas" value={cuenta('encontrada')} tone="ok" />
        <MetricCard label="Sin match" value={cuenta('sin_match')} hint="Figura, no está en el catálogo" />
        <MetricCard label="Sin datos" value={cuenta('sin_datos')} />
        <MetricCard label="Errores" value={cuenta('error')} tone={cuenta('error') ? 'bad' : 'neutral'} />
        <MetricCard label="Límite" value={cuenta('limite')} tone={cuenta('limite') ? 'bad' : 'neutral'} hint="Más de 5 DNIs en 24 h" />
      </div>

      {sinMatch.length > 0 && (
        <div className="card">
          <h2 className="font-semibold text-text-primary mb-2">Sin match con el catálogo de recetas</h2>
          <p className="text-xs text-text-tertiary mb-3">Sumar el código a <code>cobertura_rnos</code> para que se precargue.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-text-tertiary text-xs"><th className="py-1 pr-3">Código</th><th className="py-1 pr-3">Nombre en el listado</th><th className="py-1">Veces</th></tr></thead>
              <tbody>
                {sinMatch.map(s => (
                  <tr key={s.rnos || s.nombre} className="border-t border-border-default">
                    <td className="py-1.5 pr-3 font-mono">{s.rnos || '—'}</td>
                    <td className="py-1.5 pr-3">{s.nombre}</td>
                    <td className="py-1.5">{s.veces}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card overflow-x-auto">
        {loading ? (
          <div className="flex justify-center py-10"><CircleNotch className="h-6 w-6 animate-spin text-brand" /></div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-text-tertiary py-6 text-center">Todavía no hubo consultas.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-text-tertiary text-xs">
                <th className="py-2 pr-3">Fecha</th><th className="py-2 pr-3">Paciente</th><th className="py-2 pr-3">Resultado</th>
                <th className="py-2 pr-3">Listado</th><th className="py-2 pr-3">Catálogo</th><th className="py-2">Error</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const res = RESULTADOS[r.resultado] ?? { label: r.resultado, cls: 'bg-gray-100' }
                return (
                  <tr key={r.id} className="border-t border-border-default align-top">
                    <td className="py-2 pr-3 whitespace-nowrap">{formatDate(r.created_at)}</td>
                    <td className="py-2 pr-3">{r.paciente?.full_name ?? '—'}</td>
                    <td className="py-2 pr-3"><span className={`text-xs font-semibold px-2 py-0.5 rounded-md ${res.cls}`}>{res.label}</span></td>
                    <td className="py-2 pr-3">{r.cobertura_nombre ?? '—'}{r.rnos && <span className="text-text-tertiary font-mono"> · {r.rnos}</span>}</td>
                    <td className="py-2 pr-3">{r.financiador_nombre ?? '—'}</td>
                    <td className="py-2 text-xs text-danger max-w-xs break-words">{r.error ?? ''}</td>
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
