import { useState, useEffect } from 'react'
import { Siren, MapPin } from '@phosphor-icons/react'
import { emergencyService } from '../../services/emergencyService'
import { toast } from '../../components/Toast'
import { formatARS, formatDate } from '../../lib/format'
import { EMERGENCY_SYMPTOMS } from '../../data/emergencySymptoms'

const STATUS_BADGE = {
  dispatched:  'bg-amber-50 text-amber-700',
  in_transit:  'bg-blue-50 text-blue-600',
  arrived:     'bg-brand-muted text-brand',
  completed:   'bg-emerald-50 text-emerald-600',
  cancelled:   'bg-gray-100 text-gray-500',
}
const STATUS_LABEL = {
  dispatched:  'Despachada',
  in_transit:  'En camino',
  arrived:     'En el lugar',
  completed:   'Completada',
  cancelled:   'Cancelada',
}

export default function SuperAdminEmergencias() {
  const [emergencies, setEmergencies] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    emergencyService.listAllForAdmin()
      .then(setEmergencies)
      .catch(() => toast.error('Error al cargar emergencias'))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="page-title-lg">Emergencias</h1>
        <p className="text-text-secondary mt-1">Todas las emergencias S.O.S despachadas en la plataforma, de más reciente a más antigua</p>
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-text-primary">Emergencias</h2>
          <span className="text-xs text-text-secondary">{emergencies.length} registros</span>
        </div>

        {loading ? (
          <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-10 bg-bg-surface rounded-lg animate-pulse" />)}</div>
        ) : emergencies.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-center">
            <Siren className="h-10 w-10 text-text-muted mb-3" />
            <p className="text-text-secondary text-sm">No hay emergencias registradas todavía</p>
          </div>
        ) : (
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="w-full min-w-[980px] text-sm">
              <thead>
                <tr>
                  <th className="table-header">Fecha</th>
                  <th className="table-header">Código</th>
                  <th className="table-header">Triage</th>
                  <th className="table-header">Estado</th>
                  <th className="table-header">Paciente</th>
                  <th className="table-header">Profesional</th>
                  <th className="table-header">Ubicación</th>
                  <th className="table-header text-right">Precio</th>
                </tr>
              </thead>
              <tbody>
                {emergencies.map(e => {
                  const mapsUrl = e.patientLatitude && e.patientLongitude
                    ? `https://maps.google.com/?q=${e.patientLatitude},${e.patientLongitude}`
                    : null
                  return (
                    <tr key={e.id} className="table-row">
                      <td className="table-cell whitespace-nowrap text-text-tertiary">{formatDate(e.createdAt)}</td>
                      <td className="table-cell font-mono">{e.dispatchCode || '—'}</td>
                      <td className="table-cell">
                        <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-full ${EMERGENCY_SYMPTOMS[e.triageCode]?.badgeClass ?? 'bg-gray-100 text-gray-500'}`}>
                          {EMERGENCY_SYMPTOMS[e.triageCode]?.shortLabel ?? e.triageCode ?? '—'}
                        </span>
                      </td>
                      <td className="table-cell">
                        <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-full ${STATUS_BADGE[e.status] ?? 'bg-gray-100 text-gray-500'}`}>
                          {STATUS_LABEL[e.status] ?? e.status}
                        </span>
                      </td>
                      <td className="table-cell">
                        <p className="text-text-primary truncate max-w-[160px]">{e.patient?.fullName || '—'}</p>
                        <p className="text-xs text-text-tertiary truncate max-w-[160px]">{e.patient?.phone || ''}</p>
                      </td>
                      <td className="table-cell truncate max-w-[160px]">
                        {e.professional?.fullName || <span className="text-text-tertiary">Sin asignar</span>}
                      </td>
                      <td className="table-cell">
                        {mapsUrl ? (
                          <a
                            href={mapsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-brand hover:underline"
                          >
                            <MapPin className="h-3.5 w-3.5" /> Ver mapa
                          </a>
                        ) : (
                          <span className="text-text-tertiary">—</span>
                        )}
                      </td>
                      <td className="table-cell text-right font-semibold">{formatARS(e.priceAtRequest)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
