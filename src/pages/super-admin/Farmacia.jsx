import { useState, useEffect } from 'react'
import { ShoppingBag, CheckCircle } from '@phosphor-icons/react'
import { medicationOrdersService } from '../../services/medicationOrdersService'
import { pharmacyAdminService } from '../../services/pharmacyAdminService'
import { toast } from '../../components/Toast'
import { formatARS, formatDate } from '../../lib/format'
import { STATUS_LABEL } from '../../lib/pharmacyOrders'

export default function SuperAdminFarmacia() {
  const [orders, setOrders] = useState([])
  const [mpStatus, setMpStatus] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      medicationOrdersService.listForPharmacy({}),
      pharmacyAdminService.getConnectionStatus(),
    ])
      .then(([ords, { data }]) => { setOrders(ords); setMpStatus(data) })
      .catch(() => toast.error('Error al cargar la vista de farmacia'))
      .finally(() => setLoading(false))
  }, [])

  const paid = orders.filter(o => o.paymentStatus === 'pagado')
  const gmv = paid.reduce((s, o) => s + Number(o.total || 0), 0)
  const byStatus = orders.reduce((acc, o) => { acc[o.status] = (acc[o.status] || 0) + 1; return acc }, {})

  if (loading) return <div className="p-6 space-y-3">{[1, 2, 3].map(i => <div key={i} className="h-16 bg-bg-surface rounded-lg animate-pulse" />)}</div>

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Farmacia</h1>
        <p className="text-text-secondary mt-1">Visibilidad de pedidos de medicamentos y conexión de pago</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card">
          <p className="text-xs text-text-muted uppercase font-semibold">Pedidos</p>
          <p className="text-2xl font-bold text-text-primary mt-1">{orders.length}</p>
        </div>
        <div className="card">
          <p className="text-xs text-text-muted uppercase font-semibold">Pagados</p>
          <p className="text-2xl font-bold text-text-primary mt-1">{paid.length}</p>
        </div>
        <div className="card">
          <p className="text-xs text-text-muted uppercase font-semibold">GMV</p>
          <p className="text-2xl font-bold text-text-primary mt-1">{formatARS(gmv)}</p>
        </div>
        <div className="card">
          <p className="text-xs text-text-muted uppercase font-semibold">Mercado Pago</p>
          <p className={`text-sm font-semibold mt-2 flex items-center gap-1.5 ${mpStatus?.connected ? 'text-emerald-600' : 'text-text-secondary'}`}>
            {mpStatus?.connected ? <><CheckCircle className="h-4 w-4" /> Conectado</> : 'No conectado'}
          </p>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        {Object.entries(byStatus).map(([status, count]) => (
          <span key={status} className="text-xs font-medium px-2.5 py-1 rounded-full bg-bg-secondary text-text-secondary">
            {STATUS_LABEL[status] || status}: {count}
          </span>
        ))}
      </div>

      <div className="card p-0 overflow-hidden">
        {orders.length === 0 ? (
          <div className="text-center py-16">
            <ShoppingBag className="h-12 w-12 text-text-muted mx-auto mb-3" />
            <p className="text-text-secondary">Todavía no hay pedidos de medicamentos</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-header">Pedido</th>
                <th className="table-header">Paciente</th>
                <th className="table-header">Estado</th>
                <th className="table-header">Pago</th>
                <th className="table-header hidden sm:table-cell">Total</th>
                <th className="table-header hidden md:table-cell">Fecha</th>
              </tr>
            </thead>
            <tbody>
              {orders.slice(0, 20).map(o => (
                <tr key={o.id} className="table-row">
                  <td className="table-cell font-mono text-xs text-text-secondary">#{o.id.slice(0, 8)}</td>
                  <td className="table-cell text-text-primary">{o.patient?.fullName || '—'}</td>
                  <td className="table-cell text-text-secondary">{STATUS_LABEL[o.status]}</td>
                  <td className="table-cell">
                    <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-full ${o.paymentStatus === 'pagado' ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-500'}`}>
                      {o.paymentStatus === 'pagado' ? 'Pagado' : 'No pagado'}
                    </span>
                  </td>
                  <td className="table-cell hidden sm:table-cell">{formatARS(o.total)}</td>
                  <td className="table-cell hidden md:table-cell text-text-secondary">{formatDate(o.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
