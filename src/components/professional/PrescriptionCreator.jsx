import { useState, useEffect } from 'react'
import {
  MagnifyingGlass, X, CircleNotch, Check, Pill,
  Plus, Copy, FilePdf, ArrowSquareOut, Warning,
} from '@phosphor-icons/react'
import { supabase } from '../../lib/supabase'
import { toast } from '../Toast'

// ── Constants ─────────────────────────────────────────────────────────────────

const PRESENTATIONS = [
  'Comprimido', 'Cápsula', 'Comprimido masticable', 'Comprimido efervescente',
  'Jarabe / Solución oral', 'Suspensión oral', 'Gotas orales',
  'Ampolla inyectable', 'Frasco inyectable', 'Solución para infusión IV',
  'Crema', 'Gel', 'Pomada', 'Loción', 'Parche transdérmico',
  'Spray nasal', 'Inhalador (MDI)', 'Nebulización',
  'Colirio', 'Gotas óticas', 'Supositorio', 'Óvulo vaginal', 'Otro',
]

const ROUTES = [
  { value: 'oral',        label: 'Oral (VO)' },
  { value: 'iv',          label: 'Intravenosa (IV)' },
  { value: 'im',          label: 'Intramuscular (IM)' },
  { value: 'sc',          label: 'Subcutánea (SC)' },
  { value: 'topica',      label: 'Tópica' },
  { value: 'inhalatoria', label: 'Inhalatoria' },
  { value: 'oftalmica',   label: 'Oftálmica' },
  { value: 'otica',       label: 'Ótica' },
  { value: 'rectal',      label: 'Rectal' },
  { value: 'vaginal',     label: 'Vaginal' },
  { value: 'sublingual',  label: 'Sublingual (SL)' },
]

const FREQUENCIES = [
  'Cada 6 horas', 'Cada 8 horas', 'Cada 12 horas', 'Cada 24 horas (1/día)',
  '2 veces por día', '3 veces por día', '4 veces por día',
  'En ayunas', 'Con las comidas', 'Antes de dormir',
  'Dosis única', 'A demanda (SOS)', 'Según indicación',
]

const STATUS_MAP = {
  active:    { label: 'Activa',     cls: 'bg-green-100 text-green-700' },
  completed: { label: 'Completada', cls: 'bg-blue-100 text-blue-700' },
  cancelled: { label: 'Cancelada',  cls: 'bg-red-100 text-red-700' },
  stopped:   { label: 'Suspendida', cls: 'bg-amber-100 text-amber-700' },
  draft:     { label: 'Borrador',   cls: 'bg-gray-100 text-gray-600' },
}

const RCTA_STATUS_MAP = {
  pending: { label: 'Emitiendo…',          cls: 'bg-amber-100 text-amber-700', spin: true },
  issued:  { label: 'RCTA emitida',        cls: 'bg-green-100 text-green-700', spin: false },
  error:   { label: 'Error RCTA',          cls: 'bg-red-100 text-red-700',     spin: false },
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const s = STATUS_MAP[status?.toLowerCase()] ?? STATUS_MAP.draft
  return (
    <span className={`inline-flex items-center text-[11px] font-bold px-2 py-0.5 rounded-full ${s.cls}`}>
      {s.label}
    </span>
  )
}

function RctaBadge({ rcta }) {
  if (!rcta) return null
  const s = RCTA_STATUS_MAP[rcta] ?? RCTA_STATUS_MAP.error
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full ${s.cls}`}>
      {s.spin && <CircleNotch className="h-3 w-3 animate-spin" />}
      {s.label}
    </span>
  )
}

// ── Prescription row ───────────────────────────────────────────────────────────

function PrescriptionRow({ rx, onIssueRcta, issuingId }) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    const parts = [
      rx.medication_name,
      rx.concentration,
      rx.presentation,
      rx.dosage_text,
      rx.frequency,
      rx.duration_days ? `${rx.duration_days} días` : null,
      rx.quantity,
      rx.notes,
    ].filter(Boolean)
    navigator.clipboard.writeText(parts.join(' — ')).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const date = rx.created_at
    ? new Date(rx.created_at).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' })
    : null

  const canIssue = rx.status === 'active' && rx.rcta_status !== 'issued'
  const issuing = issuingId === rx.id

  return (
    <div className="rounded-xl border border-border-default bg-bg-surface overflow-hidden">
      <div className="flex items-start gap-3 p-3">
        <Pill className="h-4 w-4 text-brand shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-text-primary leading-tight">
              {rx.medication_name}
              {rx.concentration && (
                <span className="font-normal text-text-secondary"> {rx.concentration}</span>
              )}
            </p>
            <StatusBadge status={rx.status} />
            {rx.rcta_status && <RctaBadge rcta={rx.rcta_status} />}
          </div>

          {(rx.presentation || rx.route) && (
            <p className="text-xs text-text-secondary mt-0.5">
              {[
                rx.presentation,
                rx.route ? (ROUTES.find(r => r.value === rx.route)?.label ?? rx.route) : null,
              ].filter(Boolean).join(' · ')}
            </p>
          )}
          {rx.dosage_text && (
            <p className="text-xs text-text-secondary mt-0.5">{rx.dosage_text}</p>
          )}
          {(rx.frequency || rx.duration_days || rx.quantity) && (
            <p className="text-xs text-text-tertiary mt-0.5">
              {[
                rx.frequency,
                rx.duration_days ? `${rx.duration_days} días` : null,
                rx.quantity,
              ].filter(Boolean).join(' · ')}
            </p>
          )}
          {rx.cie10_display && (
            <p className="text-[11px] text-text-tertiary mt-0.5">
              Dx: {rx.cie10_display}{rx.cie10_code ? ` (${rx.cie10_code})` : ''}
            </p>
          )}
          {rx.notes && (
            <p className="text-xs text-text-tertiary mt-0.5 italic">{rx.notes}</p>
          )}
          {date && <p className="text-[11px] text-text-tertiary mt-1">{date}</p>}
        </div>

        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <button type="button" onClick={handleCopy} title="Copiar"
            className="flex items-center gap-1 text-[11px] text-text-secondary hover:text-brand transition-colors px-2 py-1 rounded-lg hover:bg-brand/5">
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied ? 'Copiado' : 'Copiar'}
          </button>
          {rx.rcta_pdf_url && (
            <a href={rx.rcta_pdf_url} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1 text-[11px] text-brand hover:underline px-2 py-1">
              <FilePdf className="h-3 w-3" /> PDF
            </a>
          )}
        </div>
      </div>

      {canIssue && (
        <div className="px-3 pb-3">
          <button type="button" onClick={() => onIssueRcta(rx.id)} disabled={issuing}
            className="w-full flex items-center justify-center gap-2 text-xs font-semibold py-2 px-3 rounded-lg bg-brand/10 text-brand hover:bg-brand/20 transition-colors disabled:opacity-60">
            {issuing
              ? <><CircleNotch className="h-3.5 w-3.5 animate-spin" /> Emitiendo receta RCTA…</>
              : <><ArrowSquareOut className="h-3.5 w-3.5" /> Emitir receta electrónica (RCTA)</>}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Add prescription form ──────────────────────────────────────────────────────

const EMPTY = {
  medicationName: '',
  concentration: '',
  presentation: '',
  route: 'oral',
  dosage: '',
  frequency: '',
  customFrequency: '',
  durationDays: '',
  quantity: '',
  cie10Code: '',
  cie10Display: '',
  notes: '',
  isChronic: false,
  priority: 'routine',
}

function AddPrescriptionForm({ patientId, encounterId, professionalId, onSaved, onCancel }) {
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)

  function set(key, val) { setForm(p => ({ ...p, [key]: val })) }

  const effectiveFrequency = form.frequency === '__custom__' ? form.customFrequency : form.frequency

  async function handleSave() {
    if (!form.medicationName.trim()) { toast.warning('Ingresá el medicamento'); return }
    if (!form.dosage.trim()) { toast.warning('Ingresá la dosis'); return }

    setSaving(true)
    try {
      const { data, error } = await supabase
        .from('clinical_medications')
        .insert({
          patient_id:                  patientId,
          encounter_id:                encounterId,
          professional_id:             professionalId,
          professional_license_type:   'MN',
          professional_license_number: '0',
          medication_name:  form.medicationName.trim(),
          snomed_code:      null,
          concentration:    form.concentration.trim() || null,
          presentation:     form.presentation || null,
          route:            form.route || null,
          dosage_text:      form.dosage.trim(),
          frequency:        effectiveFrequency || null,
          duration_days:    form.durationDays ? parseInt(form.durationDays) : null,
          quantity:         form.quantity.trim() || null,
          cie10_code:       form.cie10Code.trim() || null,
          cie10_display:    form.cie10Display.trim() || null,
          notes:            form.notes.trim() || null,
          is_chronic:       form.isChronic,
          priority:         form.priority,
          status:           'active',
        })
        .select()
        .single()

      if (error) throw error
      toast.success('Medicación registrada')
      onSaved(data)
    } catch {
      toast.error('Error al guardar la medicación')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-4 pt-4 border-t border-border-default space-y-4">
      <p className="text-sm font-semibold text-text-primary">Nueva prescripción</p>

      {/* Medicamento + concentración */}
      <div className="grid grid-cols-2 gap-2">
        <div className="col-span-2 sm:col-span-1">
          <label className="form-label text-xs">Medicamento *</label>
          {/* TODO: SNOMED medication search when RCTA/Innovamed credentials available */}
          <div className="relative">
            <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary pointer-events-none" />
            <input type="text" value={form.medicationName}
              onChange={e => set('medicationName', e.target.value)}
              placeholder="Ej: Amoxicilina, Ibuprofeno…"
              className="form-input pl-9" />
          </div>
        </div>
        <div>
          <label className="form-label text-xs">Concentración</label>
          <input type="text" value={form.concentration}
            onChange={e => set('concentration', e.target.value)}
            placeholder="Ej: 500mg, 250mg/5ml"
            className="form-input" />
        </div>
      </div>

      {/* Presentación + vía */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="form-label text-xs">Presentación</label>
          <select className="form-select" value={form.presentation}
            onChange={e => set('presentation', e.target.value)}>
            <option value="">— Seleccionar —</option>
            {PRESENTATIONS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label className="form-label text-xs">Vía de administración</label>
          <select className="form-select" value={form.route}
            onChange={e => set('route', e.target.value)}>
            {ROUTES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
      </div>

      {/* Dosis */}
      <div>
        <label className="form-label text-xs">Dosis *</label>
        <input type="text" value={form.dosage}
          onChange={e => set('dosage', e.target.value)}
          placeholder="Ej: 1 comprimido, 5ml, 10mg/kg"
          className="form-input" />
      </div>

      {/* Frecuencia */}
      <div>
        <label className="form-label text-xs">Frecuencia</label>
        <select className="form-select" value={form.frequency}
          onChange={e => set('frequency', e.target.value)}>
          <option value="">— Seleccionar —</option>
          {FREQUENCIES.map(f => <option key={f} value={f}>{f}</option>)}
          <option value="__custom__">Otra (especificar)…</option>
        </select>
        {form.frequency === '__custom__' && (
          <input type="text" value={form.customFrequency}
            onChange={e => set('customFrequency', e.target.value)}
            placeholder="Ej: Cada 48 horas, lunes y jueves…"
            className="form-input mt-1.5" />
        )}
      </div>

      {/* Duración + cantidad */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="form-label text-xs">Duración (días)</label>
          <input type="number" min="1" value={form.durationDays}
            onChange={e => set('durationDays', e.target.value)}
            placeholder="Ej: 7, 30, 90"
            className="form-input" />
        </div>
        <div>
          <label className="form-label text-xs">Cantidad total</label>
          <input type="text" value={form.quantity}
            onChange={e => set('quantity', e.target.value)}
            placeholder="Ej: 30 comp., 1 frasco"
            className="form-input" />
        </div>
      </div>

      {/* Diagnóstico CIE-10 */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="form-label text-xs">Código CIE-10</label>
          <input type="text" value={form.cie10Code}
            onChange={e => set('cie10Code', e.target.value.toUpperCase())}
            placeholder="Ej: J06.9, N39.0"
            className="form-input font-mono" />
        </div>
        <div>
          <label className="form-label text-xs">Diagnóstico</label>
          <input type="text" value={form.cie10Display}
            onChange={e => set('cie10Display', e.target.value)}
            placeholder="Ej: Infección resp. aguda"
            className="form-input" />
        </div>
      </div>

      {/* Instrucciones */}
      <div>
        <label className="form-label text-xs">Instrucciones especiales</label>
        <textarea value={form.notes} onChange={e => set('notes', e.target.value)}
          placeholder="Ej: Tomar con alimentos. Evitar exposición solar."
          rows={2} className="form-textarea resize-none" />
      </div>

      {/* Prioridad + crónica */}
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <label className="form-label text-xs">Prioridad</label>
          <select className="form-select" value={form.priority}
            onChange={e => set('priority', e.target.value)}>
            <option value="routine">Rutina</option>
            <option value="urgent">Urgente</option>
          </select>
        </div>
        <label className="flex items-center gap-2 cursor-pointer mt-4">
          <input type="checkbox" checked={form.isChronic}
            onChange={e => set('isChronic', e.target.checked)}
            className="w-4 h-4 rounded accent-brand" />
          <span className="text-sm text-text-primary">Medicación crónica</span>
        </label>
      </div>

      {/* RCTA notice */}
      <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-700">
        <Warning className="h-4 w-4 shrink-0 mt-0.5" />
        <span>
          La receta se guarda en la HC. Para emitirla como{' '}
          <strong>receta electrónica válida (RCTA)</strong> usá el botón "Emitir receta RCTA" que
          aparece debajo de la receta guardada — requiere credenciales de Innovamed.
        </span>
      </div>

      {/* Buttons */}
      <div className="flex gap-2">
        <button type="button" onClick={onCancel}
          className="btn-secondary flex-1 py-2 flex items-center justify-center gap-1">
          <X className="h-4 w-4" /> Cancelar
        </button>
        <button type="button" onClick={handleSave} disabled={saving}
          className="btn-primary flex-1 py-2 flex items-center justify-center gap-1">
          {saving
            ? <><CircleNotch className="h-4 w-4 animate-spin" /> Guardando…</>
            : <><Check className="h-4 w-4" /> Guardar medicación</>}
        </button>
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────
/**
 * PrescriptionCreator
 * @param {{ patientId: string, encounterId: string, professionalId?: string }} props
 */
export default function PrescriptionCreator({ patientId, encounterId, professionalId }) {
  const [prescriptions, setPrescriptions] = useState([])
  const [loading, setLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const [issuingId, setIssuingId] = useState(null)

  useEffect(() => {
    if (!encounterId) { setLoading(false); return }
    supabase
      .from('clinical_medications')
      .select('*')
      .eq('encounter_id', encounterId)
      .order('created_at', { ascending: false })
      .then(({ data }) => setPrescriptions(data ?? []))
      .finally(() => setLoading(false))
  }, [encounterId])

  async function handleIssueRcta(medicationId) {
    setIssuingId(medicationId)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/rcta-issue`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({ medicationId }),
        }
      )
      const result = await res.json()

      if (result.code === 'RCTA_NOT_CONFIGURED') {
        toast.warning('Credenciales RCTA no configuradas — contactá a Innovamed para obtener acceso institucional')
        return
      }
      if (!res.ok) {
        toast.error('Error al emitir la receta RCTA')
        return
      }

      toast.success('Receta RCTA emitida correctamente')
    } catch {
      toast.error('Error al conectar con el servicio RCTA')
    } finally {
      // Refresh prescription list to pick up rcta_status, rcta_pdf_url
      const { data } = await supabase
        .from('clinical_medications')
        .select('*')
        .eq('encounter_id', encounterId)
        .order('created_at', { ascending: false })
      setPrescriptions(data ?? [])
      setIssuingId(null)
    }
  }

  return (
    <div className="space-y-3">
      {loading && (
        <div className="space-y-2">
          {[1, 2].map(i => (
            <div key={i} className="h-16 rounded-xl border border-border-default bg-bg-surface animate-pulse" />
          ))}
        </div>
      )}

      {!loading && prescriptions.length > 0 && (
        <div className="space-y-2">
          {prescriptions.map(rx => (
            <PrescriptionRow
              key={rx.id}
              rx={rx}
              onIssueRcta={handleIssueRcta}
              issuingId={issuingId}
            />
          ))}
        </div>
      )}

      {!loading && prescriptions.length === 0 && !addOpen && (
        <p className="text-sm text-text-muted py-2">Sin medicaciones recetadas en esta consulta.</p>
      )}

      {addOpen ? (
        <AddPrescriptionForm
          patientId={patientId}
          encounterId={encounterId}
          professionalId={professionalId}
          onSaved={newRx => {
            setPrescriptions(prev => [newRx, ...prev])
            setAddOpen(false)
          }}
          onCancel={() => setAddOpen(false)}
        />
      ) : (
        !loading && (
          <button type="button" onClick={() => setAddOpen(true)}
            className="flex items-center gap-1.5 text-sm text-brand hover:underline mt-1">
            <Plus className="h-4 w-4" /> Agregar medicación
          </button>
        )
      )}
    </div>
  )
}
