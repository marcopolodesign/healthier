import { useState, useEffect } from 'react'
import {
  Plus, X, CircleNotch, Warning, Info, MagnifyingGlass, Check,
} from '@phosphor-icons/react'
import { supabase } from '../../lib/supabase'
import { clinicalService } from '../../services/clinicalService'
import { toast } from '../Toast'

// ── Constants ──────────────────────────────────────────────────────────────────

const CATEGORY_LABELS = {
  MEDICATION:  { label: 'Medicamento', emoji: '💊', bg: 'bg-red-50',    text: 'text-red-700',    border: 'border-red-200' },
  FOOD:        { label: 'Alimento',    emoji: '🍎', bg: 'bg-amber-50',  text: 'text-amber-700',  border: 'border-amber-200' },
  ENVIRONMENT: { label: 'Ambiental',   emoji: '🌿', bg: 'bg-blue-50',   text: 'text-blue-700',   border: 'border-blue-200' },
  BIOLOGIC:    { label: 'Biológico',   emoji: '🧬', bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' },
}

const CRITICALITY_LABELS = {
  HIGH:            { label: 'Alta criticidad',  bg: 'bg-red-100',    text: 'text-red-700' },
  LOW:             { label: 'Baja criticidad',  bg: 'bg-green-100',  text: 'text-green-700' },
  UNABLE_TO_ASSESS:{ label: 'Sin evaluar',      bg: 'bg-gray-100',   text: 'text-gray-600' },
}

const STATUS_LABELS = {
  ACTIVE:   { label: 'Activa',   dot: 'bg-red-500' },
  INACTIVE: { label: 'Inactiva', dot: 'bg-gray-400' },
  RESOLVED: { label: 'Resuelta', dot: 'bg-green-500' },
}

// ── Skeleton row ──────────────────────────────────────────────────────────────
function SkeletonRow() {
  return (
    <div className="flex items-start gap-3 p-3 rounded-xl border border-border-default animate-pulse">
      <div className="w-16 h-5 bg-bg-muted rounded-full" />
      <div className="flex-1 space-y-1.5">
        <div className="w-40 h-4 bg-bg-muted rounded" />
        <div className="w-24 h-3 bg-bg-muted rounded" />
      </div>
      <div className="w-20 h-5 bg-bg-muted rounded-full" />
    </div>
  )
}

// ── Allergy row ───────────────────────────────────────────────────────────────
function AllergyRow({ allergy }) {
  // Supabase fields: substance, category, criticality, clinical_status, created_at
  const categoryKey = (allergy.category ?? 'MEDICATION').toUpperCase()
  const criticalityKey = (allergy.criticality ?? 'UNABLE_TO_ASSESS').toUpperCase()
  const statusKey = (allergy.clinical_status ?? 'ACTIVE').toUpperCase()

  const cat = CATEGORY_LABELS[categoryKey] ?? CATEGORY_LABELS.MEDICATION
  const crit = CRITICALITY_LABELS[criticalityKey] ?? CRITICALITY_LABELS.UNABLE_TO_ASSESS
  const status = STATUS_LABELS[statusKey] ?? STATUS_LABELS.ACTIVE
  const isHigh = criticalityKey === 'HIGH'

  return (
    <div className={`flex items-start gap-3 p-3 rounded-xl border transition-colors ${
      isHigh ? 'border-red-300 bg-red-50/40' : 'border-border-default bg-bg-surface'
    }`}>
      <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full shrink-0 mt-0.5 ${cat.bg} ${cat.text} border ${cat.border}`}>
        <span>{cat.emoji}</span> {cat.label}
      </span>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-text-primary leading-tight">
          {allergy.substance || '—'}
        </p>
        {allergy.created_at && (
          <p className="text-[11px] text-text-tertiary mt-0.5">
            {new Date(allergy.created_at).toLocaleDateString('es-AR', {
              day: 'numeric', month: 'short', year: 'numeric',
            })}
          </p>
        )}
      </div>

      <div className="flex flex-col items-end gap-1 shrink-0">
        <span className={`flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full ${crit.bg} ${crit.text}`}>
          {isHigh && <Warning className="h-3 w-3" />}
          {crit.label}
        </span>
        <span className="flex items-center gap-1 text-[11px] text-text-tertiary">
          <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
          {status.label}
        </span>
      </div>
    </div>
  )
}

// ── Add-allergy form ──────────────────────────────────────────────────────────
function AddAllergyForm({ patientId, encounterId, onSaved, onCancel }) {
  const [form, setForm] = useState({
    codeDisplay: '',
    category: 'MEDICATION',
    criticality: 'LOW',
    clinicalStatus: 'ACTIVE',
  })
  const [saving, setSaving] = useState(false)

  function setField(key, val) {
    setForm(p => ({ ...p, [key]: val }))
  }

  async function handleSave() {
    if (!form.codeDisplay.trim()) { toast.warning('Ingresá el nombre del alérgeno'); return }
    setSaving(true)
    try {
      const saved = await clinicalService.addAllergy(encounterId, {
        patientId,
        allergen: form.codeDisplay.trim(),
        allergyType: form.category,
        clinicalStatus: form.clinicalStatus,
        severity: form.criticality,
        reaction: '',
      })
      toast.success('Alergia registrada')
      onSaved(saved)
    } catch {
      toast.error('Error al guardar la alergia')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-4 pt-4 border-t border-border-default space-y-3">
      <p className="text-sm font-semibold text-text-primary">Nueva alergia</p>

      <div>
        <label className="form-label text-xs">Alérgeno</label>
        <div className="relative">
          <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary pointer-events-none" />
          <input
            type="text"
            value={form.codeDisplay}
            onChange={e => setField('codeDisplay', e.target.value)}
            placeholder={form.category === 'MEDICATION' ? 'Ej: Amoxicilina, Ibuprofeno…' : 'Ej: Mariscos, Polen de gramíneas…'}
            className="form-input pl-9"
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="form-label text-xs">Tipo</label>
          <select className="form-select" value={form.category} onChange={e => setField('category', e.target.value)}>
            <option value="MEDICATION">Medicamento</option>
            <option value="FOOD">Alimento</option>
            <option value="ENVIRONMENT">Ambiental</option>
            <option value="BIOLOGIC">Biológico</option>
          </select>
        </div>
        <div>
          <label className="form-label text-xs">Criticidad</label>
          <select className="form-select" value={form.criticality} onChange={e => setField('criticality', e.target.value)}>
            <option value="LOW">Baja</option>
            <option value="HIGH">Alta</option>
            <option value="UNABLE_TO_ASSESS">Sin evaluar</option>
          </select>
        </div>
        <div>
          <label className="form-label text-xs">Estado</label>
          <select className="form-select" value={form.clinicalStatus} onChange={e => setField('clinicalStatus', e.target.value)}>
            <option value="ACTIVE">Activa</option>
            <option value="INACTIVE">Inactiva</option>
            <option value="RESOLVED">Resuelta</option>
          </select>
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
 * AllergyPanel
 * @param {{ patientId: string|null, encounterId: string|null }} props
 */
export default function AllergyPanel({ patientId, encounterId, bloqueada = false }) {
  const [allergies, setAllergies] = useState([])
  const [loading, setLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)

  useEffect(() => {
    if (!patientId) { setLoading(false); return }
    supabase
      .from('clinical_allergies')
      .select('*')
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false })
      .then(({ data }) => setAllergies(data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [patientId])

  if (!patientId) {
    return (
      <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-700">
        <Info className="h-4 w-4 mt-0.5 shrink-0" />
        Paciente no identificado — no se pueden cargar alergias.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {loading && (
        <div className="space-y-2">
          <SkeletonRow />
          <SkeletonRow />
        </div>
      )}

      {!loading && allergies.length === 0 && !addOpen && (
        <p className="text-sm text-text-muted py-2">Sin alergias registradas.</p>
      )}

      {!loading && allergies.length > 0 && (
        <div className="space-y-2">
          {allergies.map(a => <AllergyRow key={a.id} allergy={a} />)}
        </div>
      )}

      {addOpen ? (
        <AddAllergyForm
          patientId={patientId}
          encounterId={encounterId}
          onSaved={newAllergy => {
            setAllergies(prev => [newAllergy, ...prev])
            setAddOpen(false)
          }}
          onCancel={() => setAddOpen(false)}
        />
      ) : (
        !loading && encounterId && !bloqueada && (
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="flex items-center gap-1.5 text-sm text-brand hover:underline mt-1"
          >
            <Plus className="h-4 w-4" /> Agregar alergia
          </button>
        )
      )}
    </div>
  )
}
