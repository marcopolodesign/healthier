import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeftIcon, DocumentTextIcon } from '@heroicons/react/24/outline'
import { consultationsService } from '../../services/consultationsService'
import StatusBadge from '../../components/StatusBadge'
import Modal from '../../components/Modal'
import FileUpload from '../../components/FileUpload'
import { toast } from '../../components/Toast'

export default function ConsultationDetail({ profile }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const [consultation, setConsultation] = useState(null)
  const [loading, setLoading] = useState(true)
  const [closeModal, setCloseModal] = useState(false)
  const [closeForm, setCloseForm] = useState({ needsPrescription: false, notes: '', prescriptionFile: null })
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    consultationsService.getById(id)
      .then(setConsultation)
      .catch(() => toast.error('Error al cargar la consulta'))
      .finally(() => setLoading(false))
  }, [id])

  const handleClose = async () => {
    setClosing(true)
    try {
      await consultationsService.updateStatus(id, 'completed', {
        closingNotes: closeForm.notes,
      })
      toast.success('Consulta cerrada correctamente')
      setCloseModal(false)
      navigate('/profesional/dashboard')
    } catch {
      toast.error('Error al cerrar la consulta')
    } finally {
      setClosing(false)
    }
  }

  if (loading) return <div className="h-96 bg-bg-surface rounded-xl animate-pulse" />
  if (!consultation) return <div className="text-center py-20 text-text-secondary">Consulta no encontrada</div>

  const patientName = consultation.patient?.fullName
  const canClose = ['confirmed', 'in_progress', 'pending'].includes(consultation.status)

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl mx-auto">
      <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-sm text-text-secondary hover:text-brand">
        <ArrowLeftIcon className="h-4 w-4" /> Volver
      </button>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-text-primary">Detalle de consulta</h1>
        <StatusBadge status={consultation.status} />
      </div>

      {/* Patient info */}
      <div className="card">
        <h2 className="font-semibold text-text-primary mb-4">Paciente</h2>
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-brand-muted flex items-center justify-center">
            <span className="text-brand font-bold text-lg">{patientName?.[0]}</span>
          </div>
          <div>
            <p className="font-semibold text-text-primary">{patientName || '—'}</p>
            <p className="text-sm text-text-secondary">{consultation.patient?.email}</p>
          </div>
        </div>
        {consultation.scheduledAt && (
          <div className="mt-3 pt-3 border-t border-border-default text-sm text-text-secondary">
            Agendada para: <span className="text-text-primary font-medium">
              {new Date(consultation.scheduledAt).toLocaleString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        )}
      </div>

      {/* Notes */}
      {consultation.closingNotes && (
        <div className="card">
          <div className="flex items-center gap-2 mb-2">
            <DocumentTextIcon className="h-5 w-5 text-brand" />
            <h2 className="font-semibold text-text-primary">Notas de cierre</h2>
          </div>
          <p className="text-sm text-text-secondary">{consultation.closingNotes}</p>
        </div>
      )}

      {/* Actions */}
      {canClose && (
        <button onClick={() => setCloseModal(true)} className="btn-primary w-full py-3">
          Cerrar consulta
        </button>
      )}

      {/* Close modal */}
      <Modal open={closeModal} onClose={() => setCloseModal(false)} title="Cerrar consulta">
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">Completá la información para finalizar la consulta con {patientName}.</p>

          <div>
            <label className="form-label">Notas de la consulta</label>
            <textarea
              value={closeForm.notes}
              onChange={e => setCloseForm(p => ({ ...p, notes: e.target.value }))}
              rows={3}
              placeholder="Resumen de la consulta, indicaciones, diagnóstico..."
              className="form-textarea"
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setCloseForm(p => ({ ...p, needsPrescription: !p.needsPrescription }))}
              className={`w-10 h-6 rounded-full transition-colors relative ${closeForm.needsPrescription ? 'bg-brand' : 'bg-gray-300'}`}
            >
              <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-transform ${closeForm.needsPrescription ? 'translate-x-5' : 'translate-x-1'}`} />
            </button>
            <span className="text-sm text-text-primary">¿Requiere receta?</span>
          </div>

          {closeForm.needsPrescription && (
            <FileUpload
              onFile={f => setCloseForm(p => ({ ...p, prescriptionFile: f }))}
              accept=".pdf,.jpg,.jpeg,.png"
              label="Adjuntar receta (opcional)"
            />
          )}

          <div className="flex gap-3 pt-2">
            <button onClick={() => setCloseModal(false)} className="btn-secondary flex-1">Cancelar</button>
            <button onClick={handleClose} disabled={closing} className="btn-primary flex-1">
              {closing ? 'Cerrando...' : 'Confirmar cierre'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
