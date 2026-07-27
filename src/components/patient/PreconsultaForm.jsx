import { useState } from 'react'
import { X, CircleNotch, ClipboardText } from '@phosphor-icons/react'
import PatientSheet from './PatientSheet'
import { toast } from '../Toast'
import { supabase } from '../../lib/supabase'

/**
 * PreconsultaForm
 *
 * Shows a bottom-sheet pre-consultation form before a video call.
 *
 * Props:
 *   isOpen         – boolean, controls visibility
 *   onClose        – called when the sheet is dismissed without submitting
 *   consultationId – string | null — Supabase consultation UUID; if null the form is skipped
 *   onSubmitted    – called after submit OR skip; parent proceeds to video call
 *   required       – when true the patient cannot skip or dismiss, motivo + síntomas
 *                    are mandatory, and a failed save keeps the form open instead of
 *                    letting it through. Used by the waiting room: announcing presence
 *                    summons the professional, so this must be answered BEFORE that
 *                    happens or the professional sits waiting while the patient types.
 */
export default function PreconsultaForm({ isOpen, onClose, consultationId, onSubmitted, required = false }) {
  const [submitting, setSubmitting] = useState(false)
  const [saveError, setSaveError] = useState(null)

  const [form, setForm] = useState({
    mainComplaint: '',
    symptoms: '',
    currentMedications: '',
  })

  const set = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }))

  // Only enforced in `required` mode — elsewhere the form stays optional as before.
  const incomplete = required && (!form.mainComplaint.trim() || !form.symptoms.trim())

  const handleSubmit = async () => {
    if (submitting || incomplete) return
    setSubmitting(true)
    setSaveError(null)

    if (!consultationId) {
      setSubmitting(false)
      onSubmitted()
      return
    }

    const payload = {
      main_complaint: form.mainComplaint || null,
      symptoms: form.symptoms || null,
      current_medications: form.currentMedications || null,
    }

    try {
      const { error } = await supabase
        .from('consultations')
        .update({ preconsulta_data: payload })
        .eq('id', consultationId)
      if (error) throw error
      toast.success('Pre-consulta enviada')
      setSubmitting(false)
      onSubmitted(payload)
    } catch (err) {
      setSubmitting(false)
      if (required) {
        // Letting this through would summon the professional with no answers at all.
        // Keep the form open and retryable instead.
        console.warn('[PreconsultaForm] Save failed (blocking):', err)
        setSaveError('No pudimos guardar tus respuestas. Revisá la conexión y probá de nuevo.')
        return
      }
      console.warn('[PreconsultaForm] Save error (non-blocking):', err)
      onSubmitted(payload)
    }
  }

  const handleSkip = () => {
    onSubmitted()
  }

  return (
    <PatientSheet open={isOpen} onClose={onClose} maxWidth="max-w-lg" backdropClose={false}>
      {/* Header */}
      <div className="px-6 pt-4 pb-3 flex items-center gap-3 flex-shrink-0 border-b border-border-default">
        <div className="w-10 h-10 bg-brand-muted rounded-full flex items-center justify-center flex-shrink-0">
          <ClipboardText className="w-5 h-5 text-brand" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-[20px] font-black text-gray-900 leading-none">Pre-consulta</h2>
          <p className="text-[12px] text-gray-400 font-medium mt-0.5">
            {required
              ? 'Contanos esto antes de entrar — el profesional lo lee para recibirte'
              : 'Completala antes de entrar a la sala'}
          </p>
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

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-6 py-5 scrollbar-hide space-y-5">

        {/* Motivo + Síntomas */}
        <div className="space-y-4">
          <div>
            <label className="text-[11px] font-bold text-gray-400 uppercase tracking-widest block mb-1.5">
              Motivo principal
            </label>
            <textarea
              rows={2}
              value={form.mainComplaint}
              onChange={set('mainComplaint')}
              placeholder="¿Qué te trae hoy?"
              className="w-full bg-bg-primary border border-gray-200 rounded-2xl px-4 py-3 outline-none text-[15px] font-medium text-gray-900 placeholder:text-gray-400 focus:border-brand transition-colors resize-none"
            />
          </div>
          <div>
            <label className="text-[11px] font-bold text-gray-400 uppercase tracking-widest block mb-1.5">
              Síntomas
            </label>
            <textarea
              rows={3}
              value={form.symptoms}
              onChange={set('symptoms')}
              placeholder="Describí tus síntomas"
              className="w-full bg-bg-primary border border-gray-200 rounded-2xl px-4 py-3 outline-none text-[15px] font-medium text-gray-900 placeholder:text-gray-400 focus:border-brand transition-colors resize-none"
            />
          </div>
        </div>

        {/* Medicación actual */}
        <div>
          <label className="text-[11px] font-bold text-gray-400 uppercase tracking-widest block mb-1.5">
            Medicación actual
          </label>
          <textarea
            rows={2}
            value={form.currentMedications}
            onChange={set('currentMedications')}
            placeholder="Ej: Omeprazol 20mg, Ibuprofeno 400mg..."
            className="w-full bg-bg-primary border border-gray-200 rounded-2xl px-4 py-3 outline-none text-[15px] font-medium text-gray-900 placeholder:text-gray-400 focus:border-brand transition-colors resize-none"
          />
        </div>

        {/* CTA buttons */}
        <div className="space-y-3 pb-2">
          {saveError && (
            <p className="text-[13px] font-semibold text-danger text-center">{saveError}</p>
          )}

          <button
            onClick={handleSubmit}
            disabled={submitting || incomplete}
            className={`w-full py-4 rounded-[20px] font-bold text-[16px] transition-all flex justify-center items-center gap-2 ${
              submitting || incomplete
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                : 'bg-brand text-white hover:bg-brand-hover active:scale-95'
            }`}
          >
            {submitting ? (
              <><CircleNotch className="w-5 h-5 animate-spin" /> Enviando...</>
            ) : (
              required ? 'Continuar a la sala' : 'Completar pre-consulta'
            )}
          </button>

          {required ? (
            incomplete && (
              <p className="text-[12px] text-gray-400 text-center font-medium">
                Completá motivo principal y síntomas para continuar.
              </p>
            )
          ) : (
            <button
              onClick={handleSkip}
              disabled={submitting}
              className="w-full py-3 text-[14px] font-semibold text-gray-400 hover:text-gray-600 transition-colors"
            >
              Omitir por ahora
            </button>
          )}
        </div>
      </div>
    </PatientSheet>
  )
}
