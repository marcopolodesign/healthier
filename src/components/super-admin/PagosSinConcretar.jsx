import { useEffect, useState } from 'react'
import { Users } from '@phosphor-icons/react'
import { paymentsService } from '../../services/paymentsService'
import { formatDate } from '../../lib/format'

/**
 * Pacientes que llegaron a la pantalla de pago y no pagaron. Sale del
 * recorrido del paciente (migración 247), que existe desde el 2026-11-25:
 * lo anterior a esa fecha no aparece acá. Sólo web: la app no anota hitos.
 */
const QUE_PASO = {
  fallo: 'Le falló el pago',
  sin_profesional: 'Nadie lo atendió',
  cargo_tarjeta: 'Cargó la tarjeta y no siguió',
  no_intento: 'No intentó pagar',
}

export default function PagosSinConcretar({ incluirPrueba }) {
  const [filas, setFilas] = useState(undefined) // undefined = cargando
  const [error, setError] = useState(null)

  useEffect(() => {
    let vivo = true
    setFilas(undefined)
    setError(null)
    paymentsService.getPagosSinConcretar({ incluirPrueba })
      .then((r) => { if (vivo) setFilas(r) })
      .catch((e) => { if (vivo) setError(e?.message || 'No se pudo cargar') })
    return () => { vivo = false }
  }, [incluirPrueba])

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-1">
        <h2 className="font-semibold text-text-primary">Llegaron al pago y no pagaron</h2>
        {Array.isArray(filas) && <span className="text-xs text-text-secondary">{filas.length} pacientes</span>}
      </div>
      <p className="text-xs text-text-tertiary mb-4">Últimos 30 días, sólo la web. Se registra desde el 25/11/2026.</p>

      {error ? (
        <p className="text-sm text-danger">{error}</p>
      ) : filas === undefined ? (
        <div className="space-y-2">{[1, 2].map((i) => <div key={i} className="h-10 bg-bg-surface rounded-lg animate-pulse" />)}</div>
      ) : filas.length === 0 ? (
        <div className="flex flex-col items-center py-8 text-center">
          <Users className="h-8 w-8 text-text-muted mb-2" />
          <p className="text-text-secondary text-sm">Nadie quedó a mitad del pago</p>
        </div>
      ) : (
        <div className="overflow-x-auto -mx-4 sm:mx-0">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr>
                <th className="table-header">Llegó al pago</th>
                <th className="table-header">Paciente</th>
                <th className="table-header">Contacto</th>
                <th className="table-header text-right">Veces</th>
                <th className="table-header">Qué pasó</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.pacienteId} className="table-row">
                  <td className="table-cell whitespace-nowrap text-text-tertiary">{formatDate(f.llegoAt)}</td>
                  <td className="table-cell truncate max-w-[180px]">
                    {f.nombre || '—'}
                    {f.esPrueba && <span className="ml-1.5 text-[10px] uppercase tracking-wide text-text-muted">prueba</span>}
                  </td>
                  <td className="table-cell text-text-secondary">
                    <div className="truncate max-w-[220px]">{f.email || '—'}</div>
                    {f.telefono && <div className="text-xs text-text-tertiary">{f.telefono}</div>}
                  </td>
                  <td className="table-cell text-right">{f.veces}</td>
                  <td className="table-cell">
                    <span className={f.quePaso === 'fallo' ? 'text-xs font-medium text-danger' : 'text-xs text-text-tertiary'}>
                      {QUE_PASO[f.quePaso]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
