import { useState, useEffect } from 'react'
import {
  MagnifyingGlass, X, CircleNotch, Check, Pill,
  Plus, Copy, FilePdf, ArrowSquareOut, Warning, Info,
} from '@phosphor-icons/react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import MedicationSearch from './MedicationSearch'
import InfoTooltip from '../common/InfoTooltip'
import { logClinicalAccess } from '../../services/clinicalService'
import { faltanDatosProfesional, faltanDatosPaciente, listar } from '../../lib/datosReceta'
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

function PrescriptionRow({ rx, selectable, checked, onToggle }) {
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

  return (
    <div className={`rounded-xl border bg-bg-surface overflow-hidden transition-colors ${
      selectable && checked ? 'border-brand/50' : 'border-border-default'
    }`}>
      <div className="flex items-start gap-3 p-3">
        {/* El check decide qué medicamentos entran en la MISMA receta. Se
            marcan todos por defecto: el caso de un solo medicamento tiene que
            seguir siendo un clic. */}
        {selectable
          ? (
            <input
              type="checkbox"
              checked={checked}
              onChange={() => onToggle(rx.id)}
              aria-label={`Incluir ${rx.medication_name} en la receta`}
              className="w-4 h-4 rounded accent-brand shrink-0 mt-0.5 cursor-pointer"
            />
          )
          : <Pill className="h-4 w-4 text-brand shrink-0 mt-0.5" />}
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
    </div>
  )
}

// ── Add prescription form ──────────────────────────────────────────────────────

const EMPTY = {
  medicationName: '',
  // Medicamento elegido del catálogo de Innovamed. NULL = texto libre, que se
  // puede guardar en la historia clínica pero NO se puede emitir por RCTA.
  catalogo: null,
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

function AddPrescriptionForm({ patientId, encounterId, ensureEncounter, professionalId, profProfile, cobertura, onSaved, onCancel }) {
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)

  function set(key, val) { setForm(p => ({ ...p, [key]: val })) }

  const effectiveFrequency = form.frequency === '__custom__' ? form.customFrequency : form.frequency

  async function handleSave() {
    // El medicamento tiene que salir del vademécum de Innovamed, sin excepción
    // (decisión de Mateo, 2026-07-29). Antes se permitía texto libre "para la
    // historia clínica", y el resultado fue que 4 de las 6 medicaciones cargadas
    // quedaron sin `reg_no` y por lo tanto imposibles de recetar. Guardar algo que
    // no se puede emitir no es una media victoria: es una receta que el paciente
    // no va a recibir.
    if (!form.catalogo?.regNo) {
      toast.warning('Elegí el medicamento del vademécum — es lo que hace que la receta se pueda emitir')
      return
    }
    if (!form.dosage.trim()) { toast.warning('Ingresá la dosis'); return }

    setSaving(true)
    try {
      // El encuentro clínico se crea perezosamente, así que en una consulta
      // donde todavía no se escribió nada `encounterId` llega en null. La
      // columna lo acepta, y por eso hasta ahora se podían guardar recetas
      // huérfanas: no aparecían en la HC ni en esta misma lista, y `rcta-issue`
      // no podía leer la cobertura (la busca a través del encuentro).
      const eid = encounterId ?? (ensureEncounter ? await ensureEncounter() : null)

      const { data, error } = await supabase
        .from('clinical_medications')
        .insert({
          patient_id:                  patientId,
          encounter_id:                eid,
          professional_id:             professionalId,
          // La matrícula real, no un placeholder. Va desnormalizada en cada fila
          // clínica por Ley 26.529 Art. 12, y además es la que `rcta-issue`
          // manda como `medico.matricula` — el 'MN'/'0' que estaba hardcodeado
          // acá terminaba impreso en la receta electrónica.
          professional_license_type:   profProfile?.licenseType ?? 'MN',
          professional_license_number: profProfile?.licenseNumber ?? '0',
          medication_name:  form.medicationName.trim(),
          snomed_code:      null,
          // Siempre presente: `handleSave` no deja guardar sin elegir del catálogo.
          reg_no:           form.catalogo.regNo,
          presentacion:     form.catalogo?.presentacion ?? null,
          nombre_droga:     form.catalogo?.nombreDroga ?? null,
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
      // Asiento de auditoría — este insert no pasa por clinicalService, así que
      // el log se hace explícito acá (Ley 26.529 Art. 14 / Ley 25.326 Art. 9).
      logClinicalAccess({ resourceType: 'medication', resourceId: data.id, patientId, action: 'create' })
      toast.success('Medicación registrada — todavía falta emitir la receta')
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
          <label className="form-label text-xs">Medicamento (del vademécum) *</label>
          <MedicationSearch
            value={form.medicationName}
            selected={form.catalogo}
            cobertura={cobertura}
            onTextChange={v => setForm(p => ({ ...p, medicationName: v, catalogo: null }))}
            onSelect={m => setForm(p => m ? {
              ...p,
              catalogo: m,
              medicationName: m.nombreProducto,
              // La presentación del catálogo es la fuente de verdad: el mismo
              // producto tiene varias y la que se receta es la elegida.
              presentation: m.presentacion ?? p.presentation,
            } : { ...p, catalogo: null })}
          />
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
/**
 * @param {{cobertura?: {idFinanciador?: number, afiliado?: string}}} props
 *   `cobertura` es opcional: con ella, Innovamed además informa si cada
 *   medicamento tiene cobertura para ESE paciente.
 */
export default function PrescriptionCreator({ patientId, encounterId, ensureEncounter, professionalId, cobertura, profile, profProfile, paciente, onIssued }) {
  const [prescriptions, setPrescriptions] = useState([])
  const [loading, setLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const [issuing, setIssuing] = useState(false)
  // Qué medicamentos entran en la próxima receta. Innovamed acepta varios en
  // una sola (`medicamentos` es un array), y para el paciente es un único PDF
  // en vez de tres — así es como funciona una receta en papel.
  const [selectedIds, setSelectedIds] = useState([])

  const emitibles = prescriptions.filter(rx => rx.status === 'active' && rx.rcta_status !== 'issued')
  const seleccionados = selectedIds.filter(id => emitibles.some(rx => rx.id === id))

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

  // Todo lo emitible arranca marcado: recetar un solo medicamento tiene que
  // seguir siendo un clic, y desmarcar es más fácil que marcar.
  useEffect(() => {
    setSelectedIds(prescriptions
      .filter(rx => rx.status === 'active' && rx.rcta_status !== 'issued')
      .map(rx => rx.id))
  }, [prescriptions])

  const toggleSeleccion = id => setSelectedIds(prev =>
    prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
  )

  async function handleIssueRcta(medicationIds) {
    if (!medicationIds.length) return
    setIssuing(true)
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
          body: JSON.stringify({ medicationIds }),
        }
      )
      const result = await res.json()

      if (result.code === 'RCTA_NOT_CONFIGURED') {
        toast.warning('Credenciales RCTA no configuradas — contactá a Innovamed para obtener acceso institucional')
        return
      }
      if (!res.ok) {
        // La función devuelve un mensaje accionable en los 422 (falta el código
        // del vademécum, la obra social no salió del catálogo). Mostrarlo tal
        // cual: un "Error al emitir" genérico no le dice al profesional qué
        // arreglar.
        toast.error(result.error ?? 'Error al emitir la receta RCTA')
        return
      }

      toast.success(medicationIds.length > 1
        ? `Receta emitida con ${medicationIds.length} medicamentos`
        : 'Receta electrónica emitida')
      onIssued?.()
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
      setIssuing(false)
    }
  }

  // Preguntar si lo tenemos, y avisar solo si falta. La lista sale de probar
  // contra el sandbox campo por campo (ver src/lib/datosReceta.js), no de
  // suponer: mostrar un requisito que la API no exige es tan malo como omitir
  // uno que sí.
  const faltaProfesional = faltanDatosProfesional(profile, profProfile)
  const faltaPaciente = faltanDatosPaciente(paciente)

  return (
    <div className="space-y-3">
      {/* Se avisa ACÁ y no al apretar "emitir": descubrir que falta un dato
          recién cuando la API lo rechaza es la peor version de esto. */}
      {(faltaProfesional.length > 0 || faltaPaciente.length > 0) && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 space-y-1.5">
          <p className="text-xs font-bold text-amber-900">
            Falta información para emitir recetas electrónicas
          </p>
          {faltaProfesional.length > 0 && (
            <p className="text-[11px] text-amber-800">
              <strong>Tuyo:</strong> {listar(faltaProfesional)}.{' '}
              <Link to="/profesional/configuracion" className="underline font-semibold">Completar mi perfil</Link>
            </p>
          )}
          {faltaPaciente.length > 0 && (
            <p className="text-[11px] text-amber-800">
              <strong>Del paciente:</strong> {listar(faltaPaciente)}. Se lo pedimos automáticamente
              la próxima vez que entre a una consulta.
            </p>
          )}
          <p className="text-[11px] text-amber-700">
            Podés cargar la medicación igual — queda en la historia clínica, pero no se va a poder emitir.
          </p>
        </div>
      )}

      {loading && (
        <div className="space-y-2">
          {[1, 2].map(i => (
            <div key={i} className="h-16 rounded-xl border border-border-default bg-bg-surface animate-pulse" />
          ))}
        </div>
      )}

      {!loading && prescriptions.length > 0 && (
        <div className="space-y-2">
          {prescriptions.map(rx => {
            const selectable = emitibles.some(e => e.id === rx.id)
            return (
              <PrescriptionRow
                key={rx.id}
                rx={rx}
                selectable={selectable}
                checked={selectable && seleccionados.includes(rx.id)}
                onToggle={toggleSeleccion}
              />
            )
          })}
        </div>
      )}

      {/* Una sola acción para toda la receta, en vez de un botón por renglón:
          los marcados salen juntos en el MISMO documento. Es la acción principal
          de la pantalla (pedido de Mateo, 2026-07-29): guardar la medicación no
          le entrega nada al paciente, emitir sí. */}
      {!loading && emitibles.length > 0 && (
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleIssueRcta(seleccionados)}
              disabled={issuing || seleccionados.length === 0}
              className="btn-primary flex-1 py-3 flex items-center justify-center gap-2 text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {issuing
                ? <><CircleNotch className="h-4 w-4 animate-spin" /> Emitiendo…</>
                : <>
                    <ArrowSquareOut className="h-4 w-4" />
                    Emitir receta
                    {seleccionados.length > 1 && ` · ${seleccionados.length} medicamentos`}
                  </>}
            </button>
            <InfoTooltip
              title="Qué hace este botón"
              label="Manda la receta a RCTA (Innovamed) y devuelve el PDF firmado con validez legal, que le queda al paciente y sirve en la farmacia. Guardar la medicación sola no emite nada: sólo la deja en la historia clínica. Los medicamentos marcados salen juntos, en una sola receta con un único PDF."
            >
              <Info className="h-4 w-4 text-text-tertiary cursor-help" />
            </InfoTooltip>
          </div>
          {emitibles.length > 1 && (
            <p className="text-[11px] text-text-tertiary text-center">
              {seleccionados.length === 0
                ? 'Marcá al menos un medicamento.'
                : 'Los marcados van en la misma receta, con un único PDF.'}
            </p>
          )}
        </div>
      )}

      {!loading && prescriptions.length === 0 && !addOpen && (
        <p className="text-sm text-text-muted py-2">Sin medicaciones recetadas en esta consulta.</p>
      )}

      {addOpen ? (
        <AddPrescriptionForm
          patientId={patientId}
          encounterId={encounterId}
          ensureEncounter={ensureEncounter}
          professionalId={professionalId}
          profProfile={profProfile}
          cobertura={cobertura}
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
