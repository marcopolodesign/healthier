import { useState } from 'react'
import Modal from './Modal'
import FileUpload from './FileUpload'
import { professionalService } from '../services/professionalService'
import { consultationsService } from '../services/consultationsService'
import { toast } from './Toast'

export default function CloseConsultationModal({ open, onClose, consultationId, patientName, profile, onFinalized }) {
  const [form, setForm] = useState({ notes: '', code: '', needsPrescription: false, prescriptionFile: null })
  const [closing, setClosing] = useState(false)

  const handleSubmit = async () => {
    if (form.needsPrescription && !form.prescriptionFile) {
      toast.warning('Adjuntá la receta antes de confirmar')
      return
    }
    setClosing(true)
    try {
      let prescriptionUrl = null
      if (form.needsPrescription && form.prescriptionFile) {
        prescriptionUrl = await professionalService.uploadDocument(
          profile.id,
          form.prescriptionFile,
          'professional-docs',
          `rx-${consultationId}`
        )
      }
      const result = await consultationsService.finalize(consultationId, 'professional', {
        closingNotes: form.notes || null,
        prescriptionUrl,
        code: form.code.trim() || null,
      })
      if (result.status === 'completed') {
        toast.success('Consulta finalizada correctamente')
        onFinalized?.()
      } else {
        toast.info('Registro guardado. Esperando que el paciente finalice del lado de la app.')
        onClose()
      }
    } catch (err) {
      const msg = err?.message ?? ''
      if (msg.includes('Código inválido')) {
        toast.error('Código inválido. Pedíselo al paciente.')
      } else {
        toast.error('Error al finalizar la consulta')
      }
    } finally {
      setClosing(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Finalizar consulta">
      <div className="space-y-4">
        <p className="text-sm text-text-secondary">
          Completá los datos para cerrar la consulta con {patientName || 'el/la paciente'}.
        </p>

        <div>
          <label className="form-label">Notas de la consulta</label>
          <textarea
            value={form.notes}
            onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
            rows={3}
            placeholder="Resumen, indicaciones, diagnóstico…"
            className="form-textarea"
          />
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setForm(p => ({ ...p, needsPrescription: !p.needsPrescription }))}
            className={`w-10 h-6 rounded-full transition-colors relative ${form.needsPrescription ? 'bg-brand' : 'bg-gray-300'}`}
          >
            <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-transform ${form.needsPrescription ? 'translate-x-5' : 'translate-x-1'}`} />
          </button>
          <span className="text-sm text-text-primary">¿Requiere receta?</span>
        </div>

        {form.needsPrescription && (
          <FileUpload
            onFile={f => setForm(p => ({ ...p, prescriptionFile: f }))}
            accept=".pdf,.jpg,.jpeg,.png"
            label={form.prescriptionFile ? form.prescriptionFile.name : 'Adjuntar receta (PDF o imagen)'}
          />
        )}

        <div>
          <label className="form-label">
            Código de validación <span className="text-text-muted font-normal">(opcional)</span>
          </label>
          <input
            type="text"
            inputMode="numeric"
            maxLength={4}
            value={form.code}
            onChange={e => setForm(p => ({ ...p, code: e.target.value.replace(/\D/g, '') }))}
            placeholder="0000"
            className="form-input text-center tracking-[0.3em] text-lg font-mono"
          />
          <p className="text-xs text-text-muted mt-1">
            Pedíselo al paciente si todavía no finalizó del lado de la app.
          </p>
        </div>

        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="btn-secondary flex-1">Cancelar</button>
          <button onClick={handleSubmit} disabled={closing} className="btn-primary flex-1">
            {closing ? 'Finalizando…' : 'Confirmar cierre'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
