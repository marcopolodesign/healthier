import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDaysIcon } from '@heroicons/react/24/outline'
import { consultationsService } from '../../services/consultationsService'
import StatusBadge from '../../components/StatusBadge'
import { toast } from '../../components/Toast'

export default function PatientConsultations({ profile }) {
  const [consultations, setConsultations] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')

  useEffect(() => {
    if (!profile?.id) return
    consultationsService.getByPatient(profile.id)
      .then(setConsultations)
      .catch(() => toast.error('Error al cargar consultas'))
      .finally(() => setLoading(false))
  }, [profile?.id])

  const filtered = filter === 'all' ? consultations : consultations.filter(c => c.status === filter)

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Mis consultas</h1>
          <p className="text-text-secondary mt-1">Historial y próximas consultas</p>
        </div>
        <Link to="/paciente/buscar" className="btn-primary text-sm">Nueva consulta</Link>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        {[
          { key: 'all', label: 'Todas' },
          { key: 'pending', label: 'Pendientes' },
          { key: 'confirmed', label: 'Confirmadas' },
          { key: 'completed', label: 'Completadas' },
          { key: 'cancelled', label: 'Canceladas' },
        ].map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              filter === f.key ? 'bg-brand text-white' : 'bg-bg-surface text-text-secondary hover:bg-bg-surface-hover'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">
            {[1,2,3].map(i => <div key={i} className="h-16 bg-bg-surface rounded-lg animate-pulse" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <CalendarDaysIcon className="h-12 w-12 text-text-muted mx-auto mb-3" />
            <p className="text-text-secondary">No hay consultas en esta categoría</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-header">Profesional</th>
                <th className="table-header hidden sm:table-cell">Especialidad</th>
                <th className="table-header hidden md:table-cell">Fecha</th>
                <th className="table-header">Estado</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => {
                const profName = c.professional?.fullName || '—'
                const specialty = c.professional?.professionalProfiles?.specialty
                return (
                  <tr key={c.id} className="table-row">
                    <td className="table-cell font-medium">{profName}</td>
                    <td className="table-cell hidden sm:table-cell text-text-secondary capitalize">{specialty?.replace('_', ' ') || '—'}</td>
                    <td className="table-cell hidden md:table-cell text-text-secondary">
                      {c.scheduledAt ? new Date(c.scheduledAt).toLocaleDateString('es-AR') : '—'}
                    </td>
                    <td className="table-cell"><StatusBadge status={c.status} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
