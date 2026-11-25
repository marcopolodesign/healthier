import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { filasDelRecorrido } from '../../lib/flowUrl'

/**
 * Recorrido de navegación de un usuario o de una consulta: por qué pantallas
 * pasó, a qué hora y cuánto tardó de una a la siguiente. Lo lee de la base por
 * id, así sirve igual desde la ficha del usuario que desde el detalle de una
 * consulta. `tabla`:
 *   · 'profiles' / 'consultations' — columna `flow_url` (migración 232): hasta
 *     el alta / hasta la reserva.
 *   · 'recorrido_paciente' — después del alta (migración 247), con web/app y
 *     los hitos del embudo (vio horarios, llegó al pago…). `id` = el paciente.
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
    // Después del alta (migración 247) es una fila por pantalla/hito; antes
    // del alta y en la consulta, la columna `flow_url`.
    const consulta = tabla === 'recorrido_paciente'
      ? supabase.from('recorrido_paciente').select('url, name, at, via, hito')
        .eq('user_id', id).order('at', { ascending: true }).order('id', { ascending: true })
        .then(({ data, error: err }) => ({ error: err, flow: data?.length ? data : null }))
      : supabase.from(tabla).select('flow_url').eq('id', id).maybeSingle()
        .then(({ data, error: err }) => ({ error: err, flow: data?.flow_url ?? null }))
    consulta.then(({ error: err, flow: f }) => {
      if (!vivo) return
      if (err) { setError(true); return }
      setFlow(f)
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
            <li key={i} className={`px-3 py-2 text-sm ${f.hito ? 'bg-brand/5' : ''}`}>
              <div className="flex items-baseline justify-between gap-3">
                <span className={`min-w-0 truncate ${f.hito ? 'font-semibold text-brand' : 'font-medium text-gray-900'}`}>{f.pantalla}</span>
                <span className="text-xs text-gray-400 shrink-0">
                  {f.via && <span className="mr-1.5 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-gray-500">{f.via}</span>}
                  {f.hora}
                </span>
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
