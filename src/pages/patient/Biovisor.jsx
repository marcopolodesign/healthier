import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Pulse, Upload, Trash, TrendUp, TrendDown, Minus, CircleNotch, Sparkle, X } from '@phosphor-icons/react'
import { diagnosticReportService } from '../../services/diagnosticReportService'

const GEMINI_MODEL = 'gemini-2.5-flash-preview-05-20'
const GEMINI_KEY = import.meta.env.VITE_GEMINI_API_KEY ?? ''
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`

const SAGE = '#7CB38B'
const WARNING_COLOR = '#E4A853'
const ALERT_COLOR = '#D9534F'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getStatus(value, min, max) {
  if (value >= min && value <= max) return 'normal'
  const range = max - min
  const margin = range * 0.25
  if (value < min - margin || value > max + margin) return 'danger'
  return 'warning'
}

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
  const total = max - min
  const clamped = Math.min(Math.max(value, min), max)
  const pct = total > 0 ? ((clamped - min) / total) * 100 : 50
  return (
    <div className="relative h-2 rounded-full overflow-hidden" style={{ background: '#e5e7eb' }}>
      <div className="absolute left-0 top-0 h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
    </div>
  )
}

function ParameterRow({ param, previous }) {
  const status = getStatus(param.value, param.min, param.max)
  const color = statusColor(status)
  const prevVal = previous?.parameters?.find(p => p.id === param.id)?.value
  const badge = { normal: 'bg-green-100 text-green-700', warning: 'bg-amber-100 text-amber-700', danger: 'bg-red-100 text-red-700' }[status]
  const label = { normal: 'Normal', warning: 'Atención', danger: 'Alerta' }[status]
  return (
    <div className="p-3 rounded-xl border border-border-default bg-bg-surface space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Pulse size={14} style={{ color }} />
          <span className="text-sm font-medium text-text-primary">{param.name}</span>
        </div>
        <div className="flex items-center gap-2">
          <TrendIcon current={param.value} previous={prevVal} />
          <span className="text-sm font-bold" style={{ color }}>{param.value}</span>
          <span className="text-xs text-text-secondary">{param.unit}</span>
          <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${badge}`}>{label}</span>
        </div>
      </div>
      <MiniBar value={param.value} min={param.min} max={param.max} color={color} />
      <div className="flex justify-between text-xs text-text-secondary">
        <span>Mín: {param.min}</span>
        <span>Referencia</span>
        <span>Máx: {param.max}</span>
      </div>
    </div>
  )
}

function AiAnalysis({ parameters }) {
  const [analysis, setAnalysis] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function analyze() {
    if (!GEMINI_KEY) { setError('Configurá VITE_GEMINI_API_KEY para usar el análisis IA.'); return }
    setLoading(true); setError(''); setAnalysis('')
    try {
      const summary = parameters.map(p => `${p.name}: ${p.value} ${p.unit} (normal ${p.min}–${p.max})`).join('\n')
      const res = await fetch(GEMINI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `Sos un médico clínico. Analizá estos resultados de laboratorio y dá un resumen breve en español argentino. Sé claro y accesible, no alarmista. Máximo 4 oraciones.\n\n${summary}` }] }],
          generationConfig: { maxOutputTokens: 300 },
        }),
      })
      const json = await res.json()
      const text = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
      if (!text) throw new Error('Sin respuesta')
      setAnalysis(text)
    } catch { setError('Error al analizar. Intentá de nuevo.') }
    finally { setLoading(false) }
  }

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkle size={16} className="text-brand" />
          <span className="font-semibold text-text-primary text-sm">Análisis con IA</span>
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

// ─── Gemini OCR ───────────────────────────────────────────────────────────────

async function toBase64(file) {
  return new Promise((res, rej) => {
    const reader = new FileReader()
    reader.onload = () => res({ base64: reader.result.split(',')[1], mimeType: file.type || 'application/pdf' })
    reader.onerror = rej
    reader.readAsDataURL(file)
  })
}

async function ocrWithGemini(file) {
  const { base64, mimeType } = await toBase64(file)
  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          {
            text: `Analizá este análisis de sangre. Extraé los biomarcadores con sus valores, rangos de referencia y unidades.
Respondé ÚNICAMENTE con JSON válido siguiendo este esquema exacto (sin markdown, sin texto extra):
{"date":"YYYY-MM-DD","parameters":[{"id":"string","name":"string","value":0,"min":0,"max":0,"unit":"string"}]}
El campo "date" es la fecha del análisis (si no encontrás fecha, usá la fecha de hoy).
El campo "id" debe ser un string único (usá el índice numérico como string).`,
          },
          { inlineData: { mimeType, data: base64 } },
        ],
      }],
      generationConfig: { responseMimeType: 'application/json' },
    }),
  })
  if (!res.ok) throw new Error(`Gemini error ${res.status}`)
  const json = await res.json()
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
  const parsed = JSON.parse(text)
  return {
    date: parsed.date ?? new Date().toISOString().slice(0, 10),
    parameters: (parsed.parameters ?? []).map((p, i) => ({ ...p, id: p.id ?? String(i) })),
  }
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PatientBiovisor({ profile }) {
  const navigate = useNavigate()
  const fileInputRef = useRef(null)
  const [reports, setReports] = useState([])
  const [loadingReports, setLoadingReports] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [activeTab, setActiveTab] = useState('biovisor')
  const [error, setError] = useState('')

  const history = reports.map(r => ({ id: r.id, date: r.reportDate, parameters: r.parameters }))
  const latest = history[0] ?? null
  const previous = history[1] ?? null

  useEffect(() => {
    if (!profile?.id) return
    diagnosticReportService.getByPatient(profile.id)
      .then(data => setReports(data))
      .catch(() => {})
      .finally(() => setLoadingReports(false))
  }, [profile?.id])

  async function handleFile(file) {
    if (!file) return
    if (!GEMINI_KEY) {
      setError('La extracción automática requiere VITE_GEMINI_API_KEY. Contactá al administrador.')
      return
    }
    setUploading(true)
    setError('')
    try {
      const { date, parameters } = await ocrWithGemini(file)
      if (!parameters.length) {
        setError('No se encontraron parámetros en el documento. Intentá con otro archivo.')
        return
      }
      const saved = await diagnosticReportService.create({ patientId: profile.id, reportDate: date, parameters })
      setReports(prev => [saved, ...prev])
      setActiveTab('biovisor')
    } catch {
      setError('Error al analizar el documento. Verificá tu conexión e intentá de nuevo.')
    } finally {
      setUploading(false)
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

  const TABS = [
    { key: 'biovisor', label: 'Parámetros' },
    { key: 'historial', label: 'Historial' },
    { key: 'documentos', label: 'Subir' },
  ]

  return (
    <div className="absolute inset-0 flex flex-col bg-bg-primary">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-6 pb-4 border-b border-border-default bg-bg-surface">
        <button onClick={() => navigate(-1)} className="p-2 -ml-2 rounded-lg hover:bg-bg-muted">
          <ArrowLeft size={20} className="text-text-secondary" />
        </button>
        <div>
          <h1 className="font-bold text-text-primary">BioVisor AI</h1>
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

      {/* Upload progress */}
      {uploading && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-brand/10 border-b border-brand/20">
          <CircleNotch size={14} className="animate-spin text-brand" />
          <p className="text-xs text-brand font-medium">Analizando documento con IA…</p>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-border-default bg-bg-surface">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`flex-1 py-3 text-sm font-medium transition-colors border-b-2 ${
              activeTab === key ? 'border-brand text-brand' : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            {label}
          </button>
        ))}
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
      <div className="flex-1 overflow-y-auto pb-32">
        {/* Parámetros tab */}
        {activeTab === 'biovisor' && (
          <div className="p-4 space-y-4">
            {loadingReports ? (
              <div className="flex justify-center py-12">
                <CircleNotch size={28} className="animate-spin text-brand" />
              </div>
            ) : latest ? (
              <>
                <AiAnalysis parameters={latest.parameters} />
                <div className="space-y-3">
                  <p className="text-xs text-text-secondary font-medium uppercase tracking-wide">
                    Último estudio — {new Date(latest.date + 'T12:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })}
                  </p>
                  {latest.parameters.map(param => (
                    <ParameterRow key={param.id} param={param} previous={previous} />
                  ))}
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center text-center py-16 px-6 gap-4">
                <div className="w-16 h-16 rounded-2xl bg-brand/10 flex items-center justify-center">
                  <Pulse size={32} className="text-brand opacity-50" />
                </div>
                <div>
                  <p className="font-semibold text-text-primary">Sin análisis cargados</p>
                  <p className="text-sm text-text-secondary mt-1">Subí un PDF o foto de tus análisis de sangre para que BioVisor extraiga los parámetros automáticamente.</p>
                </div>
                <button onClick={() => setActiveTab('documentos')} className="btn-primary flex items-center gap-2 py-2.5 px-5">
                  <Upload size={16} />
                  Subir análisis
                </button>
              </div>
            )}
          </div>
        )}

        {/* Historial tab */}
        {activeTab === 'historial' && (
          <div className="p-4 space-y-4">
            {history.length === 0 ? (
              <div className="text-center py-12 text-text-secondary">
                <Pulse size={40} className="mx-auto mb-3 opacity-30" />
                <p className="font-medium">Sin historial aún</p>
                <p className="text-sm mt-1">Cargá al menos un análisis para ver la evolución de tus parámetros.</p>
              </div>
            ) : history.map((entry, i) => (
              <div key={entry.id} className="card p-4 space-y-2">
                <p className="font-semibold text-text-primary text-sm">
                  {new Date(entry.date + 'T12:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {entry.parameters.map(p => {
                    const status = getStatus(p.value, p.min, p.max)
                    const color = statusColor(status)
                    return (
                      <div key={p.id} className="flex items-center justify-between bg-bg-subtle rounded-lg px-3 py-2">
                        <span className="text-xs text-text-secondary truncate">{p.name}</span>
                        <span className="text-xs font-bold ml-2 shrink-0" style={{ color }}>{p.value} {p.unit}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Documentos tab */}
        {activeTab === 'documentos' && (
          <div className="p-4 space-y-4">
            {/* Upload card */}
            <div className="card p-4 space-y-3">
              <div>
                <p className="font-semibold text-text-primary text-sm">Analizar nuevo documento</p>
                <p className="text-xs text-text-secondary mt-1">BioVisor usa Gemini AI para extraer automáticamente los biomarcadores de tu análisis de sangre (PDF o imagen).</p>
              </div>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-brand/40 text-brand font-medium text-sm hover:bg-brand/5 transition-colors disabled:opacity-50"
              >
                {uploading ? <CircleNotch size={16} className="animate-spin" /> : <Upload size={16} />}
                {uploading ? 'Analizando…' : 'Seleccionar PDF o imagen'}
              </button>
            </div>

            {/* Reports list */}
            {reports.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-text-secondary font-medium uppercase tracking-wide">Documentos analizados ({reports.length})</p>
                {reports.map(r => (
                  <div key={r.id} className="card p-3 flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-brand/10 flex items-center justify-center shrink-0">
                      <Pulse size={18} className="text-brand" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-text-primary">
                        {new Date(r.reportDate + 'T12:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })}
                      </p>
                      <p className="text-xs text-text-secondary">{r.parameters.length} parámetros</p>
                    </div>
                    <button
                      onClick={() => handleDelete(r.id)}
                      className="p-1.5 rounded-lg text-text-muted hover:text-red-500 hover:bg-red-50 transition-colors"
                    >
                      <Trash size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
