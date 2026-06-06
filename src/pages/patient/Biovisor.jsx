import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Pulse, Upload, Trash, TrendUp, TrendDown, Minus, CircleNotch, Sparkle } from '@phosphor-icons/react';

const GEMINI_MODEL = 'gemini-2.5-flash-preview-05-20'
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY ?? ''
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`

const SAGE = '#7CB38B'
const WARNING_COLOR = '#E4A853'
const ALERT_COLOR = '#D9534F'

const MOCK_HISTORY = [
  {
    id: 'h1',
    date: '2026-01-15',
    parameters: [
      { id: '1', name: 'Glucosa', value: 105, min: 70, max: 99, unit: 'mg/dL' },
      { id: '2', name: 'Colesterol Total', value: 240, min: 125, max: 200, unit: 'mg/dL' },
      { id: '3', name: 'Vitamina D', value: 22, min: 30, max: 100, unit: 'ng/mL' },
    ],
  },
  {
    id: 'h2',
    date: '2025-10-20',
    parameters: [
      { id: '1', name: 'Glucosa', value: 92, min: 70, max: 99, unit: 'mg/dL' },
      { id: '2', name: 'Colesterol Total', value: 210, min: 125, max: 200, unit: 'mg/dL' },
      { id: '3', name: 'Vitamina D', value: 18, min: 30, max: 100, unit: 'ng/mL' },
    ],
  },
]

function getStatus(value, min, max) {
  if (value < min || value > max) {
    const pct = value < min
      ? ((min - value) / min) * 100
      : ((value - max) / max) * 100
    return pct > 20 ? 'danger' : 'warning'
  }
  return 'normal'
}

function statusColor(status) {
  if (status === 'danger') return ALERT_COLOR
  if (status === 'warning') return WARNING_COLOR
  return SAGE
}

function TrendIcon({ current, previous }) {
  if (!previous) return <Minus size={14} color="#aaa" />
  if (current > previous) return <TrendUp size={14} color={WARNING_COLOR} />
  if (current < previous) return <TrendDown size={14} color={SAGE} />
  return <Minus size={14} color="#aaa" />
}

function MiniBar({ value, min, max, color }) {
  const total = max - min
  const clamped = Math.min(Math.max(value, min), max)
  const pct = ((clamped - min) / total) * 100

  return (
    <div className="relative h-2 rounded-full overflow-hidden" style={{ background: '#e5e7eb' }}>
      <div
        className="absolute left-0 top-0 h-full rounded-full transition-all"
        style={{ width: `${pct}%`, background: color }}
      />
    </div>
  )
}

function ParameterRow({ param, previous }) {
  const status = getStatus(param.value, param.min, param.max)
  const color = statusColor(status)
  const prevVal = previous?.parameters?.find(p => p.id === param.id)?.value

  const badge = {
    normal: 'bg-green-100 text-green-700',
    warning: 'bg-amber-100 text-amber-700',
    danger: 'bg-red-100 text-red-700',
  }[status]

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

function AiAnalysis({ history }) {
  const [analysis, setAnalysis] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function analyze() {
    if (!GEMINI_API_KEY) {
      setError('Clave de Gemini no configurada.')
      return
    }
    setLoading(true)
    setError('')
    setAnalysis('')
    try {
      const params = history[0]?.parameters ?? []
      const summary = params.map(p =>
        `${p.name}: ${p.value} ${p.unit} (normal ${p.min}–${p.max})`
      ).join('\n')

      const res = await fetch(GEMINI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `Sos un médico clínico. Analizá estos resultados de laboratorio de un paciente y dá un resumen breve en español argentino. Sé claro y accesible, no alarmista. Máximo 4 oraciones.\n\n${summary}`,
            }],
          }],
          generationConfig: { maxOutputTokens: 300 },
        }),
      })
      const json = await res.json()
      const text = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
      if (!text) throw new Error('Sin respuesta')
      setAnalysis(text)
    } catch {
      setError('Error al analizar. Intentá de nuevo.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkle size={16} className="text-brand" />
          <span className="font-semibold text-text-primary text-sm">Análisis con IA</span>
        </div>
        <button
          onClick={analyze}
          disabled={loading}
          className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1"
        >
          {loading ? <CircleNotch size={12} className="animate-spin" /> : <Sparkle size={12} />}
          Analizar
        </button>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      {analysis && <p className="text-sm text-text-secondary whitespace-pre-wrap">{analysis}</p>}
      {!analysis && !error && !loading && (
        <p className="text-xs text-text-secondary">Presioná "Analizar" para obtener un resumen de tus resultados.</p>
      )}
    </div>
  )
}

export default function PatientBiovisor() {
  const navigate = useNavigate()
  const [history, setHistory] = useState(MOCK_HISTORY)
  const [activeTab, setActiveTab] = useState('biovisor')

  const latest = history[0]
  const previous = history[1]

  return (
    <div className="absolute inset-0 flex flex-col bg-bg-primary">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-6 pb-4 border-b border-border-default bg-bg-surface">
        <button onClick={() => navigate(-1)} className="p-2 -ml-2 rounded-lg hover:bg-bg-muted">
          <ArrowLeft size={20} className="text-text-secondary" />
        </button>
        <div>
          <h1 className="font-bold text-text-primary">Biovisor</h1>
          <p className="text-xs text-text-secondary">Mis parámetros de salud</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border-default bg-bg-surface">
        {[
          { key: 'biovisor', label: 'Parámetros' },
          { key: 'historial', label: 'Historial' },
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`flex-1 py-3 text-sm font-medium transition-colors border-b-2 ${
              activeTab === key
                ? 'border-brand text-brand'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto pb-32">
        {activeTab === 'biovisor' && (
          <div className="p-4 space-y-4">
            <AiAnalysis history={history} />
            {latest ? (
              <div className="space-y-3">
                <p className="text-xs text-text-secondary font-medium uppercase tracking-wide">
                  Último estudio — {new Date(latest.date).toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })}
                </p>
                {latest.parameters.map(param => (
                  <ParameterRow key={param.id} param={param} previous={previous} />
                ))}
              </div>
            ) : (
              <div className="text-center py-10 text-text-secondary">
                <Pulse size={40} className="mx-auto mb-3 opacity-30" />
                <p className="font-medium">Sin estudios cargados</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'historial' && (
          <div className="p-4 space-y-4">
            {history.map((entry, i) => (
              <div key={entry.id} className="card p-4 space-y-2">
                <p className="font-semibold text-text-primary text-sm">
                  {new Date(entry.date).toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })}
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
      </div>
    </div>
  )
}
