import { useEffect, useState } from 'react'
import { ShareFat } from '@phosphor-icons/react'
import { derivacionesService, destinoLabel, derivacionVigente } from '../../services/derivacionesService'
import { useEspecialidades } from '../../hooks/useEspecialidades'
import DerivacionEstado, { consentimientoLabel } from '../../components/DerivacionEstado'
import { toast } from '../../components/Toast'
import { formatDate } from '../../lib/format'
import MetricCard from '../../components/super-admin/MetricCard'

/**
 * Derivaciones entre profesionales (migración 195): quién derivó a quién, si el
 * paciente compartió su historia clínica y si terminó en un turno. Es la regla de
 * visibilidad del panel: nada operativo de la plataforma queda sin verse acá.
 */
export default function SuperAdminDerivaciones() {
  const { porSlug } = useEspecialidades()
  const [filas, setFilas] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    derivacionesService.adminListar()
      .then(setFilas)
      .catch(err => toast.error(err.message || 'Error al cargar las derivaciones'))
      .finally(() => setLoading(false))
  }, [])

  // Una pendiente pasada de fecha cuenta como vencida aunque el cron no la haya marcado todavía.
  const estadoReal = d => (['pendiente', 'rechazada'].includes(d.estado) && !derivacionVigente(d) ? 'vencida' : d.estado)
  const pendientes = filas.filter(d => estadoReal(d) === 'pendiente').length
  const reservadas = filas.filter(d => d.estado === 'reservada').length
  const rechazadas = filas.filter(d => estadoReal(d) === 'rechazada').length
  const cerradas = filas.filter(d => ['vencida', 'cancelada'].includes(estadoReal(d))).length
  const conConsentimiento = filas.filter(d => d.consentimientoHc === true).length
  const pctConsentimiento = filas.length ? Math.round((conConsentimiento / filas.length) * 100) : 0

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="page-title-lg">Derivaciones</h1>
        <p className="text-text-secondary mt-1">
          Pacientes que un profesional derivó a otro profesional o a otra especialidad
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
        <MetricCard label="Total" value={loading ? '—' : filas.length} />
        <MetricCard label="Pendientes" value={loading ? '—' : pendientes} />
        <MetricCard label="Reservadas" value={loading ? '—' : reservadas} tone="ok" />
        <MetricCard label="Rechazadas" value={loading ? '—' : rechazadas} tone={rechazadas ? 'bad' : 'neutral'} />
        <MetricCard label="Compartieron HC" value={loading ? '—' : `${pctConsentimiento}%`} hint={loading ? undefined : `${conConsentimiento} de ${filas.length}`} />
        <MetricCard label="Vencidas / canceladas" value={loading ? '—' : cerradas} />
      </div>

      <div className="card">
        {loading ? (
          <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-10 bg-bg-surface rounded-lg animate-pulse" />)}</div>
        ) : filas.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-center">
            <ShareFat className="h-10 w-10 text-text-muted mb-3" />
            <p className="text-text-secondary text-sm">Todavía nadie derivó a un paciente</p>
          </div>
        ) : (
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="w-full min-w-[1000px] text-sm">
              <thead>
                <tr>
                  <th className="table-header">Fecha</th>
                  <th className="table-header">Paciente</th>
                  <th className="table-header">Derivado por</th>
                  <th className="table-header">Destino</th>
                  <th className="table-header">Motivo</th>
                  <th className="table-header">Estado</th>
                  <th className="table-header">Compartió HC</th>
                  <th className="table-header">Turno</th>
                </tr>
              </thead>
              <tbody>
                {filas.map(d => (
                  <tr key={d.id} className="table-row">
                    <td className="table-cell whitespace-nowrap">{formatDate(d.createdAt)}</td>
                    <td className="table-cell"><p className="truncate max-w-[180px]">{d.paciente?.fullName || '—'}</p></td>
                    <td className="table-cell"><p className="truncate max-w-[180px]">{d.derivado?.fullName || '—'}</p></td>
                    <td className="table-cell"><p className="truncate max-w-[200px]">{destinoLabel(d, porSlug)}</p></td>
                    <td className="table-cell"><p className="truncate max-w-[240px]" title={d.motivo}>{d.motivo}</p></td>
                    <td className="table-cell" title={d.motivoRechazo || undefined}>
                      <DerivacionEstado derivacion={d} />
                      {d.estado === 'rechazada' && d.motivoRechazo && (
                        <p className="text-xs text-text-tertiary truncate max-w-[160px] mt-0.5">{d.motivoRechazo}</p>
                      )}
                    </td>
                    <td className="table-cell">{consentimientoLabel(d)}</td>
                    <td className="table-cell whitespace-nowrap">
                      {d.consultaReservada ? formatDate(d.consultaReservada.scheduledAt) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
