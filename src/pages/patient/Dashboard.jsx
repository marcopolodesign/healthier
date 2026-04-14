import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDaysIcon, MagnifyingGlassIcon, DocumentTextIcon, ClockIcon } from '@heroicons/react/24/outline'
import { consultationsService } from '../../services/consultationsService'
import StatusBadge from '../../components/StatusBadge'
import { toast } from '../../components/Toast'

export default function PatientDashboard({ profile }) {
  const [consultations, setConsultations] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!profile?.id) return
    consultationsService.getByPatient(profile.id)
      .then(data => setConsultations(data.slice(0, 5)))
      .catch(() => toast.error('Error al cargar consultas'))
      .finally(() => setLoading(false))
  }, [profile?.id])

  const upcoming = consultations.filter(c => ['pending', 'confirmed'].includes(c.status))

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Welcome */}
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Hola, {profile?.fullName?.split(' ')[0]} 👋</h1>
        <p className="text-text-secondary mt-1">¿Cómo podemos ayudarte hoy?</p>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Link to="/paciente/buscar" className="card-hover flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-brand-muted flex items-center justify-center shrink-0">
            <MagnifyingGlassIcon className="h-5 w-5 text-brand" />
          </div>
          <div>
            <p className="font-semibold text-text-primary">Buscar profesional</p>
            <p className="text-xs text-text-secondary">Encontrá el especialista ideal</p>
          </div>
        </Link>
        <Link to="/paciente/consultas" className="card-hover flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-accent-muted flex items-center justify-center shrink-0">
            <CalendarDaysIcon className="h-5 w-5 text-accent" />
          </div>
          <div>
            <p className="font-semibold text-text-primary">Mis consultas</p>
            <p className="text-xs text-text-secondary">Ver historial y próximas</p>
          </div>
        </Link>
        <Link to="/paciente/documentos" className="card-hover flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
            <DocumentTextIcon className="h-5 w-5 text-blue-500" />
          </div>
          <div>
            <p className="font-semibold text-text-primary">Mis documentos</p>
            <p className="text-xs text-text-secondary">Estudios y recetas</p>
          </div>
        </Link>
      </div>

      {/* Upcoming consultations */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-text-primary">Próximas consultas</h2>
          <Link to="/paciente/consultas" className="text-sm text-brand hover:underline">Ver todas</Link>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1,2].map(i => <div key={i} className="h-16 bg-bg-surface rounded-lg animate-pulse" />)}
          </div>
        ) : upcoming.length === 0 ? (
          <div className="text-center py-10">
            <ClockIcon className="h-10 w-10 text-text-muted mx-auto mb-3" />
            <p className="text-text-secondary">No tenés consultas próximas</p>
            <Link to="/paciente/buscar" className="btn-primary text-sm mt-4 inline-flex">
              Buscar profesional
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {upcoming.map(c => (
              <div key={c.id} className="flex items-center gap-4 p-3 bg-bg-surface rounded-lg">
                <div className="w-10 h-10 rounded-full bg-brand-muted flex items-center justify-center shrink-0">
                  <CalendarDaysIcon className="h-5 w-5 text-brand" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-text-primary text-sm truncate">
                    {c.professional?.fullName || 'Profesional'}
                  </p>
                  <p className="text-xs text-text-secondary">
                    {c.scheduledAt ? new Date(c.scheduledAt).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : 'Sin fecha'}
                  </p>
                </div>
                <StatusBadge status={c.status} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
