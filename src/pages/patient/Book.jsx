import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { professionalService } from '../../services/professionalService'
import { consultationsService } from '../../services/consultationsService'
import CalendlyEmbed from '../../components/CalendlyEmbed'
import { toast } from '../../components/Toast'

export default function Book({ profile }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const [professional, setProfessional] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    professionalService.getPublicProfile(id)
      .then(setProfessional)
      .catch(() => toast.error('Error al cargar el profesional'))
      .finally(() => setLoading(false))
  }, [id])

  // Listen for Calendly event booked
  useEffect(() => {
    const handler = async (e) => {
      if (e.data?.event === 'calendly.event_scheduled') {
        try {
          await consultationsService.create({
            patientId: profile.id,
            professionalId: id,
            status: 'confirmed',
            scheduledAt: new Date().toISOString(),
            calendlyEventUri: e.data.payload?.event?.uri || '',
          })
          toast.success('¡Consulta agendada exitosamente!')
          navigate('/paciente/consultas')
        } catch {
          toast.error('No se pudo registrar la consulta')
        }
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [id, profile?.id, navigate])

  if (loading) return <div className="h-96 bg-bg-surface rounded-xl animate-pulse" />

  const name = professional?.profiles?.fullName || professional?.profiles?.full_name

  return (
    <div className="space-y-6 animate-fade-in max-w-3xl mx-auto">
      <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-sm text-text-secondary hover:text-brand">
        <ArrowLeft className="h-4 w-4" /> Volver
      </button>

      <div>
        <h1 className="text-2xl font-bold text-text-primary">Agendar consulta</h1>
        {name && <p className="text-text-secondary mt-1">con {name}</p>}
      </div>

      <div className="card">
        <CalendlyEmbed
          url={professional?.calendlyUrl}
          prefill={{ name: profile?.fullName, email: profile?.email }}
          height={700}
        />
      </div>
    </div>
  )
}
