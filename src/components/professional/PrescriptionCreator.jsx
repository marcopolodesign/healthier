import { useState, useEffect, useRef } from 'react'
import {
  MagnifyingGlass, X, CircleNotch, Check, Warning, Pill,
  PaperPlaneTilt, EnvelopeSimple, Plus, ArrowCounterClockwise,
  Info,
} from '@phosphor-icons/react'
import { heuralService } from '../../services/heuralService'
import { consultationsService } from '../../services/consultationsService'
import { toast } from '../Toast'

// ── Medication SNOMED search ──────────────────────────────────────────────────
function MedicationSearch({ onSelect }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const debounceRef = useRef(null)

  useEffect(() => {
    if (!query || query.length < 3) { setResults([]); return }
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      const { data } = await heuralService.searchMedication(query, 10)
      setSearching(false)
      setResults(data ?? [])
    }, 400)
    return () => clearTimeout(debounceRef.current)
  }, [query])

  function pick(item) {
    setQuery('')
    setResults([])
    onSelect({ code: String(item.conceptId), display: item.display, fsn: item.fsn })
  }

  return (
    <div className="relative">
      <div className="relative">
        <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Buscar medicamento…"
          className="form-input pl-9"
        />
        {searching && (
          <CircleNotch className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-brand animate-spin" />
        )}
      </div>
      {results.length > 0 && (
        <ul className="absolute z-20 w-full mt-1 bg-white border border-border-default rounded-xl shadow-lg max-h-52 overflow-y-auto">
          {results.map(item => (
            <li key={item.conceptId}>
              <button
                type="button"
                onClick={() => pick(item)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-brand-muted/40 transition-colors"
              >
                <span className="font-medium text-text-primary">{item.display}</span>
                {item.fsn && item.fsn !== item.display && (
                  <span className="block text-xs text-text-tertiary truncate">{item.fsn}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── Prescription status badge ─────────────────────────────────────────────────
const STATUS_MAP = {
  active:    { label: 'Activa',    cls: 'bg-green-100 text-green-700' },
  completed: { label: 'Completada', cls: 'bg-blue-100 text-blue-700' },
  cancelled: { label: 'Cancelada', cls: 'bg-red-100 text-red-700' },
  draft:     { label: 'Borrador',  cls: 'bg-gray-100 text-gray-600' },
  unknown:   { label: 'Desconocido', cls: 'bg-gray-100 text-gray-600' },
}
function StatusBadge({ status }) {
  const s = STATUS_MAP[status?.toLowerCase()] ?? STATUS_MAP.unknown
  return (
    <span className={`inline-flex items-center text-[11px] font-bold px-2 py-0.5 rounded-full ${s.cls}`}>
      {s.label}
    </span>
  )
}

// ── Previous prescription row ─────────────────────────────────────────────────
function PrescriptionRow({ rx, patientPhone, onResend }) {
  const [sendingWa, setSendingWa] = useState(false)
  const [sentWa, setSentWa] = useState(false)
  const [sendingEmail, setSendingEmail] = useState(false)
  const [sentEmail, setSentEmail] = useState(false)

  async function handleWhatsApp() {
    if (!patientPhone) { toast.warning('El paciente no tiene teléfono registrado'); return }
    setSendingWa(true)
    const { error } = await heuralService.sendPrescriptionWhatsApp(rx.id, patientPhone)
    setSendingWa(false)
    if (error) {
      toast.error(`No se pudo enviar por WhatsApp: ${error}`)
    } else {
      setSentWa(true)
      toast.success('Receta enviada por WhatsApp')
    }
  }

  async function handleEmail() {
    setSendingEmail(true)
    const { error } = await heuralService.sendPrescriptionEmail(rx.id)
    setSendingEmail(false)
    if (error) {
      toast.error(`No se pudo enviar por email: ${error}`)
    } else {
      setSentEmail(true)
      toast.success('Receta enviada por email')
    }
  }

  return (
    <div className="flex items-start gap-3 p-3 rounded-xl border border-border-default bg-bg-surface">
      <Pill className="h-4 w-4 text-brand shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-text-primary leading-tight">
          {rx.medicationDisplay || rx.medicationCode || '—'}
        </p>
        {rx.dosageText && (
          <p className="text-xs text-text-secondary mt-0.5">{rx.dosageText}</p>
        )}
        {rx.authoredOn && (
          <p className="text-[11px] text-text-tertiary mt-0.5">
            {new Date(rx.authoredOn).toLocaleDateString('es-AR', {
              day: 'numeric', month: 'short', year: 'numeric',
            })}
          </p>
        )}
      </div>
      <div className="flex flex-col items-end gap-1.5 shrink-0">
        <StatusBadge status={rx.status} />
        <div className="flex items-center gap-1">
          {onResend && (
            <>
              <button
                type="button"
                onClick={handleWhatsApp}
                disabled={sendingWa || sentWa}
                title="Reenviar por WhatsApp"
                className="p-1.5 rounded-lg text-text-tertiary hover:text-green-600 hover:bg-green-50 transition-colors disabled:opacity-50"
              >
                {sendingWa
                  ? <CircleNotch className="h-4 w-4 animate-spin" />
                  : sentWa
                  ? <Check className="h-4 w-4 text-green-600" />
                  : <PaperPlaneTilt className="h-4 w-4" />}
              </button>
              <button
                type="button"
                onClick={handleEmail}
                disabled={sendingEmail || sentEmail}
                title="Reenviar por email"
                className="p-1.5 rounded-lg text-text-tertiary hover:text-brand hover:bg-brand-muted transition-colors disabled:opacity-50"
              >
                {sendingEmail
                  ? <CircleNotch className="h-4 w-4 animate-spin" />
                  : sentEmail
                  ? <Check className="h-4 w-4 text-brand" />
                  : <EnvelopeSimple className="h-4 w-4" />}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────
/**
 * PrescriptionCreator
 *
 * Props:
 *   patientHeuralId  {string|null}  — Heural subjectId (profiles.heural_id)
 *   encounterId      {string|null}  — Heural encounter ID (consultations.heural_encounter_id)
 *   consultationId   {string}       — Supabase consultation UUID
 *   patientPhone     {string|null}  — E.164 phone for WhatsApp send
 *   patientEmail     {string|null}  — patient email (display only; Heural uses its own record)
 */
export default function PrescriptionCreator({
  patientHeuralId,
  encounterId,
  consultationId,
  patientPhone,
  patientEmail,
}) {
  // ── Form state ──────────────────────────────────────────────────────────────
  const [selectedMed, setSelectedMed] = useState(null)   // { code, display, fsn }
  const [dosageText, setDosageText] = useState('')
  const [indication, setIndication] = useState('')
  const [diagnosis, setDiagnosis] = useState('')
  const [priority, setPriority] = useState('ROUTINE')

  // ── Creation state ──────────────────────────────────────────────────────────
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState(null)           // last created prescription
  const [createError, setCreateError] = useState(null)  // heural error string

  // ── Send state (for newly created prescription) ─────────────────────────────
  const [sendingWa, setSendingWa] = useState(false)
  const [sentWa, setSentWa] = useState(false)
  const [sendingEmail, setSendingEmail] = useState(false)
  const [sentEmail, setSentEmail] = useState(false)

  // ── Previous prescriptions for this encounter ───────────────────────────────
  const [prevRx, setPrevRx] = useState([])
  const [loadingPrev, setLoadingPrev] = useState(false)
  const [prevError, setPrevError] = useState(null)

  // ── Load previous prescriptions ─────────────────────────────────────────────
  useEffect(() => {
    if (!patientHeuralId || !encounterId) { setLoadingPrev(false); return }
    setLoadingPrev(true)
    heuralService.getMedicationRequests(patientHeuralId, encounterId)
      .then(({ data, error }) => {
        if (error) { setPrevError(error); return }
        setPrevRx(data ?? [])
      })
      .catch(err => setPrevError(err?.message ?? 'Error al cargar recetas'))
      .finally(() => setLoadingPrev(false))
  }, [patientHeuralId, encounterId])

  // ── Guards ──────────────────────────────────────────────────────────────────
  if (!patientHeuralId) {
    return (
      <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-700">
        <Info className="h-4 w-4 mt-0.5 shrink-0" />
        Paciente no sincronizado con Heural — no se pueden crear recetas digitales.
      </div>
    )
  }
  if (!encounterId) {
    return (
      <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-700">
        <Info className="h-4 w-4 mt-0.5 shrink-0" />
        Esta consulta no tiene un encuentro Heural vinculado — no se pueden crear recetas digitales.
      </div>
    )
  }

  // ── Handlers ────────────────────────────────────────────────────────────────
  function resetForm() {
    setSelectedMed(null)
    setDosageText('')
    setIndication('')
    setDiagnosis('')
    setPriority('ROUTINE')
    setCreated(null)
    setCreateError(null)
    setSentWa(false)
    setSentEmail(false)
  }

  async function handleCreate() {
    if (!selectedMed) { toast.warning('Seleccioná un medicamento'); return }
    if (!dosageText.trim()) { toast.warning('Ingresá la posología / dosis'); return }

    setCreating(true)
    setCreateError(null)

    const { data, error } = await heuralService.createPrescription({
      patientHeuralId,
      encounterId,
      medicationCode: selectedMed.code,
      medicationDisplay: selectedMed.display,
      dosageText: dosageText.trim(),
      priority,
      reasonCode: diagnosis.trim() || undefined,
      reasonDisplay: indication.trim() || undefined,
    })

    setCreating(false)

    if (error) {
      setCreateError(error)
      toast.error('No se pudo crear la receta en Heural')
      return
    }

    // SUCCESS: persist Heural ID in our DB
    setCreated(data)
    setPrevRx(prev => [data, ...prev])
    setSentWa(false)
    setSentEmail(false)
    toast.success('Receta creada correctamente')

    // Best-effort: store the Heural prescription ID on the consultation record
    if (data?.id && consultationId) {
      consultationsService.addPrescriptionHeuralId(consultationId, data.id)
        .catch(() => {
          // Non-critical — log silently; the Heural record is the source of truth
          console.warn('[PrescriptionCreator] Could not persist prescription_heural_id to Supabase')
        })
    }
  }

  async function handleSendWhatsApp() {
    if (!created?.id) return
    if (!patientPhone) { toast.warning('El paciente no tiene teléfono registrado'); return }
    setSendingWa(true)
    const { error } = await heuralService.sendPrescriptionWhatsApp(created.id, patientPhone)
    setSendingWa(false)
    if (error) {
      toast.error(`No se pudo enviar por WhatsApp: ${error}`)
    } else {
      setSentWa(true)
      toast.success('Receta enviada por WhatsApp')
    }
  }

  async function handleSendEmail() {
    if (!created?.id) return
    setSendingEmail(true)
    const { error } = await heuralService.sendPrescriptionEmail(created.id)
    setSendingEmail(false)
    if (error) {
      toast.error(`No se pudo enviar por email: ${error}`)
    } else {
      setSentEmail(true)
      toast.success('Receta enviada por email')
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">

      {/* ── Create prescription form ── */}
      {!created ? (
        <div className="space-y-4">
          {/* Step 1 — medication search */}
          {!selectedMed ? (
            <div>
              <label className="form-label text-xs">Medicamento</label>
              <MedicationSearch onSelect={setSelectedMed} />
            </div>
          ) : (
            /* Selected medication chip */
            <div>
              <label className="form-label text-xs">Medicamento</label>
              <div className="flex items-center gap-2 p-2.5 rounded-xl border border-brand/30 bg-brand-muted/30">
                <Pill className="h-4 w-4 text-brand shrink-0" />
                <span className="flex-1 text-sm font-medium text-text-primary leading-tight">
                  {selectedMed.display}
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedMed(null)}
                  className="p-0.5 rounded-lg text-text-tertiary hover:text-danger transition-colors"
                  title="Cambiar medicamento"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {/* Step 2 — prescription form (only shown once a medication is selected) */}
          {selectedMed && (
            <div className="space-y-3">
              <div>
                <label className="form-label text-xs">
                  Posología / dosis <span className="text-danger">*</span>
                </label>
                <textarea
                  value={dosageText}
                  onChange={e => setDosageText(e.target.value)}
                  placeholder="Ej: 1 comprimido cada 8 horas por 7 días"
                  rows={2}
                  className="form-textarea resize-none"
                />
              </div>
              <div>
                <label className="form-label text-xs">Indicación (opcional)</label>
                <textarea
                  value={indication}
                  onChange={e => setIndication(e.target.value)}
                  placeholder="Ej: Para infección urinaria"
                  rows={2}
                  className="form-textarea resize-none"
                />
              </div>
              <div>
                <label className="form-label text-xs">Diagnóstico relacionado (opcional)</label>
                <input
                  type="text"
                  value={diagnosis}
                  onChange={e => setDiagnosis(e.target.value)}
                  placeholder="Ej: Infección urinaria aguda"
                  className="form-input"
                />
              </div>
              <div>
                <label className="form-label text-xs">Prioridad</label>
                <select
                  value={priority}
                  onChange={e => setPriority(e.target.value)}
                  className="form-select"
                >
                  <option value="ROUTINE">Rutina</option>
                  <option value="URGENT">Urgente</option>
                </select>
              </div>

              {/* Error panel — never silently fail */}
              {createError && (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
                  <Warning className="h-4 w-4 mt-0.5 shrink-0" />
                  <div>
                    <p className="font-semibold">No se pudo crear la receta en Heural</p>
                    <p className="text-xs mt-0.5 font-mono break-all">{createError}</p>
                    <p className="text-xs mt-1 text-red-600">
                      La receta NO fue registrada en la historia clínica digital.
                      Podés registrarla manualmente en Órdenes y recetas (arriba).
                    </p>
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={handleCreate}
                disabled={creating}
                className="btn-primary w-full py-3 flex items-center justify-center gap-2"
              >
                {creating
                  ? <><CircleNotch className="h-4 w-4 animate-spin" /> Creando receta…</>
                  : <><Plus className="h-4 w-4" /> Crear receta</>}
              </button>
            </div>
          )}
        </div>
      ) : (
        /* ── Success panel ── */
        <div className="space-y-4">
          <div className="flex items-start gap-3 p-4 rounded-xl bg-green-50 border border-green-200">
            <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center shrink-0">
              <Check className="h-4 w-4 text-green-700" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-green-800">Receta creada</p>
              <p className="text-sm text-green-700 mt-0.5">{created.medicationDisplay}</p>
              {created.dosageText && (
                <p className="text-xs text-green-600 mt-0.5">{created.dosageText}</p>
              )}
              <p className="text-[11px] text-green-500 mt-1 font-mono">ID: {created.id}</p>
            </div>
          </div>

          {/* Send buttons */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={handleSendWhatsApp}
              disabled={sendingWa || sentWa || !patientPhone}
              className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border transition-colors
                ${sentWa
                  ? 'bg-green-100 text-green-700 border-green-200'
                  : patientPhone
                  ? 'bg-green-600 text-white border-green-600 hover:bg-green-700'
                  : 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                }`}
              title={!patientPhone ? 'El paciente no tiene teléfono registrado' : undefined}
            >
              {sendingWa
                ? <CircleNotch className="h-4 w-4 animate-spin" />
                : sentWa
                ? <Check className="h-4 w-4" />
                : <PaperPlaneTilt className="h-4 w-4" />}
              {sentWa ? 'Enviado' : 'WhatsApp'}
            </button>

            <button
              type="button"
              onClick={handleSendEmail}
              disabled={sendingEmail || sentEmail}
              className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border transition-colors
                ${sentEmail
                  ? 'bg-brand-muted text-brand border-brand/20'
                  : 'bg-white text-brand border-brand hover:bg-brand-muted/40'
                }`}
            >
              {sendingEmail
                ? <CircleNotch className="h-4 w-4 animate-spin" />
                : sentEmail
                ? <Check className="h-4 w-4" />
                : <EnvelopeSimple className="h-4 w-4" />}
              {sentEmail ? 'Enviado' : 'Email'}
            </button>
          </div>

          {/* Nueva receta */}
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

      {/* ── Previous prescriptions for this encounter ── */}
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

        {!loadingPrev && prevError && (
          <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-700">
            <Warning className="h-4 w-4 mt-0.5 shrink-0" />
            No se pudieron cargar las recetas anteriores: {prevError}
          </div>
        )}

        {!loadingPrev && !prevError && prevRx.length === 0 && (
          <p className="text-sm text-text-muted">Sin recetas creadas en esta consulta.</p>
        )}

        {!loadingPrev && prevRx.length > 0 && (
          <div className="space-y-2">
            {prevRx.map(rx => (
              <PrescriptionRow
                key={rx.id}
                rx={rx}
                patientPhone={patientPhone}
                onResend
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
