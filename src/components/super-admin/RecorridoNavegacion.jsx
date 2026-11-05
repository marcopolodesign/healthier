import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { filasDelRecorrido } from '../../lib/flowUrl'

/**
 * Recorrido de navegación (`flow_url`, migración 232) de un usuario o de una
 * consulta: por qué pantallas pasó, a qué hora y cuánto tardó de una a la
 * siguiente. Lo lee de la base por id, así sirve igual desde la ficha del
 * usuario que desde el detalle de una consulta.
 *
 * Sólo lectura. La ruta ya viene sin datos personales (ids como `:id`, sin
 * query salvo utm_*): lo limpia el cliente antes de guardarlo.
 */
export default function RecorridoNavegacion({ tabla, id, titulo = 'Recorrido antes de llegar' }) {
  const [flow, setFlow] = useState(undefined) // undefined = cargando, null = sin recorrido
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!id) return undefined
    let vivo = true
    supabase.from(tabla).select('flow_url').eq('id', id).maybeSingle()
      .then(({ data, error: err }) => {
        if (!vivo) return
        if (err) { setError(true); return }
        setFlow(data?.flow_url ?? null)
      })
    return () => { vivo = false }
  }, [tabla, id])

  const filas = filasDelRecorrido(flow)

  return (
    <section>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary mb-2">{titulo}</h4>
      {error ? (
        <p className="text-sm text-gray-500">No se pudo leer el recorrido.</p>
      ) : flow === undefined ? (
        <p className="text-sm text-gray-400">Cargando…</p>
      ) : filas.length === 0 ? (
        <p className="text-sm text-gray-500">Sin recorrido registrado.</p>
      ) : (
        <ol className="divide-y divide-gray-100 rounded-xl border border-gray-100" data-testid="recorrido-navegacion">
          {filas.map((f, i) => (
            <li key={i} className="px-3 py-2 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium text-gray-900 min-w-0 truncate">{f.pantalla}</span>
                <span className="text-xs text-gray-400 shrink-0">{f.hora}</span>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-xs text-gray-500 min-w-0 truncate" title={f.ruta}>{f.ruta}</span>
                {f.espera && <span className="text-xs text-gray-400 shrink-0">+{f.espera}</span>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
