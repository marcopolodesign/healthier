import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Pulse, Upload, Trash, TrendUp, TrendDown, Minus, CircleNotch, Sparkle, X, FileArrowDown, CheckCircle } from '@phosphor-icons/react'
import { diagnosticReportService } from '../../services/diagnosticReportService'
import EstudioSearch from '../../components/patient/EstudioSearch'
import SignedDocLink from '../../components/SignedDocLink'
import {
  rangoDe, textoRango, estadoDe, ETIQUETA_ESTADO, BADGE_ESTADO,
  claveBiomarcador, estaAnalizado, ordenarPorFecha, ultimasMediciones, serieDe,
  fechaLarga, fechaCorta,
} from '../../lib/biomarcadores'

// Gemini se llama desde `biovisor-extract` (Edge Function), NO desde acá: la key
// vivía en `VITE_GEMINI_API_KEY`, o sea compilada dentro del bundle y pública.

const SAGE = '#7CB38B'
const WARNING_COLOR = '#E4A853'
const ALERT_COLOR = '#D9534F'

// ─── Helpers ──────────────────────────────────────────────────────────────────
//
// `rangoDe`, `textoRango`, `estadoDe` y la identidad de un biomarcador viven en
// `src/lib/biomarcadores.js`: la Historia Clínica del profesional lee la misma
// tabla y tenía su propia versión del criterio, que marcaba "Alerta" en rojo
// sobre rangos abiertos perfectamente normales.

function statusColor(status) {
  if (status === 'danger') return ALERT_COLOR
  if (status === 'warning') return WARNING_COLOR
  return SAGE
}

function TrendIcon({ current, previous }) {
  if (previous === undefined || previous === null) return <Minus size={14} color="#aaa" />
  if (current > previous) return <TrendUp size={14} color={WARNING_COLOR} />
  if (current < previous) return <TrendDown size={14} color={SAGE} />
  return <Minus size={14} color="#aaa" />
}

function MiniBar({ value, min, max, color }) {
  // Con rango abierto se dibuja una escala de referencia alrededor del único
  // extremo conocido: sin esto la barra quedaba siempre llena o siempre vacía.
  const desde = min != null ? min : 0
  const hasta = max != null ? max : (min != null ? min * 2 : value * 2) || 1
  const total = hasta - desde
  const clamped = Math.min(Math.max(value, desde), hasta)
  const pct = total > 0 ? ((clamped - desde) / total) * 100 : 50
  return (
    <div className="relative h-2 rounded-full overflow-hidden" style={{ background: '#e5e7eb' }}>
      <div className="absolute left-0 top-0 h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
    </div>
  )
}

/**
 * Una medición: el último valor conocido de un biomarcador.
 *
 * Recibe la medición completa (`ultimasMediciones`) y no un `param` suelto,
 * porque la comparación con el valor anterior tiene que ser contra la medición
 * previa DEL MISMO analito. Antes se buscaba `previous.parameters.find(p => p.id
 * === param.id)`, y ese `id` es el índice del parámetro dentro de su estudio: la
 * flecha de tendencia comparaba el 3er valor de un estudio contra el 3ro del
 * otro, que casi nunca es el mismo biomarcador.
 */
function ParameterRow({ medicion, onVerHistorial }) {
  const { param, anterior, fecha, esDelUltimoEstudio, studyType } = medicion
  const rango = rangoDe(param)
  const status = estadoDe(param)
  const color = statusColor(status)
  return (
    <button
      onClick={() => onVerHistorial?.(param.name)}
      className="w-full text-left p-3 rounded-xl border border-border-default bg-bg-surface space-y-2 hover:border-brand/40 transition-colors"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Pulse size={14} style={{ color }} />
          <span className="text-sm font-medium text-text-primary truncate">{param.name}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <TrendIcon current={param.value} previous={anterior?.value} />
          <span className="text-sm font-bold" style={{ color }}>{param.value}</span>
          <span className="text-xs text-text-secondary">{param.unit}</span>
          <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${BADGE_ESTADO[status]}`}>
            {ETIQUETA_ESTADO[status]}
          </span>
        </div>
      </div>
      <MiniBar value={param.value} min={rango.min} max={rango.max} color={color} />
      <div className="flex justify-between text-xs text-text-secondary gap-2">
        <span className="truncate">
          {/* De qué estudio salió. Sólo se aclara cuando NO es del último, que es
              justo el caso en que el paciente se preguntaría por qué sigue ahí:
              un valor de sangre que persiste después de subir uno de orina. */}
          {esDelUltimoEstudio
            ? 'Referencia'
            : `De tu ${studyType?.toLowerCase() || 'estudio'} del ${fechaCorta(fecha)}`}
        </span>
        <span className="shrink-0">{textoRango(rango)}</span>
      </div>
    </button>
  )
}

function AiAnalysis({ parameters }) {
  const [analysis, setAnalysis] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function analyze() {
    setLoading(true); setError(''); setAnalysis('')
    try {
      const texto = await diagnosticReportService.resumirParametros(parameters)
      setAnalysis(texto)
    } catch (err) {
      setError(err?.message || 'Error al analizar. Intentá de nuevo.')
    } finally { setLoading(false) }
  }

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkle size={16} className="text-brand" />
          <span className="font-semibold text-text-primary text-sm">Análisis</span>
        </div>
        <button onClick={analyze} disabled={loading} className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1">
          {loading ? <CircleNotch size={12} className="animate-spin" /> : <Sparkle size={12} />}
          Analizar
        </button>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      {analysis && <p className="text-sm text-text-secondary whitespace-pre-wrap">{analysis}</p>}
      {!analysis && !error && !loading && <p className="text-xs text-text-secondary">Presioná "Analizar" para obtener un resumen de tus resultados.</p>}
    </div>
  )
}

// ─── Historical Trend Chart ───────────────────────────────────────────────────

function HistoricalChart({ paramName, reports }) {
  // Por clave normalizada y no por `name` exacto: si un estudio dice "HDL
  // Colesterol" y el siguiente "Colesterol HDL", son el mismo analito y la serie
  // no se tiene que cortar al medio.
  const points = serieDe(reports, paramName).map(p => ({ date: p.fecha, value: p.value, min: p.min, max: p.max }))

  if (!points.length) return (
    <div className="flex flex-col items-center py-10 text-text-secondary">
      <Pulse size={32} className="opacity-20 mb-2" />
      <p className="text-xs">Sin datos para este parámetro</p>
    </div>
  )

  if (points.length === 1) {
    const p = points[0]
    const status = estadoDe(p)
    const color = statusColor(status)
    return (
      <div className="flex flex-col items-center py-8 gap-1">
        <span className="text-4xl font-bold" style={{ color }}>{p.value}</span>
        <span className="text-xs text-text-secondary">{p.date}</span>
        <span className="text-xs text-text-muted mt-1">Subí más análisis para ver la evolución</span>
      </div>
    )
  }

  const W = 320, H = 140
  const PAD = { top: 20, right: 16, bottom: 28, left: 36 }
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom

  // El rango va saneado: con un "≥ 40" el máximo llega en 0 y la banda verde de
  // referencia se dibujaba invertida, ocupando desde 0 hasta el mínimo.
  const ref = rangoDe(points[0])
  const allVals = points.map(p => p.value)
  const dataMin = Math.min(...allVals, ...(ref.min != null ? [ref.min] : []))
  const dataMax = Math.max(...allVals, ...(ref.max != null ? [ref.max] : []))
  const span = dataMax - dataMin || 1

  const xOf = i => PAD.left + (i / (points.length - 1)) * innerW
  const yOf = v => PAD.top + ((dataMax - v) / span) * innerH

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xOf(i).toFixed(1)} ${yOf(p.value).toFixed(1)}`).join(' ')
  const areaPath = `${linePath} L ${xOf(points.length - 1).toFixed(1)} ${(PAD.top + innerH).toFixed(1)} L ${xOf(0).toFixed(1)} ${(PAD.top + innerH).toFixed(1)} Z`
  const gradId = `grad-${paramName.replace(/[^a-z0-9]/gi, '-')}`

  const fmtDate = d => {
    const [, m, day] = d.split('-')
    return `${parseInt(day)} ${['','Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'][parseInt(m)]}`
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={SAGE} stopOpacity="0.3" />
          <stop offset="100%" stopColor={SAGE} stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* Banda de referencia. Con rango abierto se extiende hasta el borde del
          gráfico en vez de desaparecer o dibujarse al revés. */}
      {(() => {
        const arriba = yOf(ref.max != null ? ref.max : dataMax)
        const abajo = yOf(ref.min != null ? ref.min : dataMin)
        const alto = abajo - arriba
        if (!(alto > 0)) return null
        return <rect x={PAD.left} y={arriba.toFixed(1)} width={innerW} height={alto.toFixed(1)} fill={SAGE} fillOpacity="0.08" />
      })()}
      {/* Area */}
      <path d={areaPath} fill={`url(#${gradId})`} />
      {/* Line */}
      <path d={linePath} stroke={SAGE} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      {/* Dots + value labels */}
      {points.map((p, i) => {
        const c = statusColor(estadoDe(p))
        return (
          <g key={i}>
            <circle cx={xOf(i).toFixed(1)} cy={yOf(p.value).toFixed(1)} r="4" fill="white" stroke={c} strokeWidth="2" />
            <text x={xOf(i).toFixed(1)} y={(yOf(p.value) - 8).toFixed(1)} textAnchor="middle" fill={c} fontSize="9" fontWeight="600">{p.value}</text>
          </g>
        )
      })}
      {/* X date labels */}
      {points.map((p, i) => (
        <text key={i} x={xOf(i).toFixed(1)} y={H - 4} textAnchor="middle" fill="#9ca3af" fontSize="9">{fmtDate(p.date)}</text>
      ))}
      {/* Ref range labels */}
      <text x={PAD.left - 4} y={(yOf(refMax) + 4).toFixed(1)} textAnchor="end" fill="#9ca3af" fontSize="9">{refMax}</text>
      <text x={PAD.left - 4} y={(yOf(refMin) + 4).toFixed(1)} textAnchor="end" fill="#9ca3af" fontSize="9">{refMin}</text>
    </svg>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PatientBiovisor({ profile }) {
  const navigate = useNavigate()
  const fileInputRef = useRef(null)
  const [reports, setReports] = useState([])
  const [loadingReports, setLoadingReports] = useState(true)
  const [uploading, setUploading] = useState(false)
  // Porcentaje real de la subida (XHR), no una animación decorativa.
  const [progreso, setProgreso] = useState(0)
  const [analizandoId, setAnalizandoId] = useState(null)
  // El estudio que se acaba de subir, para confirmarlo y ofrecer el análisis.
  const [recienSubido, setRecienSubido] = useState(null)
  // Arranca en Subir: es lo que el paciente viene a hacer.
  const [activeTab, setActiveTab] = useState('subir')
  const [selectedParam, setSelectedParam] = useState('')
  // Qué estudio es. Se pregunta ANTES de subir: después de la extracción el
  // paciente ya está mirando los resultados y no vuelve a completar un campo.
  const [estudio, setEstudio] = useState({ nombre: '', codigo: null })
  const [error, setError] = useState('')

  // Los estudios se parten en dos listas, que es como el paciente los piensa:
  // los que subió y todavía nadie leyó, y los que ya tienen biomarcadores.
  const analizados = ordenarPorFecha(reports.filter(estaAnalizado))
  const sinAnalizar = ordenarPorFecha(reports.filter(r => !estaAnalizado(r)))

  /**
   * El último valor conocido de CADA biomarcador, no los parámetros del último
   * estudio. La diferencia aparece apenas hay dos tipos de estudio: con lo
   * anterior, subir un análisis de orina te borraba el colesterol de la
   * pantalla — no porque hubiera cambiado, sino porque el "último estudio"
   * pasaba a ser otro. Ver `ultimasMediciones` en `lib/biomarcadores.js`.
   */
  const mediciones = ultimasMediciones(reports)
  const nombresDeParametros = [...new Map(
    analizados.flatMap(r => r.parameters.map(p => [claveBiomarcador(p.name), p.name]))
  ).values()]
  const fechaUltimoAnalizado = analizados[0]?.reportDate ?? null
  const recienSubidoReport = reports.find(r => r.id === recienSubido) ?? null

  useEffect(() => {
    if (!profile?.id) return
    diagnosticReportService.getByPatient(profile.id)
      .then(data => {
        setReports(data)
        if (data.length > 0 && data[0].parameters.length > 0) {
          setSelectedParam(data[0].parameters[0].name)
        }
      })
      .catch(() => {})
      .finally(() => setLoadingReports(false))
  }, [profile?.id])

  /**
   * Subir es sólo subir.
   *
   * Antes elegir el archivo disparaba la extracción con IA en el mismo paso, y
   * si esa fallaba te quedabas sin nada — ni siquiera con el estudio guardado.
   * Son dos decisiones distintas: guardar el estudio en tu historia es gratis y
   * siempre lo querés; leerlo con IA es opcional y se pide aparte.
   */
  async function handleFile(file) {
    if (!file) return
    setUploading(true)
    setProgreso(0)
    setError('')
    setRecienSubido(null)
    try {
      const saved = await diagnosticReportService.subirEstudio({
        patientId: profile.id,
        file,
        studyType: estudio.nombre.trim() || null,
        practiceCode: estudio.codigo,
        onProgreso: setProgreso,
      })
      setReports(prev => [saved, ...prev])
      setRecienSubido(saved.id)
      setEstudio({ nombre: '', codigo: null })
    } catch (err) {
      setError(err?.message || 'No pudimos subir el estudio. Revisá tu conexión e intentá de nuevo.')
    } finally {
      setUploading(false)
      setProgreso(0)
    }
  }

  /** Segundo paso, siempre a pedido: leer el estudio con IA. */
  async function handleAnalizar(report) {
    setAnalizandoId(report.id)
    setError('')
    try {
      const actualizado = await diagnosticReportService.analizarEstudio(report)
      setReports(prev => prev.map(r => (r.id === actualizado.id ? actualizado : r)))
      if (actualizado.parameters?.length) setSelectedParam(actualizado.parameters[0].name)
      setRecienSubido(null)
      setActiveTab('parametros')
    } catch (err) {
      setError(err?.message || 'No pudimos analizar el estudio.')
    } finally {
      setAnalizandoId(null)
    }
  }

  async function handleDelete(id) {
    try {
      await diagnosticReportService.delete(id)
      setReports(prev => prev.filter(r => r.id !== id))
    } catch {
      setError('No se pudo eliminar el reporte.')
    }
  }

  // Orden = orden real del flujo: subís, después analizás y mirás los
  // parámetros, y el historial es para volver a lo viejo (Mateo, 2026-07-31).
  const TABS = [
    { key: 'subir', label: 'Subir' },
    { key: 'parametros', label: 'Parámetros' },
    { key: 'historial', label: 'Historial' },
  ]

  return (
    <div className="absolute inset-0 flex flex-col bg-bg-primary">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 patient-column pt-6 pb-4 border-b border-border-default bg-bg-surface">
        <button onClick={() => navigate(-1)} className="p-2 -ml-2 rounded-lg hover:bg-bg-muted">
          <ArrowLeft size={20} className="text-text-secondary" />
        </button>
        <div>
          <h1 className="font-bold text-text-primary">BioVisor</h1>
          <p className="text-xs text-text-secondary">Mis parámetros de salud</p>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center justify-between px-4 py-2.5 bg-red-50 border-b border-red-200">
          <p className="text-xs text-red-600 flex-1">{error}</p>
          <button onClick={() => setError('')} className="ml-3 text-red-400 hover:text-red-600">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Progreso real de la subida. Antes era un spinner con "Analizando
          documento…" y nada más: en un teléfono, subir un PDF tarda lo
          suficiente como para que una pantalla quieta se lea como colgada. */}
      {uploading && (
        <div className="px-4 py-2.5 bg-brand/10 border-b border-brand/20">
          <div className="patient-column">
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xs text-brand font-medium">Subiendo estudio…</p>
              <p className="text-xs text-brand font-semibold tabular-nums">{progreso}%</p>
            </div>
            <div className="h-1.5 bg-brand/20 rounded-full overflow-hidden">
              <div
                className="h-full bg-brand rounded-full transition-[width] duration-200"
                style={{ width: `${progreso}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Tabs — mismo submenú que el panel de la videoconsulta: alineado a la
          izquierda, con aire y tipografía más grande, en vez de tres pestañas
          repartiéndose el ancho (Mateo, 2026-07-31). */}
      <div className="border-b border-border-default bg-bg-surface">
        <div className="patient-column flex justify-start gap-6 px-4">
          {TABS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`py-4 text-[15px] transition-colors border-b-2 ${
                activeTab === key
                  ? 'border-brand text-brand font-semibold'
                  : 'border-transparent text-text-tertiary hover:text-text-secondary'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,image/*"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }}
      />

      {/* Content */}
      <div className="flex-1 overflow-y-auto pb-32 patient-column">
        {/* Parámetros tab */}
        {activeTab === 'parametros' && (
          <div className="p-4 space-y-4">
            {loadingReports ? (
              <div className="flex justify-center py-12">
                <CircleNotch size={28} className="animate-spin text-brand" />
              </div>
            ) : mediciones.length > 0 ? (
              <>
                <AiAnalysis parameters={mediciones.map(m => m.param)} />
                <div className="space-y-3">
                  <div>
                    <p className="text-xs text-text-secondary font-medium uppercase tracking-wide">
                      Tus biomarcadores ({mediciones.length})
                    </p>
                    <p className="text-xs text-text-tertiary mt-0.5">
                      El valor más reciente de cada uno. Último estudio analizado: {fechaLarga(fechaUltimoAnalizado)}.
                    </p>
                  </div>
                  {mediciones.map(m => (
                    <ParameterRow
                      key={m.clave}
                      medicion={m}
                      onVerHistorial={nombre => { setSelectedParam(nombre); setActiveTab('historial') }}
                    />
                  ))}
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center text-center py-16 px-6 gap-4">
                <div className="w-16 h-16 rounded-2xl bg-brand/10 flex items-center justify-center">
                  <Pulse size={32} className="text-brand opacity-50" />
                </div>
                <div>
                  <p className="font-semibold text-text-primary">
                    {reports.length ? 'Todavía no analizaste ningún estudio' : 'Sin estudios cargados'}
                  </p>
                  <p className="text-sm text-text-secondary mt-1">
                    {reports.length
                      ? 'Tenés estudios subidos. Analizá uno con IA para ver acá tus biomarcadores.'
                      : 'Subí un PDF o una foto de tu análisis de sangre. Después elegís si querés analizarlo con IA.'}
                  </p>
                </div>
                <button onClick={() => setActiveTab('subir')} className="btn-primary flex items-center gap-2 py-2.5 px-5">
                  <Upload size={16} />
                  {reports.length ? 'Ir a mis estudios' : 'Subir estudio'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Historial tab */}
        {activeTab === 'historial' && (
          <div className="p-4 space-y-4">
            {analizados.length === 0 ? (
              <div className="text-center py-12 text-text-secondary">
                <Pulse size={40} className="mx-auto mb-3 opacity-30" />
                <p className="font-medium">Sin historial aún</p>
                <p className="text-sm mt-1">Cargá al menos un análisis para ver la evolución de tus parámetros.</p>
              </div>
            ) : (
              <>
                {/* Parameter selector pills */}
                <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
                  {nombresDeParametros.map(name => (
                    <button
                      key={name}
                      onClick={() => setSelectedParam(name)}
                      className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors border ${
                        selectedParam === name
                          ? 'bg-brand text-white border-brand'
                          : 'bg-bg-surface text-text-secondary border-border-default hover:border-brand hover:text-brand'
                      }`}
                    >
                      {name}
                    </button>
                  ))}
                </div>

                {/* Trend chart */}
                {selectedParam && (
                  <div className="card p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-text-primary">{selectedParam}</p>
                      {(() => {
                        const serie = serieDe(reports, selectedParam)
                        const ultimo = serie[serie.length - 1]
                        if (!ultimo) return null
                        const status = estadoDe(ultimo)
                        const color = statusColor(status)
                        return (
                          <div className="flex items-center gap-2">
                            <span className="text-lg font-bold" style={{ color }}>{ultimo.value}</span>
                            <span className="text-xs text-text-secondary">{ultimo.unit}</span>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${BADGE_ESTADO[status]}`}>
                              {ETIQUETA_ESTADO[status]}
                            </span>
                          </div>
                        )
                      })()}
                    </div>
                    <HistoricalChart paramName={selectedParam} reports={reports} />
                    {(() => {
                      const serie = serieDe(reports, selectedParam)
                      const refPoint = serie[serie.length - 1]
                      if (!refPoint) return null
                      // `textoRango` y no `min – max` crudos: un "≥ 40" se leía
                      // como "40 – 0" abajo del gráfico.
                      return (
                        <p className="text-xs text-text-secondary text-center">
                          Rango de referencia: {textoRango(rangoDe(refPoint))} {refPoint.unit}
                        </p>
                      )
                    })()}
                  </div>
                )}

                {/* Studies list */}
                <p className="text-xs font-medium text-text-secondary uppercase tracking-wide">Estudios analizados ({analizados.length})</p>
                {analizados.map(entry => (
                  <div key={entry.id} className="card p-4 space-y-2">
                    <p className="font-semibold text-text-primary text-sm">
                      {entry.studyType || 'Análisis'}
                      <span className="font-normal text-text-secondary"> · {fechaLarga(entry.reportDate)}</span>
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      {entry.parameters.map(p => {
                        const status = estadoDe(p)
                        const color = statusColor(status)
                        const activo = claveBiomarcador(p.name) === claveBiomarcador(selectedParam)
                        return (
                          <button
                            key={p.id}
                            onClick={() => setSelectedParam(p.name)}
                            className={`flex items-center justify-between bg-bg-subtle rounded-lg px-3 py-2 text-left transition-colors ${activo ? 'ring-1 ring-brand' : ''}`}
                          >
                            <span className="text-xs text-text-secondary truncate">{p.name}</span>
                            <span className="text-xs font-bold ml-2 shrink-0" style={{ color }}>{p.value} {p.unit}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {/* Documentos tab */}
        {activeTab === 'subir' && (
          <div className="p-4 space-y-4">
            {/* Subida */}
            <div className="card p-4 space-y-3">
              <div>
                <p className="font-semibold text-text-primary text-[15px]">Subir un estudio</p>
                <p className="text-xs text-text-secondary mt-1">
                  Guardalo en tu historia clínica. Después, si querés, lo analizamos con IA para
                  extraer los biomarcadores.
                </p>
              </div>

              <div>
                <label className="form-label text-xs">
                  ¿Qué estudio es? <span className="normal-case font-normal text-text-tertiary">(opcional)</span>
                </label>
                <EstudioSearch value={estudio} onChange={setEstudio} disabled={uploading} />
              </div>

              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-brand/40 text-brand font-medium text-sm hover:bg-brand/5 transition-colors disabled:opacity-50"
              >
                {uploading ? <CircleNotch size={16} className="animate-spin" /> : <Upload size={16} />}
                {uploading ? `Subiendo… ${progreso}%` : 'Seleccionar PDF o imagen'}
              </button>
            </div>

            {/* Confirmación de la subida + oferta de análisis. Es el paso que
                antes no existía: el archivo se subía y la IA arrancaba sola. */}
            {recienSubidoReport && (
              <div className="card p-4 space-y-3 border-brand/40 bg-brand/5">
                <div className="flex items-start gap-3">
                  <CheckCircle size={20} weight="fill" className="text-brand shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="font-semibold text-text-primary text-sm">Estudio subido</p>
                    <p className="text-xs text-text-secondary mt-0.5">
                      Ya quedó guardado en tu historia y tu profesional puede verlo.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => handleAnalizar(recienSubidoReport)}
                  disabled={analizandoId === recienSubidoReport.id}
                  className="btn-primary w-full py-3 text-sm flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {analizandoId === recienSubidoReport.id
                    ? <><CircleNotch size={16} className="animate-spin" /> Analizando con IA…</>
                    : <><Sparkle size={16} weight="fill" /> Analizar parámetros con IA</>}
                </button>
              </div>
            )}

            {/* Dos listas, no una.
                "Subidos" son documentos guardados que todavía nadie leyó — es la
                bandeja de entrada, y donde caen los que el paciente sube desde
                Análisis en la Bóveda. "Analizados" ya aportan biomarcadores.
                Mezclados en "Mis estudios (N)" no se veía qué faltaba hacer. */}
            {sinAnalizar.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-text-secondary font-medium uppercase tracking-wide">
                  Documentos subidos ({sinAnalizar.length})
                </p>
                <p className="text-xs text-text-tertiary -mt-1">
                  Ya están guardados y tu profesional puede verlos. Analizalos para extraer los biomarcadores.
                </p>
                {sinAnalizar.map(r => (
                  <EstudioCard
                    key={r.id}
                    report={r}
                    resaltado={r.id === resaltado}
                    analizando={analizandoId === r.id}
                    onAnalizar={() => handleAnalizar(r)}
                    onBorrar={() => handleDelete(r.id)}
                  />
                ))}
              </div>
            )}

            {analizados.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-text-secondary font-medium uppercase tracking-wide">
                  Documentos analizados ({analizados.length})
                </p>
                {analizados.map(r => (
                  <EstudioCard
                    key={r.id}
                    report={r}
                    resaltado={r.id === resaltado}
                    onBorrar={() => handleDelete(r.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
