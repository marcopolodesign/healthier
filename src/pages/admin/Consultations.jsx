import { useState, useEffect } from 'react'
import { Calendar, VideoCamera, MapPin } from '@phosphor-icons/react';
import { consultationsService } from '../../services/consultationsService'
import StatusBadge from '../../components/StatusBadge'
import { toast } from '../../components/Toast'

export default function AdminConsultations() {
  const [consultations, setConsultations] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [cancelling, setCancelling] = useState(null)

  const load = () =>
    consultationsService.getAll()
      .then(setConsultations)
      .catch(() => toast.error('Error al cargar consultas'))
      .finally(() => setLoading(false))

  useEffect(() => { load() }, [])

  const handleCancel = async (c) => {
    if (!window.confirm(`¿Cancelar el turno de ${c.patient?.fullName || 'este paciente'}?`)) return
    setCancelling(c.id)
    try {
      await consultationsService.cancel(c.id, null, 'Cancelado por administrador')
      toast.info('Turno cancelado')
      setConsultations(prev => prev.map(x => x.id === c.id ? { ...x, status: 'cancelled' } : x))
    } catch {
      toast.error('Error al cancelar')
    } finally {
      setCancelling(null)
    }
  }

  const filtered = filter === 'all' ? consultations : consultations.filter(c => c.status === filter)

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Consultas de la plataforma</h1>
        <p className="text-text-secondary mt-1">{consultations.length} consultas en total</p>
      </div>

      <div className="flex gap-2 flex-wrap">
        {['all', 'pending', 'confirmed', 'in_progress', 'completed', 'cancelled', 'expired', 'no_show'].map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${filter === s ? 'bg-brand text-white' : 'bg-bg-surface text-text-secondary hover:bg-bg-surface-hover'}`}>
            {s === 'all' ? 'Todas'
              : s === 'in_progress' ? 'En curso'
              : s === 'expired' ? 'Vencidas'
              : s === 'no_show' ? 'Ausentes'
              : s.charAt(0).toUpperCase() + s.slice(1).replace('_', ' ')}
          </button>
        ))}
      </div>

      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">{[1,2,3].map(i => <div key={i} className="h-14 bg-bg-surface rounded-lg animate-pulse" />)}</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <Calendar className="h-12 w-12 text-text-muted mx-auto mb-3" />
            <p className="text-text-secondary">No hay consultas en esta categoría</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-header">Paciente</th>
                <th className="table-header hidden sm:table-cell">Profesional</th>
                <th className="table-header hidden md:table-cell">Modalidad</th>
                <th className="table-header hidden lg:table-cell">Fecha</th>
                <th className="table-header">Estado</th>
                <th className="table-header">Acción</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => (
                <tr key={c.id} className="table-row">
                  <td className="table-cell">{c.patient?.fullName || '—'}</td>
                  <td className="table-cell hidden sm:table-cell">{c.professional?.fullName || '—'}</td>
                  <td className="table-cell hidden md:table-cell">
                    {c.modality === 'video'
                      ? <span className="flex items-center gap-1 text-brand"><VideoCamera className="h-4 w-4" /> VideoCamera</span>
                      : c.modality === 'presencial'
                        ? <span className="flex items-center gap-1 text-emerald-600"><MapPin className="h-4 w-4" /> Presencial</span>
                        : <span className="text-text-tertiary">—</span>
                    }
                  </td>
                  <td className="table-cell hidden lg:table-cell text-text-secondary">
                    {c.scheduledAt ? new Date(c.scheduledAt).toLocaleDateString('es-AR') : '—'}
                  </td>
                  <td className="table-cell"><StatusBadge status={c.status} /></td>
                  <td className="table-cell">
                    {['pending', 'confirmed'].includes(c.status) && (
                      <button
                        onClick={() => handleCancel(c)}
                        disabled={cancelling === c.id}
                        className="text-xs text-red-500 hover:text-red-700 font-medium"
                      >
                        {cancelling === c.id ? '...' : 'Cancelar'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
