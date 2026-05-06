import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, FileText, Paperclip, Video } from 'lucide-react'
import { consultationsService } from '../../services/consultationsService'
import StatusBadge from '../../components/StatusBadge'
import CloseConsultationModal from '../../components/CloseConsultationModal'
import { toast } from '../../components/Toast'

export default function ConsultationDetail({ profile }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const [consultation, setConsultation] = useState(null)
  const [loading, setLoading] = useState(true)
  const [closeModal, setCloseModal] = useState(false)

  useEffect(() => {
    consultationsService.getById(id)
      .then(setConsultation)
      .catch(() => toast.error('Error al cargar la consulta'))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return <div className="h-96 bg-bg-surface rounded-xl animate-pulse" />
  if (!consultation) return <div className="text-center py-20 text-text-secondary">Consulta no encontrada</div>

  const patientName = consultation.patient?.fullName
  const canClose = ['confirmed', 'in_progress', 'pending'].includes(consultation.status)

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl mx-auto">
      <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-sm text-text-secondary hover:text-brand">
        <ArrowLeft className="h-4 w-4" /> Volver
      </button>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-text-primary">Detalle de consulta</h1>
        <StatusBadge status={consultation.status} />
      </div>

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
            Agendada para:{' '}
            <span className="text-text-primary font-medium">
              {new Date(consultation.scheduledAt).toLocaleString('es-AR', {
                weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
              })}
            </span>
          </div>
        )}
      </div>

      {consultation.closingNotes && (
        <div className="card">
          <div className="flex items-center gap-2 mb-2">
            <FileText className="h-5 w-5 text-brand" />
            <h2 className="font-semibold text-text-primary">Notas de cierre</h2>
          </div>
          <p className="text-sm text-text-secondary">{consultation.closingNotes}</p>
        </div>
      )}

      {consultation.prescriptionUrl && (
        <div className="card">
          <div className="flex items-center gap-2">
            <Paperclip className="h-5 w-5 text-brand" />
            <a
              href={consultation.prescriptionUrl}
              target="_blank"
              rel="noreferrer"
              className="text-brand text-sm font-medium hover:underline"
            >
              Ver receta adjunta
            </a>
          </div>
        </div>
      )}

      {canClose && consultation.modality === 'video' && (
        <Link
          to={`/profesional/videollamada/${id}`}
          className="btn-primary w-full py-3 flex items-center justify-center gap-2"
        >
          <Video className="h-5 w-5" />
          Acceder a la consulta
        </Link>
      )}

      {canClose && (
        <button onClick={() => setCloseModal(true)} className="btn-secondary w-full py-3">
          Cerrar consulta
        </button>
      )}

      <CloseConsultationModal
        open={closeModal}
        onClose={() => setCloseModal(false)}
        consultationId={id}
        patientName={patientName}
        profile={profile}
        onFinalized={() => navigate('/profesional/dashboard')}
      />
    </div>
  )
}
