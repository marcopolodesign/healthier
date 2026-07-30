import { useState } from 'react'
import Modal from './Modal'
import { consultationsService } from '../services/consultationsService'
import { clinicalService } from '../services/clinicalService'
import { toast } from './Toast'

export default function CloseConsultationModal({
  open, onClose, consultationId, patientName, modality, profile, onFinalized,
  patientId, ensureEncounter, licenseType, licenseNumber,
}) {
  const [form, setForm] = useState({ notes: '', code: '' })
  const [closing, setClosing] = useState(false)

  const handleSubmit = async () => {
    setClosing(true)
    try {
      // La receta ya NO se sube a mano acá (decisión de Mateo, 2026-07-29): una
      // imagen o un PDF que subimos nosotros no es una receta. La receta es el PDF
      // firmado que emite RCTA desde "Recetas digitales", y hasta que RCTA esté
      // habilitado no se entrega ninguna. Se deja de escribir
      // `consultations.prescription_url`; la columna queda para no perder lo viejo.
      const result = await consultationsService.finalize(consultationId, 'professional', {
        closingNotes: form.notes || null,
        code: form.code.trim() || null,
      })

      // La nota de cierre es un acto médico: además de quedar en la consulta
      // (columna editable, útil para la operación del marketplace) se asienta en
      // la historia clínica como entrada append-only y firmada con la matrícula.
      // Ley 26.529 Art. 15 — la HC tiene que registrar el acto y quién lo hizo,
      // y Art. 12/16 exigen que sea inalterable. `consultations.closing_notes`
      // no cumple ninguna de las dos: se puede pisar con un UPDATE.
      // Si esto falla NO se revierte el cierre — se avisa y la consulta queda
      // cerrada igual, que es lo que el profesional acaba de pedir.
      if (form.notes.trim() && ensureEncounter && patientId) {
        try {
          const encounterId = await ensureEncounter()
          await clinicalService.addEntry(encounterId, {
            patientId,
            professionalId: profile.id,
            entryType: 'note',
            content: form.notes.trim(),
            data: { source: 'cierre_de_consulta', consultationId },
            licenseType,
            licenseNumber,
          })
        } catch (err) {
          console.error('No se pudo asentar la nota de cierre en la HC:', err)
          toast.warning('La consulta se cerró, pero la nota no se pudo asentar en la historia clínica.')
        }
      }
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
          {modality === 'presencial' && ' La duración se registrará automáticamente.'}
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

        {modality !== 'presencial' && (
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
        )}

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
