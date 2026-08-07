import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Package, MapPin } from '@phosphor-icons/react'
import { medicationOrdersService } from '../../services/medicationOrdersService'
import { toast } from '../../components/Toast'
import { formatARS, formatDate } from '../../lib/format'

const STATUS_BADGE = {
  pendiente:       'bg-amber-50 text-amber-600',
  en_preparacion:  'bg-sky-50 text-sky-600',
  enviado:         'bg-brand-tertiary/10 text-brand-tertiary',
  entregado:       'bg-emerald-50 text-emerald-600',
  cancelado:       'bg-gray-100 text-gray-500',
}
const STATUS_LABEL = {
  pendiente: 'Pendiente',
  en_preparacion: 'En preparación',
  enviado: 'Enviado',
  entregado: 'Entregado',
  cancelado: 'Cancelado',
}
const NEXT_STATUS = {
  pendiente: 'en_preparacion',
  en_preparacion: 'enviado',
  enviado: 'entregado',
}
const NEXT_LABEL = {
  pendiente: 'Marcar en preparación',
  en_preparacion: 'Marcar enviado',
  enviado: 'Marcar entregado',
}

export default function PharmacyOrders({ profile }) {
  const navigate = useNavigate()
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [paymentFilter, setPaymentFilter] = useState('')
  const [updatingId, setUpdatingId] = useState(null)

  const canEdit = profile?.role === 'pharmacy_admin' || profile?.role === 'pharmacy_operator'

  const load = () => {
    setLoading(true)
    medicationOrdersService
      .listForPharmacy({ status: statusFilter || undefined, paymentStatus: paymentFilter || undefined })
      .then(setOrders)
      .catch(() => toast.error('Error al cargar pedidos'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [statusFilter, paymentFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  const advance = async (order, e) => {
    e.stopPropagation()
    const next = NEXT_STATUS[order.status]
    if (!next) return
    setUpdatingId(order.id)
    try {
      await medicationOrdersService.updateStatus(order.id, next)
      toast.success('Estado actualizado')
      setOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: next } : o))
    } catch {
      toast.error('Error al actualizar el estado')
    } finally {
      setUpdatingId(null)
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Pedidos</h1>
        <p className="text-text-secondary mt-1">{orders.length} pedido{orders.length !== 1 ? 's' : ''}</p>
      </div>

      <div className="flex gap-3">
        <select className="form-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">Todos los estados</option>
          {Object.keys(STATUS_LABEL).map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <select className="form-select" value={paymentFilter} onChange={e => setPaymentFilter(e.target.value)}>
          <option value="">Todos los pagos</option>
          <option value="pagado">Pagado</option>
          <option value="no_pagado">No pagado</option>
        </select>
      </div>

      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">{[1, 2, 3].map(i => <div key={i} className="h-16 bg-bg-surface rounded-lg animate-pulse" />)}</div>
        ) : orders.length === 0 ? (
          <div className="text-center py-16">
            <Package className="h-12 w-12 text-text-muted mx-auto mb-3" />
            <p className="text-text-secondary">No hay pedidos todavía</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-header">Pedido</th>
                <th className="table-header">Paciente</th>
                <th className="table-header hidden md:table-cell">Dirección</th>
                <th className="table-header">Estado</th>
                <th className="table-header">Pago</th>
                <th className="table-header hidden sm:table-cell">Total</th>
                {canEdit && <th className="table-header">Acción</th>}
              </tr>
            </thead>
            <tbody>
              {orders.map(o => (
                <tr key={o.id} className="table-row cursor-pointer" onClick={() => navigate(`/farmacia/pedidos/${o.id}`)}>
                  <td className="table-cell font-mono text-xs text-text-secondary">#{o.id.slice(0, 8)}</td>
                  <td className="table-cell">
                    <p className="font-medium text-text-primary text-sm">{o.patient?.fullName || '—'}</p>
                    <p className="text-xs text-text-secondary">{o.patient?.email}</p>
                  </td>
                  <td className="table-cell hidden md:table-cell text-text-secondary text-sm">
                    <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5 shrink-0" />{o.deliveryAddress || '—'}</span>
                  </td>
                  <td className="table-cell">
                    <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-full ${STATUS_BADGE[o.status]}`}>
                      {STATUS_LABEL[o.status]}
                    </span>
                  </td>
                  <td className="table-cell">
                    <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-full ${o.paymentStatus === 'pagado' ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-500'}`}>
                      {o.paymentStatus === 'pagado' ? 'Pagado' : 'No pagado'}
                    </span>
                  </td>
                  <td className="table-cell hidden sm:table-cell text-text-secondary">{formatARS(o.total)}</td>
                  {canEdit && (
                    <td className="table-cell">
                      {NEXT_STATUS[o.status] && (
                        <button
                          className="btn-secondary text-xs px-2.5 py-1.5"
                          disabled={updatingId === o.id}
                          onClick={e => advance(o, e)}
                        >
                          {updatingId === o.id ? '...' : NEXT_LABEL[o.status]}
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
