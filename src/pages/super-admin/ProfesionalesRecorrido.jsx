import { useState, useEffect, useMemo } from 'react'
import { MagnifyingGlass, Path, X, ArrowClockwise, Warning } from '@phosphor-icons/react'
import { supabase } from '../../lib/supabase'
import { toast } from '../../components/Toast'
import WhatsAppButton from '../../components/super-admin/WhatsAppButton'
import RecorridoProfesional from '../../components/super-admin/RecorridoProfesional'
import { professionalOnboardingService } from '../../services/professionalOnboardingService'
import {
  construirRecorrido, resumenRecorrido, formatearDuracion, etiquetaEvento,
  EVENT_META, ESTADO_META, STEP_LABELS,
} from '../../lib/recorridoProfesional'

/**
 * Recorrido de los profesionales — pedido de Mateo (2026-08-13):
 * "entender en dónde se quedaron, dónde retomaron y cuándo. Como si fuese un
 * timeline más que un funnel".
 *
 * El funnel de Prospectos contesta CUÁNTOS se frenan en cada paso; no contesta
 * cuándo se frenó cada uno ni si volvió. Esta vista pone a todos sobre un mismo
 * eje de tiempo real: cada fila es un profesional, cada punto un evento de su
 * bitácora (migración 112), y los huecos entre puntos son la parte importante.
 *
 * El eje es COMPARTIDO a propósito. Normalizar cada fila a su propio ancho hace
 * más lindas las barras y pierde lo único que no se puede ver de otra forma:
 * que varios se frenaron el mismo día.
 */

const RANGOS = [
  { id: '7',    label: '7 días',  dias: 7 },
  { id: '30',   label: '30 días', dias: 30 },
  { id: 'todo', label: 'Todo',    dias: null },
]

const FILTROS = [
  { id: 'todos',       label: 'Todos' },
  { id: 'enviaron',    label: 'Enviaron para verificar' },
  { id: 'no_enviaron', label: 'No enviaron' },
]

function getInitials(name) {
  if (!name) return '?'
  const parts = name.trim().split(' ').filter(Boolean)
  return parts.length === 1
    ? parts[0][0].toUpperCase()
    : (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

const fechaCorta = ts => new Date(ts).toLocaleDateString('es-AR', {
  day: '2-digit', month: '2-digit', timeZone: 'America/Argentina/Buenos_Aires',
})

const fechaHora = ts => new Date(ts).toLocaleString('es-AR', {
  day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  timeZone: 'America/Argentina/Buenos_Aires',
})

const DIA_MS = 86400000

/** Marcas del eje: por día si el rango es corto, si no por semana. */
function marcasDelEje(desde, hasta) {
  const span = hasta - desde
  const paso = span <= 12 * DIA_MS ? DIA_MS : span <= 70 * DIA_MS ? 7 * DIA_MS : 30 * DIA_MS
  const inicio = new Date(desde)
  inicio.setHours(0, 0, 0, 0)
  const marcas = []
  for (let t = inicio.getTime(); t <= hasta; t += paso) {
    if (t >= desde) marcas.push(t)
  }
  return marcas
}

function EstadoBadge({ estado }) {
  const meta = ESTADO_META[estado]
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${meta.cls}`}>{meta.label}</span>
}

function DetalleDrawer({ fila, onClose }) {
  const { profile: p, recorrido: r } = fila
  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-50 w-full max-w-md bg-white shadow-2xl flex flex-col h-full overflow-hidden">
        <div className="flex items-start gap-3 p-5 border-b border-gray-100">
          <div className="w-10 h-10 rounded-full bg-[#e8f0eb] text-[#7CB38B] flex items-center justify-center font-semibold shrink-0">
            {getInitials(p.full_name)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-gray-900 truncate">{p.full_name || '(sin nombre)'}</p>
            <p className="text-xs text-gray-400 truncate">{p.email}</p>
            <div className="mt-1.5 flex items-center gap-2">
              <EstadoBadge estado={r.estado} />
              <WhatsAppButton phone={p.phone} />
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 shrink-0">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Se registró</p>
              <p className="font-medium text-gray-800">{fechaHora(p.created_at)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Fuente</p>
              <p className="font-medium text-gray-800">{p.utm_source || '—'}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Tardó en enviar</p>
              <p className="font-medium text-gray-800">
                {r.tiempoHastaEnvioMs != null ? formatearDuracion(r.tiempoHastaEnvioMs) : 'No envió'}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-0.5">
                {r.estado === 'verificado' ? 'Revisión' : 'Esperando revisión'}
              </p>
              <p className="font-medium text-gray-800">
                {r.tiempoDeRevisionMs != null ? formatearDuracion(r.tiempoDeRevisionMs) : '—'}
              </p>
            </div>
          </div>

          {r.pausaMasLarga?.pausaMs > 0 && (
            <div className="rounded-xl border border-gray-200 px-4 py-3">
              <p className="text-xs font-medium text-gray-500 mb-1">La pausa más larga</p>
              <p className="text-sm text-gray-800">
                {formatearDuracion(r.pausaMasLarga.pausaMs)} sin actividad, hasta
                «{etiquetaEvento(r.pausaMasLarga)}» el {fechaHora(r.pausaMasLarga.ts)}
              </p>
            </div>
          )}

          <div>
            <p className="text-xs font-medium text-gray-500 mb-2">Recorrido</p>
            <RecorridoProfesional userId={p.id} pro={fila.pro} eventos={fila.eventos} />
          </div>

          <a href={`mailto:${p.email}`} className="btn-secondary text-sm inline-block">Escribir por email</a>
        </div>
      </div>
    </div>
  )
}

export default function SuperAdminProfesionalesRecorrido() {
  const [filas, setFilas] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filtro, setFiltro] = useState('todos')
  const [rango, setRango] = useState('30')
  const [seleccionada, setSeleccionada] = useState(null)

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    try {
      setLoading(true)
      const [profilesRes, legajosRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, email, full_name, phone, created_at, onboarding_step, utm_source, utm_campaign')
          .eq('role', 'professional')
          .order('created_at', { ascending: false }),
        supabase
          .from('professional_profiles')
          .select('user_id, submitted_at, verified_at, rejected_at, rejection_type, is_verified'),
      ])
      if (profilesRes.error) throw profilesRes.error
      if (legajosRes.error) throw legajosRes.error

      const profiles = profilesRes.data ?? []
      const legajoPorUsuario = new Map((legajosRes.data ?? []).map(l => [l.user_id, l]))
      const eventosPorUsuario = await professionalOnboardingService.listByUsers(profiles.map(p => p.id))

      const armadas = profiles.map(p => {
        const legajo = legajoPorUsuario.get(p.id)
        const pro = {
          createdAt: p.created_at,
          onboardingStep: p.onboarding_step,
          isVerified: !!legajo?.is_verified,
          submittedAt: legajo?.submitted_at ?? null,
        }
        const eventos = eventosPorUsuario.get(p.id) ?? []
        return { profile: p, pro, legajo, eventos, recorrido: construirRecorrido(eventos, pro) }
      })

      // Lo más reciente arriba: quien se movió hace 20 minutos importa más que
      // quien se registró hace tres semanas y no volvió.
      armadas.sort((a, b) => (b.recorrido.finMs ?? 0) - (a.recorrido.finMs ?? 0))
      setFilas(armadas)
    } catch (err) {
      console.error(err)
      toast.error(err.message || 'Error al cargar el recorrido.')
    } finally {
      setLoading(false)
    }
  }

  const conteos = useMemo(() => ({
    todos: filas.length,
    enviaron: filas.filter(f => f.recorrido.envio).length,
    no_enviaron: filas.filter(f => !f.recorrido.envio).length,
  }), [filas])

  const { visibles, desde, hasta, fueraDeRango } = useMemo(() => {
    const ahora = Date.now()
    const dias = RANGOS.find(r => r.id === rango)?.dias
    const q = search.trim().toLowerCase()

    const porFiltro = filas.filter(f => {
      if (filtro === 'enviaron' && !f.recorrido.envio) return false
      if (filtro === 'no_enviaron' && f.recorrido.envio) return false
      if (!q) return true
      return (f.profile.full_name || '').toLowerCase().includes(q)
        || (f.profile.email || '').toLowerCase().includes(q)
    })

    const limite = dias ? ahora - dias * DIA_MS : null
    // Una fila entra si TUVO actividad dentro del rango, aunque haya arrancado antes.
    const dentro = limite ? porFiltro.filter(f => (f.recorrido.finMs ?? 0) >= limite) : porFiltro

    const inicios = dentro.map(f => f.recorrido.inicioMs).filter(Boolean)
    const desdeCalc = limite != null
      ? Math.max(limite, Math.min(...(inicios.length ? inicios : [limite])))
      : Math.min(...(inicios.length ? inicios : [ahora - 7 * DIA_MS]))

    return {
      visibles: dentro,
      desde: desdeCalc,
      hasta: ahora,
      fueraDeRango: porFiltro.length - dentro.length,
    }
  }, [filas, filtro, search, rango])

  const marcas = marcasDelEje(desde, hasta)
  const span = Math.max(hasta - desde, 1)
  const pct = ts => `${Math.min(100, Math.max(0, ((ts - desde) / span) * 100))}%`

  // Métricas que el funnel no puede dar: tiempos, no conteos.
  const metricas = useMemo(() => {
    const enviaron = filas.filter(f => f.recorrido.tiempoHastaEnvioMs != null)
    const tiempos = enviaron.map(f => f.recorrido.tiempoHastaEnvioMs).sort((a, b) => a - b)
    const mediana = tiempos.length
      ? tiempos.length % 2
        ? tiempos[(tiempos.length - 1) / 2]
        : (tiempos[tiempos.length / 2 - 1] + tiempos[tiempos.length / 2]) / 2
      : null
    const esperando = filas.filter(f => f.recorrido.estado === 'esperando_verificacion')
    const esperaMax = esperando.reduce((max, f) => Math.max(max, f.recorrido.tiempoDeRevisionMs ?? 0), 0)
    return {
      enviaron: enviaron.length,
      mediana,
      frenados: filas.filter(f => f.recorrido.estado === 'abandonado').length,
      retomaron: filas.filter(f => f.recorrido.retomadas.length > 0).length,
      esperando: esperando.length,
      esperaMax,
    }
  }, [filas])

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Recorrido de profesionales</h1>
          <p className="text-sm text-gray-500 mt-1">
            {loading ? '…' : `${filas.length} altas sobre una misma línea de tiempo — dónde se frenaron y cuándo retomaron`}
          </p>
        </div>
        <Path size={32} className="text-brand mt-1" weight="duotone" />
      </div>

      {/* Métricas de tiempo — lo que el funnel de pasos no puede contestar */}
      {!loading && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="card p-4">
            <p className="text-2xl font-bold text-gray-900">{metricas.enviaron}</p>
            <p className="text-xs text-gray-500 mt-0.5">Enviaron para verificar</p>
          </div>
          <div className="card p-4">
            <p className="text-2xl font-bold text-gray-900">
              {metricas.mediana != null ? formatearDuracion(metricas.mediana) : '—'}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">Mediana de registro a envío</p>
          </div>
          <div className="card p-4">
            <p className="text-2xl font-bold text-gray-900">{metricas.retomaron}</p>
            <p className="text-xs text-gray-500 mt-0.5">Volvieron después de frenarse</p>
          </div>
          <div className="card p-4">
            <p className="text-2xl font-bold text-gray-900">{metricas.esperando}</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Esperando revisión
              {metricas.esperando > 0 && metricas.esperaMax > 0 && (
                <span className="block text-[11px] text-amber-600">
                  el más viejo hace {formatearDuracion(metricas.esperaMax)}
                </span>
              )}
            </p>
          </div>
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
        <div className="flex gap-1.5 flex-wrap">
          {FILTROS.map(f => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFiltro(f.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                filtro === f.id ? 'bg-brand text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {f.label} ({conteos[f.id]})
            </button>
          ))}
        </div>
        <div className="relative flex-1">
          <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar por nombre o email…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="form-input pl-9 w-full"
          />
        </div>
        <div className="flex gap-1.5">
          {RANGOS.map(r => (
            <button
              key={r.id}
              type="button"
              onClick={() => setRango(r.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                rango === r.id ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Línea de tiempo */}
      <div className="card p-4 overflow-x-auto">
        {loading ? (
          <div className="space-y-3">
            {[...Array(6)].map((_, i) => <div key={i} className="h-12 bg-gray-100 rounded animate-pulse" />)}
          </div>
        ) : visibles.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <MagnifyingGlass size={32} className="text-gray-300" />
            <p className="text-gray-400 text-sm">Nadie con actividad en este rango.</p>
          </div>
        ) : (
          <div className="min-w-[720px]">
            {/* Eje */}
            <div className="flex">
              <div className="w-52 shrink-0" />
              <div className="flex-1 border-b border-gray-200">
                <svg className="w-full h-5 overflow-visible" aria-hidden="true">
                  {marcas.map(t => (
                    <g key={t}>
                      <line x1={pct(t)} x2={pct(t)} y1="14" y2="20" className="stroke-gray-200" />
                      <text x={pct(t)} y="11" textAnchor="middle" className="fill-gray-400 text-[10px] tabular-nums">
                        {fechaCorta(t)}
                      </text>
                    </g>
                  ))}
                </svg>
              </div>
            </div>

            <div className="divide-y divide-gray-100">
              {visibles.map(fila => {
                const r = fila.recorrido
                const dentro = r.eventos.filter(e => e.ts >= desde)
                const vieneDeAntes = r.eventos.some(e => e.ts < desde)
                const inicioTramo = dentro[0]?.ts ?? desde
                const finTramo = dentro[dentro.length - 1]?.ts ?? inicioTramo
                return (
                  <button
                    key={fila.profile.id}
                    type="button"
                    onClick={() => setSeleccionada(fila)}
                    className="flex w-full text-left py-3 hover:bg-gray-50 transition-colors"
                  >
                    <div className="w-52 shrink-0 pr-3 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {fila.profile.full_name || '(sin nombre)'}
                      </p>
                      <div className="flex items-center gap-1.5 mt-1">
                        <EstadoBadge estado={r.estado} />
                        {r.retomadas.length > 0 && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-blue-600">
                            <ArrowClockwise className="h-3 w-3" weight="bold" />{r.retomadas.length}
                          </span>
                        )}
                        {r.estado === 'esperando_verificacion' && r.tiempoDeRevisionMs > 2 * DIA_MS && (
                          <Warning className="h-3.5 w-3.5 text-amber-500" weight="fill" />
                        )}
                      </div>
                    </div>

                    <div className="flex-1 min-w-0">
                      {/* Tramo recorrido. Los tramos con pausa larga van
                          punteados: es lo que se quiere ver de un vistazo. */}
                      <svg className="w-full h-5 overflow-visible">
                        {vieneDeAntes && (
                          <text x="0" y="14" className="fill-gray-300 text-[10px]">‹</text>
                        )}
                        <line
                          x1={pct(inicioTramo)} x2={pct(finTramo)} y1="10" y2="10"
                          className="stroke-gray-200"
                        />
                        {dentro.map((e, i) => {
                          const previo = dentro[i - 1]
                          if (!previo || !e.retomo) return null
                          return (
                            <line
                              key={`pausa-${e.id ?? e.ts}`}
                              x1={pct(previo.ts)} x2={pct(e.ts)} y1="10" y2="10"
                              strokeDasharray="2 3"
                              className="stroke-gray-300"
                            />
                          )
                        })}
                        {dentro.map(e => (
                          <circle
                            key={e.id ?? `${e.event}-${e.ts}`}
                            cx={pct(e.ts)} cy="10" r={e.retomo ? 5 : 3.5}
                            className={`${EVENT_META[e.event]?.fill ?? 'fill-gray-300'} stroke-white`}
                            strokeWidth="1.5"
                          >
                            <title>{`${etiquetaEvento(e)} — ${fechaHora(e.ts)}`}</title>
                          </circle>
                        ))}
                      </svg>
                      <p className="text-[11px] text-gray-400 mt-1 truncate">{resumenRecorrido(r)}</p>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {!loading && fueraDeRango > 0 && (
          <p className="text-[11px] text-gray-400 mt-3">
            {fueraDeRango} sin actividad en este rango — ampliá el rango para verlos.
          </p>
        )}
      </div>

      {/* Referencia de colores */}
      {!loading && visibles.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-gray-500">
          {['signup', 'wizard_opened', 'step_reached', 'submitted', 'verified', 'rejected'].map(ev => (
            <span key={ev} className="inline-flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${EVENT_META[ev].dot}`} />
              {EVENT_META[ev].label}
            </span>
          ))}
          <span className="text-gray-400">
            Los pasos del formulario son: {STEP_LABELS.join(' → ')}
          </span>
        </div>
      )}

      {seleccionada && <DetalleDrawer fila={seleccionada} onClose={() => setSeleccionada(null)} />}
    </div>
  )
}
