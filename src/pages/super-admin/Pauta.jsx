import { useState, useEffect, useMemo } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { toast } from '../../components/Toast'
import MetricCard from '../../components/super-admin/MetricCard'
import { pautaService, PUBLICO } from '../../services/pautaService'

/**
 * Pauta (Mateo, 2026-10-27: "un funnel armado tipo lo que hicimos en TAG").
 * Gasto de Meta → registros → leads → consulta → pago, por público, con el
 * costo de cada etapa. Datos: `pautaService` (Meta por Edge Function, el resto
 * de la base). Diseño revisado por Felipe.
 */

const hoyAR = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' })
const menosDias = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`)
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}
const RANGOS = [
  { key: 'mes', label: 'Este mes', desde: (h) => `${h.slice(0, 8)}01` },
  { key: '30', label: 'Últimos 30 días', desde: (h) => menosDias(h, 29) },
  { key: 'todo', label: 'Desde el inicio', desde: () => '2026-08-01' },
]

let moneda = 'ARS'
const ars = (n) => (moneda === 'ARS' ? `$${Math.round(n).toLocaleString('es-AR')}` : `${moneda} ${Math.round(n).toLocaleString('es-AR')}`)
// A mano: el compacto de es-AR mezcla "k" y "K" según el número.
const compacto = (n) => {
  const corto = (v, suf) => `${v.toLocaleString('es-AR', { maximumFractionDigits: 1 })} ${suf}`
  if (n >= 1e6) return corto(n / 1e6, 'M')
  if (n >= 1e3) return corto(n / 1e3, 'k')
  return n.toLocaleString('es-AR')
}
const costo = (gasto, n) => (n > 0 ? ars(gasto / n) : '—')
const pct = (a, b) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '—')

const ETAPAS = {
  pacientes: [
    { key: 'impresiones', label: 'Impresiones', meta: true },
    { key: 'clics', label: 'Clics', meta: true },
    { key: 'visitas', label: 'Visitas', meta: true },
    { key: 'registros', label: 'Registros', cruce: true },
    { key: 'lead', label: 'Leads' },
    { key: 'consulta', label: 'Con consulta' },
    { key: 'pago', label: 'Pagaron' },
  ],
  profesionales: [
    { key: 'impresiones', label: 'Impresiones', meta: true },
    { key: 'clics', label: 'Clics', meta: true },
    { key: 'visitas', label: 'Visitas', meta: true },
    { key: 'registros', label: 'Registros', cruce: true },
    { key: 'legajo', label: 'Legajo enviado' },
    { key: 'verificado', label: 'Verificados' },
  ],
}

export default function SuperAdminPauta() {
  const [rango, setRango] = useState('mes')
  const [tab, setTab] = useState('pacientes')
  const [meta, setMeta] = useState(null)
  const [registros, setRegistros] = useState({ pacientes: [], profesionales: [] })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelado = false
    const hasta = hoyAR()
    const desde = RANGOS.find(r => r.key === rango).desde(hasta)
    setLoading(true)
    setMeta(null)
    // allSettled: si Meta falla, el embudo de la base se ve igual (y al revés).
    Promise.allSettled([
      pautaService.meta(desde, hasta),
      pautaService.registros('patient', desde, hasta),
      pautaService.registros('professional', desde, hasta),
    ]).then(([m, pac, pro]) => {
      if (cancelado) return
      if (m.status === 'fulfilled') { moneda = m.value.moneda || 'ARS'; setMeta(m.value) } else toast.error(`Meta: ${m.reason?.message || 'no respondió'}`)
      if (pac.status === 'rejected' || pro.status === 'rejected') toast.error((pac.reason || pro.reason)?.message || 'No se pudieron cargar los registros')
      setRegistros({
        pacientes: pac.status === 'fulfilled' ? pac.value : [],
        profesionales: pro.status === 'fulfilled' ? pro.value : [],
      })
      setLoading(false)
    })
    return () => { cancelado = true }
  }, [rango])

  const vista = useMemo(() => {
    if (loading) return null
    const { patron } = PUBLICO[tab]
    const anuncios = (meta?.anuncios ?? []).filter(a => patron.test(a.campana))
    const regs = registros[tab].filter(r => patron.test(r.utm_campaign))
    const sum = (arr, k) => arr.reduce((s, x) => s + (x[k] || 0), 0)
    const cuenta = (k) => regs.filter(r => r[k]).length
    const totales = {
      gasto: sum(anuncios, 'gasto'),
      impresiones: sum(anuncios, 'impresiones'),
      clics: sum(anuncios, 'clics'),
      visitas: sum(anuncios, 'visitas'),
      registros: regs.length,
      lead: cuenta('lead'), consulta: cuenta('consulta'), pago: cuenta('pago'),
      legajo: cuenta('legajo'), verificado: cuenta('verificado'),
    }
    // Por anuncio: el nombre del anuncio de Meta = utm_content del registro.
    const filas = new Map()
    for (const a of anuncios) {
      const f = filas.get(a.anuncio) ?? { anuncio: a.anuncio, gasto: 0, clics: 0, registros: 0, avance: 0 }
      f.gasto += a.gasto
      f.clics += a.clics
      filas.set(a.anuncio, f)
    }
    const clave = tab === 'pacientes' ? 'lead' : 'legajo'
    for (const r of regs) {
      const k = r.utm_content || null
      const f = filas.get(k) ?? { anuncio: k, gasto: 0, clics: 0, registros: 0, avance: 0 }
      f.registros += 1
      if (r[clave]) f.avance += 1
      filas.set(k, f)
    }
    const porAnuncio = [...filas.values()].sort((a, b) => (a.anuncio === null) - (b.anuncio === null) || b.gasto - a.gasto)
    return { totales, porAnuncio, clave }
  }, [meta, registros, tab, loading])

  // Gasto diario de toda la cuenta, mes en curso; los días que faltan, al promedio.
  const diario = useMemo(() => {
    if (!meta) return null
    const hoy = hoyAR()
    const [y, m] = hoy.split('-').map(Number)
    const diasMes = new Date(y, m, 0).getDate()
    const porDia = {}
    for (const d of meta.diario) porDia[d.fecha] = (porDia[d.fecha] || 0) + d.gasto
    const diaHoy = Number(hoy.slice(8, 10))
    const gastado = Object.values(porDia).reduce((s, x) => s + x, 0)
    // El promedio sale de los días cerrados: hoy todavía no terminó.
    const cerrados = gastado - (porDia[hoy] || 0)
    const promedio = diaHoy > 1 ? cerrados / (diaHoy - 1) : gastado
    const datos = Array.from({ length: diasMes }, (_, i) => {
      const fecha = `${hoy.slice(0, 8)}${String(i + 1).padStart(2, '0')}`
      const futuro = i + 1 > diaHoy
      return { dia: i + 1, gasto: futuro ? promedio : (porDia[fecha] || 0), futuro }
    })
    return { datos, gastado, proyeccion: gastado + promedio * (diasMes - diaHoy) }
  }, [meta])

  const etapas = ETAPAS[tab]
  const t = vista?.totales

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title-lg">Pauta</h1>
          <p className="text-text-secondary mt-1">
            {meta ? `Meta · ${meta.moneda || 'ARS'} · actualizado ${new Date(meta.actualizado).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}` : '…'}
          </p>
        </div>
        <select value={rango} onChange={e => setRango(e.target.value)} className="form-input w-auto">
          {RANGOS.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
        </select>
      </div>

      <div className="flex gap-2">
        {Object.keys(ETAPAS).map(k => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              tab === k ? 'bg-text-primary text-white' : 'bg-white text-text-secondary border border-border hover:border-text-primary hover:text-text-primary'
            }`}
          >
            {k === 'pacientes' ? 'Pacientes' : 'Profesionales'}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard label="Gasto" value={loading || !t ? '—' : ars(t.gasto)} />
        <MetricCard label="Costo por registro" value={loading || !t ? '—' : costo(t.gasto, t.registros)} />
        <MetricCard label={tab === 'pacientes' ? 'Costo por lead' : 'Costo por legajo'} value={loading || !t ? '—' : costo(t.gasto, tab === 'pacientes' ? t.lead : t.legajo)} tone="ok" />
        <MetricCard label={tab === 'pacientes' ? 'Costo por consulta' : 'Costo por verificado'} value={loading || !t ? '—' : costo(t.gasto, tab === 'pacientes' ? t.consulta : t.verificado)} />
      </div>

      <div className="card">
        {loading || !t ? (
          <div className="h-20 bg-bg-surface rounded-lg animate-pulse" />
        ) : (
          <div className={`grid grid-cols-2 sm:grid-cols-4 gap-3 ${etapas.length === 7 ? 'lg:grid-cols-7' : 'lg:grid-cols-6'}`}>
            {etapas.map((e, i) => {
              const n = t[e.key]
              const prev = i > 0 ? t[etapas[i - 1].key] : null
              return (
                <div key={e.key} className="text-center py-2">
                  <p className="text-2xl font-semibold text-text-primary tabular-nums">{e.meta ? compacto(n) : n}</p>
                  <p className="text-xs text-text-secondary font-medium uppercase tracking-wide mt-1">{e.label}</p>
                  {/* El salto Meta → base no es comparable (otra fuente, puede pasar el 100 %). */}
                  <p className="text-sm text-text-tertiary tabular-nums mt-0.5">{i === 0 || e.cruce ? '—' : pct(n, prev)}</p>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="card">
        <h2 className="font-semibold text-text-primary mb-4">Por anuncio</h2>
        {loading || !vista ? (
          <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-10 bg-bg-surface rounded-lg animate-pulse" />)}</div>
        ) : vista.porAnuncio.length === 0 ? (
          <p className="text-sm text-text-tertiary py-6 text-center">Sin anuncios con gasto en este rango</p>
        ) : (
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr>
                  <th className="table-header">Anuncio</th>
                  <th className="table-header text-right">Gasto</th>
                  <th className="table-header text-right">Clics</th>
                  <th className="table-header text-right">Registros</th>
                  <th className="table-header text-right">{tab === 'pacientes' ? 'Leads' : 'Legajos'}</th>
                  <th className="table-header text-right">{tab === 'pacientes' ? 'Costo por lead' : 'Costo por legajo'}</th>
                </tr>
              </thead>
              <tbody>
                {vista.porAnuncio.map(f => (
                  <tr key={f.anuncio ?? '__sin'} className="table-row">
                    <td className="table-cell">{f.anuncio ?? <span className="text-text-tertiary">Sin anuncio</span>}</td>
                    <td className="table-cell text-right tabular-nums">{f.gasto ? ars(f.gasto) : '—'}</td>
                    <td className="table-cell text-right tabular-nums">{f.clics || '—'}</td>
                    <td className="table-cell text-right tabular-nums">{f.registros}</td>
                    <td className="table-cell text-right tabular-nums font-semibold">{f.avance}</td>
                    <td className="table-cell text-right tabular-nums">{f.gasto ? costo(f.gasto, f.avance) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Toda la cuenta y siempre el mes en curso: no depende de la pestaña ni del rango. */}
      <div className="space-y-4">
        <h2 className="font-semibold text-text-primary">Gasto diario — este mes</h2>
        <div className="grid grid-cols-2 gap-4">
          <MetricCard label="Gastado" value={diario ? ars(diario.gastado) : '—'} />
          <MetricCard label="Proyección mes" value={diario ? ars(diario.proyeccion) : '—'} />
        </div>
        <div className="card">
          {!diario ? (
            <div className="h-[220px] bg-bg-surface rounded-lg animate-pulse" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={diario.datos} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <XAxis dataKey="dia" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={compacto} />
                <Tooltip formatter={(v, _n, p) => [ars(v), p.payload.futuro ? 'Proyectado' : 'Gasto']} labelFormatter={d => `Día ${d}`} />
                <Bar dataKey="gasto" radius={[4, 4, 0, 0]}>
                  {diario.datos.map(d => (
                    <Cell key={d.dia} fill="var(--color-brand)" fillOpacity={d.futuro ? 0.2 : 1} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  )
}
