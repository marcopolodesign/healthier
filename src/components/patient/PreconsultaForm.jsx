import { useState } from 'react'
import { X, CircleNotch, ClipboardText, Heart, Scales, Ruler, Drop, Wind } from '@phosphor-icons/react'
import PatientSheet from './PatientSheet'
import { toast } from '../Toast'
import { submitPreconsulta } from '../../services/heuralService'

/**
 * PreconsultaForm
 *
 * Shows a bottom-sheet pre-consultation form before a video call.
 *
 * Props:
 *   isOpen              – boolean, controls visibility
 *   onClose             – called when the sheet is dismissed without submitting
 *   appointmentHeuralId – string | null — Heural appointment ID; if null the form is skipped
 *   onSubmitted         – called after submit OR skip; parent proceeds to video call
 */
export default function PreconsultaForm({ isOpen, onClose, appointmentHeuralId, onSubmitted }) {
  const [submitting, setSubmitting] = useState(false)

  const [form, setForm] = useState({
    mainComplaint: '',
    symptoms: '',
    weight: '',
    height: '',
    systolicPressure: '',
    diastolicPressure: '',
    heartRate: '',
    oxygenSaturation: '',
    currentMedications: '',
  })

  const set = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }))

  const handleSubmit = async () => {
    if (submitting) return
    setSubmitting(true)

    // If no Heural appointment ID, skip silently
    if (!appointmentHeuralId) {
      setSubmitting(false)
      onSubmitted()
      return
    }

    // Build payload — only include non-empty numeric fields
    const payload = {
      mainComplaint: form.mainComplaint || null,
      symptoms: form.symptoms || null,
      weight: form.weight ? parseFloat(form.weight) : null,
      height: form.height ? parseFloat(form.height) : null,
      systolicPressure: form.systolicPressure ? parseInt(form.systolicPressure, 10) : null,
      diastolicPressure: form.diastolicPressure ? parseInt(form.diastolicPressure, 10) : null,
      heartRate: form.heartRate ? parseInt(form.heartRate, 10) : null,
      oxygenSaturation: form.oxygenSaturation ? parseFloat(form.oxygenSaturation) : null,
      currentMedications: form.currentMedications || null,
    }

    try {
      const { error } = await submitPreconsulta(appointmentHeuralId, payload)
      if (error) {
        // API error — log it but never block the patient from joining
        console.warn('[PreconsultaForm] API error (non-blocking):', error)
      } else {
        toast.success('Pre-consulta enviada')
      }
    } catch (err) {
      // Network failure — also non-blocking
      console.warn('[PreconsultaForm] Network error (non-blocking):', err)
    } finally {
      setSubmitting(false)
      onSubmitted()
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
          <p className="text-[12px] text-gray-400 font-medium mt-0.5">Completala antes de entrar a la sala</p>
        </div>
        <button
          onClick={onClose}
          className="w-9 h-9 bg-white border border-gray-200 rounded-full flex items-center justify-center hover:bg-gray-50 flex-shrink-0"
        >
          <X className="w-4 h-4 text-gray-500" />
        </button>
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

        {/* Signo vitales section */}
        <div>
          <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-1.5">
            <Heart className="w-3.5 h-3.5 text-red-400" />
            Signos Vitales
            <span className="normal-case tracking-normal font-medium text-gray-300">(opcional)</span>
          </p>

          {/* Row 1: Peso + Talla */}
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-[11px] font-semibold text-gray-400 block mb-1">
                <Scales className="w-3 h-3 inline mr-1" />Peso (kg)
              </label>
              <input
                type="number"
                inputMode="decimal"
                value={form.weight}
                onChange={set('weight')}
                placeholder="70"
                min="1"
                max="300"
                step="0.1"
                className="w-full bg-bg-primary border border-gray-200 rounded-2xl px-4 py-3 outline-none text-[15px] font-medium text-gray-900 placeholder:text-gray-400 focus:border-brand transition-colors"
              />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-gray-400 block mb-1">
                <Ruler className="w-3 h-3 inline mr-1" />Talla (cm)
              </label>
              <input
                type="number"
                inputMode="decimal"
                value={form.height}
                onChange={set('height')}
                placeholder="170"
                min="50"
                max="250"
                step="0.5"
                className="w-full bg-bg-primary border border-gray-200 rounded-2xl px-4 py-3 outline-none text-[15px] font-medium text-gray-900 placeholder:text-gray-400 focus:border-brand transition-colors"
              />
            </div>
          </div>

          {/* Row 2: Presión arterial */}
          <div className="mb-3">
            <label className="text-[11px] font-semibold text-gray-400 block mb-1">
              <Drop className="w-3 h-3 inline mr-1" />Presión arterial (mmHg)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                inputMode="numeric"
                value={form.systolicPressure}
                onChange={set('systolicPressure')}
                placeholder="Sistólica"
                min="50"
                max="250"
                className="flex-1 bg-bg-primary border border-gray-200 rounded-2xl px-4 py-3 outline-none text-[15px] font-medium text-gray-900 placeholder:text-gray-400 focus:border-brand transition-colors"
              />
              <span className="text-gray-300 font-bold text-lg select-none">/</span>
              <input
                type="number"
                inputMode="numeric"
                value={form.diastolicPressure}
                onChange={set('diastolicPressure')}
                placeholder="Diastólica"
                min="30"
                max="180"
                className="flex-1 bg-bg-primary border border-gray-200 rounded-2xl px-4 py-3 outline-none text-[15px] font-medium text-gray-900 placeholder:text-gray-400 focus:border-brand transition-colors"
              />
            </div>
          </div>

          {/* Row 3: FC + SpO2 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-semibold text-gray-400 block mb-1">
                <Heart className="w-3 h-3 inline mr-1" />Frec. cardíaca (bpm)
              </label>
              <input
                type="number"
                inputMode="numeric"
                value={form.heartRate}
                onChange={set('heartRate')}
                placeholder="72"
                min="20"
                max="250"
                className="w-full bg-bg-primary border border-gray-200 rounded-2xl px-4 py-3 outline-none text-[15px] font-medium text-gray-900 placeholder:text-gray-400 focus:border-brand transition-colors"
              />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-gray-400 block mb-1">
                <Wind className="w-3 h-3 inline mr-1" />Saturación O2 (%)
              </label>
              <input
                type="number"
                inputMode="numeric"
                value={form.oxygenSaturation}
                onChange={set('oxygenSaturation')}
                placeholder="98"
                min="50"
                max="100"
                step="0.1"
                className="w-full bg-bg-primary border border-gray-200 rounded-2xl px-4 py-3 outline-none text-[15px] font-medium text-gray-900 placeholder:text-gray-400 focus:border-brand transition-colors"
              />
            </div>
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
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className={`w-full py-4 rounded-[20px] font-bold text-[16px] transition-all flex justify-center items-center gap-2 ${
              submitting
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                : 'bg-brand text-white hover:bg-brand-hover active:scale-95'
            }`}
          >
            {submitting ? (
              <><CircleNotch className="w-5 h-5 animate-spin" /> Enviando...</>
            ) : (
              'Completar pre-consulta'
            )}
          </button>

          <button
            onClick={handleSkip}
            disabled={submitting}
            className="w-full py-3 text-[14px] font-semibold text-gray-400 hover:text-gray-600 transition-colors"
          >
            Omitir por ahora
          </button>
        </div>
      </div>
    </PatientSheet>
  )
}
