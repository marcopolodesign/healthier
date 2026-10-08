import { useState, useEffect, useMemo } from 'react'
import { Lightning, CircleNotch, ArrowClockwise } from '@phosphor-icons/react'
import { toast } from '../../components/Toast'
import { formatDate } from '../../lib/format'
import MetricCard from '../../components/super-admin/MetricCard'
import { ondemandService } from '../../services/ondemandService'
import { useVerticales } from '../../hooks/useVerticales'

/**
 * Teleclínica — /super-admin/teleclinica
 *
 * Cada pedido de consulta inmediata (migración 191): a cuántos profesionales
 * les sonó, quién lo tomó y en cuánto, y qué pasó con la reserva en la tarjeta.
 * Es lo que permite ver si el despacho funciona — un pedido que vence con
 * "avisados: 0" no le sonó a nadie.
 */

const ESTADOS = {
  pending:   { label: 'Buscando',  clase: 'text-brand' },
  accepted:  { label: 'Tomado',    clase: 'text-green-700' },
  expired:   { label: 'Nadie aceptó', clase: 'text-amber-700' },
  cancelled: { label: 'Cancelado', clase: 'text-text-secondary' },
}
const PAGOS = {
  sin_pago:   'Bonificada',
  pendiente:  'Sin reservar',
  autorizado: 'Reservado',
  rechazado:  'Tarjeta rechazada',
}

/** Lo que pasó con la plata, mirando también cómo terminó la consulta. */
function pago(r) {
  if (r.estadoPago === 'autorizado') {
    if (r.consulta?.status === 'cancelled') return 'Liberado'
    if (r.consulta?.paymentStatus === 'paid') return 'Cobrado'
  }
  return PAGOS[r.estadoPago] ?? r.estadoPago
}

function demora(p) {
  if (!p.acceptedAt) return '—'
  const s = Math.round((new Date(p.acceptedAt) - new Date(p.createdAt)) / 1000)
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`
}

export default function SuperAdminTeleclinica() {
  const { verticalesById } = useVerticales()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      setRows(await ondemandService.getTodos({ limit: 200 }))
    } catch (err) {
      toast.error(err.message || 'No se pudieron cargar los pedidos')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  const resumen = useMemo(() => {
    const corte = Date.now() - 7 * 24 * 3600 * 1000
    const semana = rows.filter(r => new Date(r.createdAt).getTime() >= corte)
    return {
      total: semana.length,
      tomados: semana.filter(r => r.status === 'accepted').length,
      vencidos: semana.filter(r => r.status === 'expired').length,
      rechazos: semana.filter(r => r.estadoPago === 'rechazado').length,
    }
  }, [rows])

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl text-text-primary">Teleclínica</h1>
          <p className="text-text-secondary mt-1">Pedidos de consulta inmediata: a quién le sonó, quién lo tomó y qué pasó con el pago.</p>
        </div>
        <button onClick={load} className="btn-secondary flex items-center gap-2 shrink-0" disabled={loading}>
          <ArrowClockwise className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Actualizar
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricCard label="Últimos 7 días" value={resumen.total} />
        <MetricCard label="Tomados" value={resumen.tomados} tone="ok" />
        <MetricCard label="Nadie aceptó" value={resumen.vencidos} tone={resumen.vencidos > 0 ? 'bad' : 'neutral'} />
        <MetricCard label="Tarjeta rechazada" value={resumen.rechazos} tone={resumen.rechazos > 0 ? 'bad' : 'neutral'} />
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><CircleNotch className="h-6 w-6 animate-spin text-brand" /></div>
      ) : rows.length === 0 ? (
        <div className="text-center py-16 text-text-secondary">
          <Lightning className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">Todavía no hay pedidos</p>
        </div>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-default text-left text-xs uppercase tracking-wide text-text-tertiary">
                <th className="px-4 py-3 font-semibold">Fecha</th>
                <th className="px-4 py-3 font-semibold">Especialidad</th>
                <th className="px-4 py-3 font-semibold">Paciente</th>
                <th className="px-4 py-3 font-semibold">Avisados</th>
                <th className="px-4 py-3 font-semibold">Estado</th>
                <th className="px-4 py-3 font-semibold">Lo tomó</th>
                <th className="px-4 py-3 font-semibold">Demora</th>
                <th className="px-4 py-3 font-semibold">Pago</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-b border-border-default last:border-0 align-top">
                  <td className="px-4 py-3 text-text-secondary whitespace-nowrap tabular-nums">{formatDate(r.createdAt)}</td>
                  <td className="px-4 py-3 text-text-primary whitespace-nowrap">{verticalesById[r.vertical]?.nombre ?? r.vertical}</td>
                  <td className="px-4 py-3 text-text-secondary">{r.paciente?.fullName ?? '—'}</td>
                  <td className="px-4 py-3 tabular-nums">{r.avisados ?? '—'}</td>
                  <td className={`px-4 py-3 font-semibold whitespace-nowrap ${ESTADOS[r.status]?.clase ?? ''}`}>{ESTADOS[r.status]?.label ?? r.status}</td>
                  <td className="px-4 py-3 text-text-primary">{r.profesional?.fullName ?? '—'}</td>
                  <td className="px-4 py-3 tabular-nums whitespace-nowrap">{demora(r)}</td>
                  <td className="px-4 py-3">
                    <span className={r.estadoPago === 'rechazado' ? 'text-danger font-semibold' : 'text-text-secondary'}>{pago(r)}</span>
                    {r.pagoDetalle && <p className="text-xs text-text-tertiary font-mono">{r.pagoDetalle}</p>}
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
