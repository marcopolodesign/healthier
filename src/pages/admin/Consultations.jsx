import { useState, useEffect } from 'react'
import { CalendarDaysIcon } from '@heroicons/react/24/outline'
import { consultationsService } from '../../services/consultationsService'
import StatusBadge from '../../components/StatusBadge'
import { toast } from '../../components/Toast'

export default function AdminConsultations() {
  const [consultations, setConsultations] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')

  useEffect(() => {
    consultationsService.getAll()
      .then(setConsultations)
      .catch(() => toast.error('Error al cargar consultas'))
      .finally(() => setLoading(false))
  }, [])

  const filtered = filter === 'all' ? consultations : consultations.filter(c => c.status === filter)

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Consultas de la plataforma</h1>
        <p className="text-text-secondary mt-1">{consultations.length} consultas en total</p>
      </div>

      <div className="flex gap-2 flex-wrap">
        {['all', 'pending', 'confirmed', 'in_progress', 'completed', 'cancelled'].map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${filter === s ? 'bg-brand text-white' : 'bg-bg-surface text-text-secondary hover:bg-bg-surface-hover'}`}>
            {s === 'all' ? 'Todas' : s === 'in_progress' ? 'En curso' : s.charAt(0).toUpperCase() + s.slice(1).replace('_', ' ')}
          </button>
        ))}
      </div>

      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">{[1,2,3].map(i => <div key={i} className="h-14 bg-bg-surface rounded-lg animate-pulse" />)}</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <CalendarDaysIcon className="h-12 w-12 text-text-muted mx-auto mb-3" />
            <p className="text-text-secondary">No hay consultas en esta categoría</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-header">Paciente</th>
                <th className="table-header hidden sm:table-cell">Profesional</th>
                <th className="table-header hidden md:table-cell">Especialidad</th>
                <th className="table-header hidden lg:table-cell">Fecha</th>
                <th className="table-header">Estado</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => (
                <tr key={c.id} className="table-row">
                  <td className="table-cell">{c.patient?.fullName || '—'}</td>
                  <td className="table-cell hidden sm:table-cell">{c.professional?.fullName || '—'}</td>
                  <td className="table-cell hidden md:table-cell capitalize">{c.professional?.professionalProfiles?.specialty?.replace('_', ' ') || '—'}</td>
                  <td className="table-cell hidden lg:table-cell text-text-secondary">
                    {c.scheduledAt ? new Date(c.scheduledAt).toLocaleDateString('es-AR') : '—'}
                  </td>
                  <td className="table-cell"><StatusBadge status={c.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
