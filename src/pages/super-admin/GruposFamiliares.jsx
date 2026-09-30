import { useEffect, useState } from 'react'
import { UsersThree } from '@phosphor-icons/react'
import { familyService } from '../../services/familyService'
import { toast } from '../../components/Toast'
import { formatDate } from '../../lib/format'
import MetricCard from '../../components/super-admin/MetricCard'

/**
 * Grupos familiares (migración 181): quién administra a quién.
 *
 * Cada familiar es un paciente con perfil e historia clínica propios pero sin
 * contraseña; su titular reserva, paga y lee su HC. Esta pantalla es la regla
 * de visibilidad: que el super admin vea los vínculos, cuántas consultas tuvo
 * cada familiar y si alguna vez entró solo con un código.
 */
export default function SuperAdminGruposFamiliares() {
  const [filas, setFilas] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    familyService.adminListar()
      .then(setFilas)
      .catch(err => toast.error(err.message || 'Error al cargar los grupos familiares'))
      .finally(() => setLoading(false))
  }, [])

  const titulares = new Set(filas.map(f => f.titularId)).size
  const conConsultas = filas.filter(f => Number(f.consultas) > 0).length
  const entraronSolos = filas.filter(f => f.ultimoIngresoAt).length

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="page-title-lg">Grupos familiares</h1>
        <p className="text-text-secondary mt-1">
          Familiares a cargo de un paciente: tienen historia clínica propia y entran sólo con el código que les genera su titular
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard label="Familiares" value={loading ? '—' : filas.length} />
        <MetricCard label="Titulares" value={loading ? '—' : titulares} />
        <MetricCard label="Con alguna consulta" value={loading ? '—' : conConsultas} />
        <MetricCard label="Entraron con código" value={loading ? '—' : entraronSolos} />
      </div>

      <div className="card">
        {loading ? (
          <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-10 bg-bg-surface rounded-lg animate-pulse" />)}</div>
        ) : filas.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-center">
            <UsersThree className="h-10 w-10 text-text-muted mb-3" />
            <p className="text-text-secondary text-sm">Todavía nadie cargó un familiar</p>
          </div>
        ) : (
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr>
                  <th className="table-header">Titular</th>
                  <th className="table-header">Familiar</th>
                  <th className="table-header">Vínculo</th>
                  <th className="table-header text-right">Consultas</th>
                  <th className="table-header">Último código</th>
                  <th className="table-header">Último ingreso</th>
                  <th className="table-header">Alta</th>
                </tr>
              </thead>
              <tbody>
                {filas.map(f => (
                  <tr key={f.vinculoId} className="table-row">
                    <td className="table-cell">
                      <p className="text-text-primary truncate max-w-[200px]">{f.titularNombre || '—'}</p>
                      <p className="text-xs text-text-tertiary truncate max-w-[200px]">{f.titularEmail}</p>
                    </td>
                    <td className="table-cell">
                      <p className="text-text-primary truncate max-w-[200px]">{f.familiarNombre || '—'}</p>
                      {f.familiarDni && <p className="text-xs text-text-tertiary">DNI {f.familiarDni}</p>}
                    </td>
                    <td className="table-cell">{f.parentesco || '—'}</td>
                    <td className="table-cell text-right">{f.consultas}</td>
                    <td className="table-cell">{f.ultimoPinAt ? formatDate(f.ultimoPinAt) : '—'}</td>
                    <td className="table-cell">{f.ultimoIngresoAt ? formatDate(f.ultimoIngresoAt) : 'Nunca'}</td>
                    <td className="table-cell">{formatDate(f.creadoAt)}</td>
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
