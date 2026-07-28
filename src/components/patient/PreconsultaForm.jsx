import { useMemo, useState } from 'react'
import { X, CircleNotch, ClipboardText, ArrowLeft, Check } from '@phosphor-icons/react'
import PatientSheet from './PatientSheet'
import { toast } from '../Toast'
import { supabase } from '../../lib/supabase'
import { consultationEventsService, CONSULTATION_EVENTS } from '../../services/consultationEventsService'
import { ALL_SYMPTOMS, MEDICATION_QUESTION, questionsFor } from '../../data/symptoms'

/**
 * PreconsultaForm
 *
 * Pre-consulta estructurada: el paciente elige UN síntoma de un catálogo
 * codificado en ICD-10 (ver `src/data/symptoms.js`) y después contesta preguntas
 * de calificación propias de ese síntoma. Nada de campos libres — antes eran
 * 3 textareas y lo que llegaba al profesional era texto suelto que no se podía
 * cruzar con la historia clínica ni medir.
 *
 * Props:
 *   isOpen         – boolean, controla visibilidad
 *   onClose        – dismiss sin enviar (ignorado cuando `required`)
 *   consultationId – string | null — UUID de la consulta; si es null se saltea el guardado
 *   onSubmitted    – se llama tras enviar (o saltear, si no es required)
 *   required       – el paciente no puede saltear ni cerrar, y un guardado fallido
 *                    mantiene el formulario abierto en vez de dejar pasar. Lo usa la
 *                    sala de espera: anunciar presencia convoca al profesional, así
 *                    que esto tiene que estar contestado ANTES.
 */
export default function PreconsultaForm({ isOpen, onClose, consultationId, onSubmitted, required = false }) {
  const [submitting, setSubmitting] = useState(false)
  const [saveError, setSaveError] = useState(null)

  const [step, setStep] = useState(0)            // 0 = elegir síntoma, 1 = preguntas, 2 = medicación
  const [symptomId, setSymptomId] = useState(null)
  const [freeText, setFreeText] = useState('')   // solo para "Otro motivo"
  const [answers, setAnswers] = useState({})     // { [questionId]: value | value[] }
  const [medication, setMedication] = useState({ value: null, detail: '' })

  const symptom = useMemo(() => ALL_SYMPTOMS.find(s => s.id === symptomId) ?? null, [symptomId])
  const questions = useMemo(() => (symptom ? questionsFor(symptom) : []), [symptom])

  const answeredAll = questions.every(q => {
    const v = answers[q.id]
    return q.type === 'multi' ? Array.isArray(v) && v.length > 0 : Boolean(v)
  })
  const symptomStepOk = Boolean(symptom) && (!symptom.freeText || freeText.trim().length > 0)
  const medicationOk =
    medication.value === 'no' ||
    (medication.value === 'si' && medication.detail.trim().length > 0)

  // ── Answer handlers ─────────────────────────────────────────────────────────
  const pickSingle = (qid, value) => setAnswers(prev => ({ ...prev, [qid]: value }))

  const toggleMulti = (question, option) => {
    setAnswers(prev => {
      const current = Array.isArray(prev[question.id]) ? prev[question.id] : []
      // "Ninguno de estos" se excluye mutuamente con el resto — marcarlo limpia
      // las demás, y marcar cualquier otra lo saca.
      if (option.exclusive) return { ...prev, [question.id]: [option.value] }
      const withoutExclusive = current.filter(v => {
        const opt = question.options.find(o => o.value === v)
        return !opt?.exclusive
      })
      const next = withoutExclusive.includes(option.value)
        ? withoutExclusive.filter(v => v !== option.value)
        : [...withoutExclusive, option.value]
      return { ...prev, [question.id]: next }
    })
  }

  // ── Payload ─────────────────────────────────────────────────────────────────
  const buildPayload = () => {
    const structured = questions.map(q => {
      const raw = answers[q.id]
      const values = Array.isArray(raw) ? raw : [raw]
      const picked = values.map(v => q.options.find(o => o.value === v)).filter(Boolean)
      return {
        question_id: q.id,
        question_label: q.label,
        values,
        labels: picked.map(o => o.label),
        red_flag: picked.some(o => o.redFlag),
      }
    })

    const medicationLabel =
      medication.value === 'si' ? medication.detail.trim() : 'No toma medicación'

    // `main_complaint` / `symptoms` / `current_medications` se siguen escribiendo
    // derivados a propósito: el panel del profesional (PreconsultaSummary) y el
    // gate de la sala de espera los leen, y romperlos dejaría consultas viejas y
    // nuevas en dos formatos incompatibles.
    return {
      version: 2,
      symptom: {
        id: symptom.id,
        label: symptom.label,
        icd10_code: symptom.icd10Code,
        icd10_display: symptom.icd10Display,
        free_text: symptom.freeText ? freeText.trim() : null,
      },
      answers: structured,
      medication: {
        taking: medication.value === 'si',
        detail: medication.value === 'si' ? medication.detail.trim() : null,
      },
      has_red_flags: structured.some(a => a.red_flag),

      main_complaint: symptom.freeText
        ? `Otro motivo (sin codificar): ${freeText.trim()}`
        : `${symptom.label} (${symptom.icd10Code})`,
      symptoms: structured.map(a => `${a.question_label} ${a.labels.join(', ')}`).join('\n'),
      current_medications: medicationLabel,
    }
  }

  const handleSubmit = async () => {
    if (submitting || !symptomStepOk || !answeredAll || !medicationOk) return
    setSubmitting(true)
    setSaveError(null)

    if (!consultationId) {
      setSubmitting(false)
      onSubmitted()
      return
    }

    const payload = buildPayload()

    try {
      const { error } = await supabase
        .from('consultations')
        .update({ preconsulta_data: payload })
        .eq('id', consultationId)
      if (error) throw error
      consultationEventsService.log(consultationId, CONSULTATION_EVENTS.PRECONSULTA_SUBMITTED, {
        symptom: payload.symptom?.id,
        icd10: payload.symptom?.icd10_code,
        has_red_flags: payload.has_red_flags,
      })
      toast.success('Pre-consulta enviada')
      setSubmitting(false)
      onSubmitted(payload)
    } catch (err) {
      setSubmitting(false)
      if (required) {
        console.warn('[PreconsultaForm] Save failed (blocking):', err)
        setSaveError('No pudimos guardar tus respuestas. Revisá la conexión y probá de nuevo.')
        return
      }
      console.warn('[PreconsultaForm] Save error (non-blocking):', err)
      onSubmitted(payload)
    }
  }

  // ── Shared option button ────────────────────────────────────────────────────
  const OptionButton = ({ selected, label, onClick }) => (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 rounded-2xl border text-[15px] font-medium transition-colors flex items-center gap-3 ${
        selected
          ? 'border-brand bg-brand-muted text-text-primary'
          : 'border-gray-200 bg-bg-primary text-gray-700 hover:border-gray-300'
      }`}
    >
      <span className={`w-5 h-5 rounded-full border flex items-center justify-center flex-shrink-0 ${
        selected ? 'border-brand bg-brand' : 'border-gray-300'
      }`}>
        {selected && <Check className="w-3 h-3 text-white" weight="bold" />}
      </span>
      <span className="flex-1">{label}</span>
    </button>
  )

  const stepTitles = ['¿Qué te pasa?', `Contanos más sobre: ${symptom?.label ?? ''}`, 'Medicación']

  // En modo `required` esto es un PASO del flujo, no un accesorio: va a pantalla
  // completa. El bottom sheet sugería que se podía descartar, que es justo lo
  // contrario de lo que tiene que comunicar.
  const Shell = required
    ? ({ children }) => (
        <div className="fixed inset-0 z-[100] bg-bg-secondary flex flex-col">{children}</div>
      )
    : ({ children }) => (
        <PatientSheet open={isOpen} onClose={onClose} maxWidth="max-w-lg" backdropClose={false}>
          {children}
        </PatientSheet>
      )

  if (required && !isOpen) return null

  return (
    <Shell>
      {/* Header */}
      <div className="px-6 pt-4 pb-3 flex items-center gap-3 flex-shrink-0 border-b border-border-default">
        {step > 0 ? (
          <button
            onClick={() => setStep(s => s - 1)}
            className="w-10 h-10 bg-white border border-gray-200 rounded-full flex items-center justify-center hover:bg-gray-50 flex-shrink-0"
          >
            <ArrowLeft className="w-4 h-4 text-gray-500" />
          </button>
        ) : (
          <div className="w-10 h-10 bg-brand-muted rounded-full flex items-center justify-center flex-shrink-0">
            <ClipboardText className="w-5 h-5 text-brand" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h2 className="text-[20px] font-black text-gray-900 leading-none truncate">{stepTitles[step]}</h2>
          <p className="text-[12px] text-gray-400 font-medium mt-0.5">Paso {step + 1} de 3</p>
        </div>
        {!required && (
          <button
            onClick={onClose}
            className="w-9 h-9 bg-white border border-gray-200 rounded-full flex items-center justify-center hover:bg-gray-50 flex-shrink-0"
          >
            <X className="w-4 h-4 text-gray-500" />
          </button>
        )}
      </div>

      {/* Progress */}
      <div className="h-1 bg-gray-100 flex-shrink-0">
        <div className={`h-full bg-brand transition-all duration-300 ${
          step === 0 ? 'w-1/3' : step === 1 ? 'w-2/3' : 'w-full'
        }`} />
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-5 scrollbar-hide space-y-5">

        {/* ── Step 0 — elegir síntoma ── */}
        {step === 0 && (
          <div className="space-y-2">
            <p className="text-[13px] text-gray-500 font-medium mb-3">
              Elegí lo que más te molesta. Si tenés varias cosas, empezá por la principal.
            </p>
            {ALL_SYMPTOMS.map(s => (
              <OptionButton
                key={s.id}
                selected={symptomId === s.id}
                label={s.label}
                onClick={() => { setSymptomId(s.id); setAnswers({}) }}
              />
            ))}
            {symptom?.freeText && (
              <div className="pt-2">
                <label className="text-[11px] font-bold text-gray-400 uppercase tracking-widest block mb-1.5">
                  {symptom.freeTextLabel}
                </label>
                <textarea
                  rows={2}
                  value={freeText}
                  onChange={e => setFreeText(e.target.value)}
                  placeholder="Ej: me duele la rodilla desde ayer"
                  className="w-full bg-bg-primary border border-gray-200 rounded-2xl px-4 py-3 outline-none text-[15px] font-medium text-gray-900 placeholder:text-gray-400 focus:border-brand transition-colors resize-none"
                />
              </div>
            )}
          </div>
        )}

        {/* ── Step 1 — preguntas de calificación ── */}
        {step === 1 && questions.map(q => (
          <div key={q.id} className="space-y-2">
            <p className="text-[15px] font-bold text-gray-900">{q.label}</p>
            {q.type === 'multi' && (
              <p className="text-[12px] text-gray-400 font-medium -mt-1">Podés elegir más de una</p>
            )}
            {q.options.map(o => {
              const raw = answers[q.id]
              const selected = q.type === 'multi'
                ? Array.isArray(raw) && raw.includes(o.value)
                : raw === o.value
              return (
                <OptionButton
                  key={o.value}
                  selected={selected}
                  label={o.label}
                  onClick={() => (q.type === 'multi' ? toggleMulti(q, o) : pickSingle(q.id, o.value))}
                />
              )
            })}
          </div>
        ))}

        {/* ── Step 2 — medicación ── */}
        {step === 2 && (
          <div className="space-y-2">
            <p className="text-[15px] font-bold text-gray-900">{MEDICATION_QUESTION.label}</p>
            {MEDICATION_QUESTION.options.map(o => (
              <OptionButton
                key={o.value}
                selected={medication.value === o.value}
                label={o.label}
                onClick={() => setMedication({ value: o.value, detail: o.value === 'si' ? medication.detail : '' })}
              />
            ))}
            {medication.value === 'si' && (
              <div className="pt-2">
                <label className="text-[11px] font-bold text-gray-400 uppercase tracking-widest block mb-1.5">
                  ¿Cuál o cuáles?
                </label>
                <textarea
                  rows={2}
                  value={medication.detail}
                  onChange={e => setMedication(m => ({ ...m, detail: e.target.value }))}
                  placeholder="Ej: Omeprazol 20mg, Ibuprofeno 400mg"
                  className="w-full bg-bg-primary border border-gray-200 rounded-2xl px-4 py-3 outline-none text-[15px] font-medium text-gray-900 placeholder:text-gray-400 focus:border-brand transition-colors resize-none"
                />
              </div>
            )}
          </div>
        )}

        {/* CTA */}
        <div className="space-y-3 pb-2 pt-1">
          {saveError && <p className="text-[13px] font-semibold text-danger text-center">{saveError}</p>}

          {step < 2 ? (
            <button
              onClick={() => setStep(s => s + 1)}
              disabled={step === 0 ? !symptomStepOk : !answeredAll}
              className={`w-full py-4 rounded-[20px] font-bold text-[16px] transition-all ${
                (step === 0 ? symptomStepOk : answeredAll)
                  ? 'bg-brand text-white hover:bg-brand-hover active:scale-95'
                  : 'bg-gray-100 text-gray-400 cursor-not-allowed'
              }`}
            >
              Continuar
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={submitting || !medicationOk}
              className={`w-full py-4 rounded-[20px] font-bold text-[16px] transition-all flex justify-center items-center gap-2 ${
                submitting || !medicationOk
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-brand text-white hover:bg-brand-hover active:scale-95'
              }`}
            >
              {submitting
                ? <><CircleNotch className="w-5 h-5 animate-spin" /> Enviando...</>
                : (required ? 'Ingresar en sala de espera' : 'Completar pre-consulta')}
            </button>
          )}

          {step === 0 && !symptomStepOk && (
            <p className="text-[12px] text-gray-400 text-center font-medium">
              Elegí un motivo para continuar.
            </p>
          )}
          {step === 1 && !answeredAll && (
            <p className="text-[12px] text-gray-400 text-center font-medium">
              Contestá todas las preguntas para continuar.
            </p>
          )}
          {step === 2 && !medicationOk && (
            <p className="text-[12px] text-gray-400 text-center font-medium">
              Contanos si estás tomando medicación.
            </p>
          )}

          {!required && step === 0 && (
            <button
              onClick={() => onSubmitted()}
              disabled={submitting}
              className="w-full py-3 text-[14px] font-semibold text-gray-400 hover:text-gray-600 transition-colors"
            >
              Omitir por ahora
            </button>
          )}
        </div>
      </div>
    </Shell>
  )
}
