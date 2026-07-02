import { useState, useEffect } from 'react'
import {
  MagnifyingGlass, X, CircleNotch, Check, Pill,
  Plus, ArrowCounterClockwise, Copy,
} from '@phosphor-icons/react'
import { supabase } from '../../lib/supabase'
import { clinicalService } from '../../services/clinicalService'
import { toast } from '../Toast'

// TODO: SNOMED terminology search when RCTA credentials available
function MedicationSearch({ value, onChange, placeholder }) {
  return (
    <div className="relative">
      <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary pointer-events-none" />
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder ?? 'Ej: Amoxicilina, Ibuprofeno…'}
        className="form-input pl-9"
      />
    </div>
  )
}

// ── Prescription status badge ─────────────────────────────────────────────────
const STATUS_MAP = {
  active:    { label: 'Activa',     cls: 'bg-green-100 text-green-700' },
  completed: { label: 'Completada', cls: 'bg-blue-100 text-blue-700' },
  cancelled: { label: 'Cancelada',  cls: 'bg-red-100 text-red-700' },
  draft:     { label: 'Borrador',   cls: 'bg-gray-100 text-gray-600' },
  unknown:   { label: 'Desconocida', cls: 'bg-gray-100 text-gray-600' },
}
function StatusBadge({ status }) {
  const s = STATUS_MAP[status?.toLowerCase()] ?? STATUS_MAP.unknown
  return (
    <span className={`inline-flex items-center text-[11px] font-bold px-2 py-0.5 rounded-full ${s.cls}`}>
      {s.label}
    </span>
  )
}

// ── Prescription row ──────────────────────────────────────────────────────────
function PrescriptionRow({ rx }) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    const text = [rx.medication_name, rx.dosage_text, rx.notes].filter(Boolean).join(' — ')
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const date = rx.created_at
    ? new Date(rx.created_at).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' })
    : null

  return (
    <div className="flex items-start gap-3 p-3 rounded-xl border border-border-default bg-bg-surface">
      <Pill className="h-4 w-4 text-brand shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-text-primary leading-tight">
          {rx.medication_name || '—'}
        </p>
        {rx.dosage_text && (
          <p className="text-xs text-text-secondary mt-0.5">{rx.dosage_text}</p>
        )}
        {rx.notes && (
          <p className="text-xs text-text-tertiary mt-0.5 italic">{rx.notes}</p>
        )}
        {date && (
          <p className="text-[11px] text-text-tertiary mt-0.5">{date}</p>
        )}
      </div>
      <div className="flex flex-col items-end gap-1.5 shrink-0">
        <StatusBadge status={rx.status} />
        <button
          type="button"
          onClick={handleCopy}
          title="Copiar receta"
          className="p-1.5 rounded-lg text-text-tertiary hover:text-brand hover:bg-brand-muted transition-colors"
        >
          {copied
            ? <Check className="h-4 w-4 text-brand" />
            : <Copy className="h-4 w-4" />}
        </button>
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────
/**
 * PrescriptionCreator
 *
 * Props:
 *   encounterId   {string|null}  — Supabase clinical_encounters UUID
 *   patientId     {string|null}  — Supabase patient UUID
 *   consultationId {string}      — Supabase consultation UUID (unused currently, reserved)
 */
export default function PrescriptionCreator({ encounterId, patientId, consultationId }) {
  const [form, setForm] = useState({
    medicationName: '',
    dosage: '',
    frequency: '',
    route: '',
    instructions: '',
    priority: 'ROUTINE',
  })

  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState(null)

  const [prevRx, setPrevRx] = useState([])
  const [loadingPrev, setLoadingPrev] = useState(false)

  function setField(key, val) {
    setForm(p => ({ ...p, [key]: val }))
  }

  useEffect(() => {
    if (!encounterId) { setLoadingPrev(false); return }
    setLoadingPrev(true)
    supabase
      .from('clinical_medications')
      .select('*')
      .eq('encounter_id', encounterId)
      .order('created_at', { ascending: false })
      .then(({ data }) => setPrevRx(data ?? []))
      .catch(() => {})
      .finally(() => setLoadingPrev(false))
  }, [encounterId])

  function resetForm() {
    setForm({ medicationName: '', dosage: '', frequency: '', route: '', instructions: '', priority: 'ROUTINE' })
    setCreated(null)
  }

  async function handleCreate() {
    if (!form.medicationName.trim()) { toast.warning('Ingresá el nombre del medicamento'); return }
    if (!form.dosage.trim()) { toast.warning('Ingresá la dosis'); return }

    setCreating(true)
    try {
      const saved = await clinicalService.addMedication(encounterId, {
        patientId,
        medicationName: form.medicationName.trim(),
        dosage: form.dosage.trim(),
        frequency: form.frequency.trim(),
        route: form.route.trim(),
        instructions: form.instructions.trim(),
        status: 'active',
      })
      setCreated(saved)
      // Add the raw DB record shape to prevRx for display
      setPrevRx(prev => [{
        id: saved.id,
        medication_name: form.medicationName.trim(),
        dosage_text: [form.dosage, form.frequency, form.route].filter(Boolean).join(' — '),
        notes: form.instructions.trim() || null,
        status: 'active',
        created_at: new Date().toISOString(),
      }, ...prev])
      toast.success('Receta registrada')
    } catch {
      toast.error('No se pudo registrar la receta')
    } finally {
      setCreating(false)
    }
  }

  function handleCopyCreated() {
    if (!created) return
    const dosageText = [form.dosage, form.frequency, form.route].filter(Boolean).join(' — ')
    const text = [form.medicationName, dosageText, form.instructions].filter(Boolean).join(' — ')
    navigator.clipboard.writeText(text).then(() => toast.success('Receta copiada al portapapeles'))
  }

  return (
    <div className="space-y-5">

      {/* ── Form ── */}
      {!created ? (
        <div className="space-y-3">
          <div>
            <label className="form-label text-xs">Medicamento</label>
            <MedicationSearch
              value={form.medicationName}
              onChange={v => setField('medicationName', v)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label text-xs">Dosis <span className="text-danger">*</span></label>
              <input
                type="text"
                value={form.dosage}
                onChange={e => setField('dosage', e.target.value)}
                placeholder="Ej: 500mg"
                className="form-input"
              />
            </div>
            <div>
              <label className="form-label text-xs">Frecuencia</label>
              <input
                type="text"
                value={form.frequency}
                onChange={e => setField('frequency', e.target.value)}
                placeholder="Ej: cada 8hs"
                className="form-input"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label text-xs">Vía</label>
              <input
                type="text"
                value={form.route}
                onChange={e => setField('route', e.target.value)}
                placeholder="Ej: oral"
                className="form-input"
              />
            </div>
            <div>
              <label className="form-label text-xs">Prioridad</label>
              <select
                value={form.priority}
                onChange={e => setField('priority', e.target.value)}
                className="form-select"
              >
                <option value="ROUTINE">Rutina</option>
                <option value="URGENT">Urgente</option>
              </select>
            </div>
          </div>

          <div>
            <label className="form-label text-xs">Indicaciones (opcional)</label>
            <textarea
              value={form.instructions}
              onChange={e => setField('instructions', e.target.value)}
              placeholder="Ej: Tomar con comida, por 7 días"
              rows={2}
              className="form-textarea resize-none"
            />
          </div>

          <button
            type="button"
            onClick={handleCreate}
            disabled={creating}
            className="btn-primary w-full py-3 flex items-center justify-center gap-2"
          >
            {creating
              ? <><CircleNotch className="h-4 w-4 animate-spin" /> Registrando…</>
              : <><Plus className="h-4 w-4" /> Registrar receta</>}
          </button>
        </div>
      ) : (
        /* ── Success ── */
        <div className="space-y-3">
          <div className="flex items-start gap-3 p-4 rounded-xl bg-green-50 border border-green-200">
            <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center shrink-0">
              <Check className="h-4 w-4 text-green-700" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-green-800">Receta registrada</p>
              <p className="text-sm text-green-700 mt-0.5">{form.medicationName}</p>
              {form.dosage && (
                <p className="text-xs text-green-600 mt-0.5">
                  {[form.dosage, form.frequency, form.route].filter(Boolean).join(' — ')}
                </p>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={handleCopyCreated}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border border-border-default bg-white text-text-primary hover:bg-bg-muted transition-colors"
          >
            <Copy className="h-4 w-4" /> Copiar receta
          </button>

          <button
            type="button"
            onClick={resetForm}
            className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-brand transition-colors"
          >
            <ArrowCounterClockwise className="h-4 w-4" />
            Crear otra receta
          </button>
        </div>
      )}

      {/* ── Previous prescriptions ── */}
      <div className="border-t border-border-default pt-4 space-y-2">
        <p className="text-xs font-semibold text-text-tertiary uppercase tracking-widest">
          Recetas de esta consulta
        </p>

        {loadingPrev && (
          <div className="space-y-2">
            {[1, 2].map(i => (
              <div key={i} className="h-16 bg-bg-surface rounded-xl animate-pulse" />
            ))}
          </div>
        )}

        {!loadingPrev && prevRx.length === 0 && (
          <p className="text-sm text-text-muted">Sin recetas registradas en esta consulta.</p>
        )}

        {!loadingPrev && prevRx.length > 0 && (
          <div className="space-y-2">
            {prevRx.map(rx => (
              <PrescriptionRow key={rx.id} rx={rx} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
