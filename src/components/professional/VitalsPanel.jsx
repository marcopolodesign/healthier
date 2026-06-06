import { useState, useEffect } from 'react'
import {
  Plus, CircleNotch, Info, Check, X, Heart, Thermometer, Drop,
} from '@phosphor-icons/react'
import { heuralService } from '../../services/heuralService'
import { toast } from '../Toast'

// ── Vital definitions ─────────────────────────────────────────────────────────
// code matches what Heural returns as the `code` field in observations
const VITAL_DEFS = [
  {
    key: 'BLOOD_PRESSURE',
    label: 'Presión arterial',
    shortLabel: 'PA',
    unit: 'mmHg',
    icon: Heart,
    color: 'text-red-500',
    bg: 'bg-red-50',
    border: 'border-red-100',
    systolicKey: 'systolicPressure',
    diastolicKey: 'diastolicPressure',
    isBP: true,
  },
  {
    key: 'HEART_RATE',
    label: 'Frec. cardíaca',
    shortLabel: 'FC',
    unit: 'lpm',
    icon: Heart,
    color: 'text-pink-500',
    bg: 'bg-pink-50',
    border: 'border-pink-100',
    formKey: 'heartRate',
  },
  {
    key: 'SPO2',
    label: 'Saturación O₂',
    shortLabel: 'SpO₂',
    unit: '%',
    icon: Drop,
    color: 'text-blue-500',
    bg: 'bg-blue-50',
    border: 'border-blue-100',
    formKey: 'oxygenSaturation',
  },
  {
    key: 'WEIGHT',
    label: 'Peso',
    shortLabel: 'Peso',
    unit: 'kg',
    icon: null,
    color: 'text-green-600',
    bg: 'bg-green-50',
    border: 'border-green-100',
    formKey: 'weight',
  },
  {
    key: 'HEIGHT',
    label: 'Talla',
    shortLabel: 'Talla',
    unit: 'cm',
    icon: null,
    color: 'text-teal-600',
    bg: 'bg-teal-50',
    border: 'border-teal-100',
    formKey: 'height',
  },
  {
    key: 'TEMPERATURE',
    label: 'Temperatura',
    shortLabel: 'Temp.',
    unit: '°C',
    icon: Thermometer,
    color: 'text-orange-500',
    bg: 'bg-orange-50',
    border: 'border-orange-100',
    formKey: 'temperature',
  },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Extract a single numeric value from the observations list for a given vital code.
 * For blood pressure we look for SYSTOLIC / DIASTOLIC sub-codes.
 */
function extractVitalsFromObservations(observations) {
  if (!observations?.length) return {}
  const result = {}

  observations.forEach(obs => {
    const code = (obs.code ?? '').toUpperCase()
    const val = obs.value

    // Map known Heural codes to our formKeys
    const mapping = {
      HEART_RATE:   'heartRate',
      SPO2:         'oxygenSaturation',
      WEIGHT:       'weight',
      HEIGHT:       'height',
      TEMPERATURE:  'temperature',
      SYSTOLIC_BLOOD_PRESSURE:  'systolicPressure',
      DIASTOLIC_BLOOD_PRESSURE: 'diastolicPressure',
      // Some systems store BP as a single observation with compound values
      BLOOD_PRESSURE: null, // handled separately if needed
    }

    const formKey = mapping[code]
    if (formKey && val != null) result[formKey] = String(val)
  })

  return result
}

/**
 * Merge pre-consulta data (from heuralService.getPreconsulta) into form values.
 * Preconsulta keys match the formKey names directly.
 */
function mergePreconsulta(base, pre) {
  if (!pre) return base
  const keys = ['weight', 'height', 'systolicPressure', 'diastolicPressure', 'heartRate', 'oxygenSaturation']
  const merged = { ...base }
  keys.forEach(k => {
    if (!merged[k] && pre[k] != null) merged[k] = String(pre[k])
  })
  return merged
}

// ── Skeleton card ─────────────────────────────────────────────────────────────
function SkeletonCard() {
  return (
    <div className="p-3 rounded-xl border border-border-default animate-pulse space-y-1.5">
      <div className="w-12 h-3 bg-bg-muted rounded" />
      <div className="w-16 h-6 bg-bg-muted rounded" />
      <div className="w-8 h-3 bg-bg-muted rounded" />
    </div>
  )
}

// ── Vital card ────────────────────────────────────────────────────────────────
function VitalCard({ def, value, systolic, diastolic, fromPre }) {
  const Icon = def.icon

  const displayValue = def.isBP
    ? (systolic && diastolic ? `${systolic}/${diastolic}` : null)
    : value

  if (!displayValue) return null

  return (
    <div className={`p-3 rounded-xl border ${def.bg} ${def.border} space-y-0.5`}>
      <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide flex items-center gap-1">
        {Icon && <Icon className={`h-3 w-3 ${def.color}`} />}
        {def.shortLabel}
      </p>
      <p className={`text-xl font-bold ${def.color} leading-none`}>{displayValue}</p>
      <p className="text-[11px] text-text-tertiary">{def.unit}</p>
      {fromPre && (
        <span className="inline-block text-[10px] font-medium bg-white/70 border border-current/20 rounded-full px-1.5 py-0.5 text-text-secondary mt-0.5">
          Pre-consulta
        </span>
      )}
    </div>
  )
}

// ── Record vitals form ────────────────────────────────────────────────────────
function RecordVitalsForm({ patientHeuralId, encounterId, initialValues, onSaved, onCancel }) {
  const [form, setForm] = useState({
    systolicPressure: '',
    diastolicPressure: '',
    heartRate: '',
    oxygenSaturation: '',
    weight: '',
    height: '',
    temperature: '',
    ...initialValues,
  })
  const [saving, setSaving] = useState(false)

  function setField(key, val) {
    setForm(p => ({ ...p, [key]: val }))
  }

  async function handleSave() {
    // Build list of vitals to save (skip empty fields)
    const vitalsToSave = []

    if (form.systolicPressure)
      vitalsToSave.push({ code: 'SYSTOLIC_BLOOD_PRESSURE',  value: form.systolicPressure,  unit: 'mmHg' })
    if (form.diastolicPressure)
      vitalsToSave.push({ code: 'DIASTOLIC_BLOOD_PRESSURE', value: form.diastolicPressure, unit: 'mmHg' })
    if (form.heartRate)
      vitalsToSave.push({ code: 'HEART_RATE',               value: form.heartRate,          unit: 'lpm' })
    if (form.oxygenSaturation)
      vitalsToSave.push({ code: 'SPO2',                     value: form.oxygenSaturation,   unit: '%' })
    if (form.weight)
      vitalsToSave.push({ code: 'WEIGHT',                   value: form.weight,             unit: 'kg' })
    if (form.height)
      vitalsToSave.push({ code: 'HEIGHT',                   value: form.height,             unit: 'cm' })
    if (form.temperature)
      vitalsToSave.push({ code: 'TEMPERATURE',              value: form.temperature,        unit: '°C' })

    if (vitalsToSave.length === 0) {
      toast.warning('Completá al menos un signo vital')
      return
    }

    setSaving(true)
    const results = await Promise.all(
      vitalsToSave.map(v =>
        heuralService.createVital(patientHeuralId, encounterId, v.code, v.value, v.unit)
      )
    )
    setSaving(false)

    const errors = results.filter(r => r.error)
    if (errors.length === results.length) {
      toast.error('Error al guardar los signos vitales')
      return
    }
    if (errors.length > 0) {
      toast.warning(`${results.length - errors.length} signo(s) guardado(s), ${errors.length} con error`)
    } else {
      toast.success('Signos vitales registrados')
    }

    const saved = results.filter(r => r.data).map(r => r.data)
    onSaved(saved, form)
  }

  return (
    <div className="mt-4 pt-4 border-t border-border-default space-y-4">
      <p className="text-sm font-semibold text-text-primary">Registrar signos vitales</p>

      {/* BP row */}
      <div>
        <label className="form-label text-xs">Presión arterial (mmHg)</label>
        <div className="flex gap-2 items-center">
          <input
            type="number"
            min="0"
            value={form.systolicPressure}
            onChange={e => setField('systolicPressure', e.target.value)}
            placeholder="Sistólica"
            className="form-input"
          />
          <span className="text-text-tertiary font-bold">/</span>
          <input
            type="number"
            min="0"
            value={form.diastolicPressure}
            onChange={e => setField('diastolicPressure', e.target.value)}
            placeholder="Diastólica"
            className="form-input"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="form-label text-xs">FC (lpm)</label>
          <input
            type="number"
            min="0"
            value={form.heartRate}
            onChange={e => setField('heartRate', e.target.value)}
            placeholder="Ej: 72"
            className="form-input"
          />
        </div>
        <div>
          <label className="form-label text-xs">SpO₂ (%)</label>
          <input
            type="number"
            min="0"
            max="100"
            value={form.oxygenSaturation}
            onChange={e => setField('oxygenSaturation', e.target.value)}
            placeholder="Ej: 98"
            className="form-input"
          />
        </div>
        <div>
          <label className="form-label text-xs">Peso (kg)</label>
          <input
            type="number"
            min="0"
            step="0.1"
            value={form.weight}
            onChange={e => setField('weight', e.target.value)}
            placeholder="Ej: 70.5"
            className="form-input"
          />
        </div>
        <div>
          <label className="form-label text-xs">Talla (cm)</label>
          <input
            type="number"
            min="0"
            value={form.height}
            onChange={e => setField('height', e.target.value)}
            placeholder="Ej: 170"
            className="form-input"
          />
        </div>
        <div className="col-span-2">
          <label className="form-label text-xs">Temperatura (°C)</label>
          <input
            type="number"
            min="0"
            step="0.1"
            value={form.temperature}
            onChange={e => setField('temperature', e.target.value)}
            placeholder="Ej: 36.5"
            className="form-input"
          />
        </div>
      </div>

      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className="btn-secondary flex-1 py-2 flex items-center justify-center gap-1">
          <X className="h-4 w-4" /> Cancelar
        </button>
        <button type="button" onClick={handleSave} disabled={saving} className="btn-primary flex-1 py-2 flex items-center justify-center gap-1">
          {saving ? <CircleNotch className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          {saving ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────
/**
 * VitalsPanel
 * @param {{ patientHeuralId: string|null, encounterId: string|null, preconsulta?: object }} props
 *   preconsulta — optional pre-consulta object with weight, height, systolicPressure, etc.
 */
export default function VitalsPanel({ patientHeuralId, encounterId, preconsulta }) {
  const [observations, setObservations] = useState([])
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  // Which values came from pre-consulta (used for badges)
  const [preKeys, setPreKeys] = useState([])

  useEffect(() => {
    if (!patientHeuralId || !encounterId) { setLoading(false); return }
    heuralService.getObservations(patientHeuralId, encounterId)
      .then(({ data }) => setObservations(data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [patientHeuralId, encounterId])

  if (!patientHeuralId || !encounterId) {
    return (
      <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-700">
        <Info className="h-4 w-4 mt-0.5 shrink-0" />
        Historia clínica no disponible — sin ID Heural o encuentro vinculado.
      </div>
    )
  }

  // Derive form prefill values from observations + preconsulta
  const fromObservations = extractVitalsFromObservations(observations)
  const merged = mergePreconsulta(fromObservations, preconsulta)

  // Track which keys were injected from preconsulta (for badge)
  function openForm() {
    const pre = mergePreconsulta({}, preconsulta)
    const keys = Object.keys(pre).filter(k => !fromObservations[k] && pre[k])
    setPreKeys(keys)
    setFormOpen(true)
  }

  function handleSaved(_savedObs, formValues) {
    // Merge saved values back into our observations state as local display
    // The next real load would re-fetch from Heural, but this gives immediate feedback
    const fakeObservations = []
    const codeMap = {
      systolicPressure:  'SYSTOLIC_BLOOD_PRESSURE',
      diastolicPressure: 'DIASTOLIC_BLOOD_PRESSURE',
      heartRate:         'HEART_RATE',
      oxygenSaturation:  'SPO2',
      weight:            'WEIGHT',
      height:            'HEIGHT',
      temperature:       'TEMPERATURE',
    }
    Object.entries(formValues).forEach(([k, v]) => {
      if (v && codeMap[k]) {
        fakeObservations.push({ id: `local-${k}`, code: codeMap[k], value: v })
      }
    })
    setObservations(prev => {
      // Remove any existing same-code observations, then add new ones
      const existingCodes = new Set(fakeObservations.map(o => o.code))
      return [...prev.filter(o => !existingCodes.has(o.code?.toUpperCase())), ...fakeObservations]
    })
    setFormOpen(false)
  }

  const vitalsMap = extractVitalsFromObservations(observations)
  const hasAnyVital = Object.values(vitalsMap).some(Boolean)

  return (
    <div className="space-y-3">
      {/* Loading skeletons */}
      {loading && (
        <div className="grid grid-cols-3 gap-2">
          {[1,2,3,4,5,6].map(i => <SkeletonCard key={i} />)}
        </div>
      )}

      {/* Vitals grid */}
      {!loading && hasAnyVital && (
        <div className="grid grid-cols-3 gap-2">
          {VITAL_DEFS.map(def => {
            if (def.isBP) {
              const sys = vitalsMap.systolicPressure
              const dia = vitalsMap.diastolicPressure
              if (!sys && !dia) return null
              const fromPre = preKeys.includes('systolicPressure') || preKeys.includes('diastolicPressure')
              return <VitalCard key={def.key} def={def} systolic={sys} diastolic={dia} fromPre={fromPre} />
            }
            const val = vitalsMap[def.formKey]
            if (!val) return null
            return <VitalCard key={def.key} def={def} value={val} fromPre={preKeys.includes(def.formKey)} />
          })}
        </div>
      )}

      {!loading && !hasAnyVital && !formOpen && (
        <p className="text-sm text-text-muted py-2">Sin signos vitales registrados.</p>
      )}

      {/* Record form */}
      {formOpen ? (
        <RecordVitalsForm
          patientHeuralId={patientHeuralId}
          encounterId={encounterId}
          initialValues={merged}
          onSaved={handleSaved}
          onCancel={() => setFormOpen(false)}
        />
      ) : (
        !loading && (
          <button
            type="button"
            onClick={openForm}
            className="flex items-center gap-1.5 text-sm text-brand hover:underline mt-1"
          >
            <Plus className="h-4 w-4" />
            {hasAnyVital ? 'Actualizar signos vitales' : 'Registrar signos vitales'}
          </button>
        )
      )}
    </div>
  )
}
