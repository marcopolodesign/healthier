import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, MapPin, Pill } from '@phosphor-icons/react'
import { medicationOrdersService } from '../../services/medicationOrdersService'
import { toast } from '../../components/Toast'
import { formatARS, formatDate } from '../../lib/format'

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

export default function PharmacyOrderDetail({ profile }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const [order, setOrder] = useState(null)
  const [payment, setPayment] = useState(null)
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)

  const canEdit = profile?.role === 'pharmacy_admin' || profile?.role === 'pharmacy_operator'

  useEffect(() => {
    setLoading(true)
    Promise.all([
      medicationOrdersService.getById(id),
      medicationOrdersService.getPaymentForOrder(id),
    ])
      .then(([o, p]) => { setOrder(o); setPayment(p) })
      .catch(() => toast.error('Error al cargar el pedido'))
      .finally(() => setLoading(false))
  }, [id])

  const advance = async () => {
    const next = NEXT_STATUS[order.status]
    if (!next) return
    setUpdating(true)
    try {
      const updated = await medicationOrdersService.updateStatus(order.id, next)
      setOrder(o => ({ ...o, status: updated.status }))
      toast.success('Estado actualizado')
    } catch {
      toast.error('Error al actualizar el estado')
    } finally {
      setUpdating(false)
    }
  }

  if (loading) return <div className="p-6 space-y-3">{[1, 2, 3].map(i => <div key={i} className="h-16 bg-bg-surface rounded-lg animate-pulse" />)}</div>
  if (!order) return <p className="text-text-secondary">Pedido no encontrado</p>

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl">
      <button className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary" onClick={() => navigate('/farmacia/pedidos')}>
        <ArrowLeft className="h-4 w-4" /> Volver a pedidos
      </button>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary font-mono">#{order.id.slice(0, 8)}</h1>
          <p className="text-text-secondary mt-1">{formatDate(order.createdAt)}</p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <span className="text-[10px] font-semibold uppercase px-2 py-1 rounded-full bg-brand-tertiary/10 text-brand-tertiary">
            {STATUS_LABEL[order.status]}
          </span>
          <span className={`text-[10px] font-semibold uppercase px-2 py-1 rounded-full ${order.paymentStatus === 'pagado' ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-500'}`}>
            {order.paymentStatus === 'pagado' ? 'Pagado' : 'No pagado'}
          </span>
        </div>
      </div>

      <div className="card space-y-1">
        <p className="text-xs uppercase text-text-muted font-semibold">Paciente</p>
        <p className="text-text-primary font-medium">{order.patient?.fullName || '—'}</p>
        <p className="text-sm text-text-secondary">{order.patient?.email}{order.patient?.phone ? ` · ${order.patient.phone}` : ''}</p>
        <p className="text-sm text-text-secondary flex items-center gap-1.5 mt-2">
          <MapPin className="h-4 w-4 shrink-0" /> {order.deliveryAddress || 'Sin dirección confirmada'}
        </p>
      </div>

      <div className="card space-y-3">
        <p className="text-xs uppercase text-text-muted font-semibold">Medicamentos</p>
        {(order.items ?? []).map(it => (
          <div key={it.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
            <div className="flex items-center gap-2">
              <Pill className="h-4 w-4 text-brand shrink-0" />
              <div>
                <p className="text-sm font-medium text-text-primary">{it.medicationName}{it.presentation ? ` — ${it.presentation}` : ''}</p>
                <p className="text-xs text-text-secondary">x{it.quantity}{it.requiresPrescription ? ' · requiere receta' : ''}</p>
              </div>
            </div>
            <p className="text-sm text-text-secondary">{formatARS(it.unitPrice * it.quantity)}</p>
          </div>
        ))}
        <div className="flex items-center justify-between pt-2 font-semibold text-text-primary">
          <p>Total</p>
          <p>{formatARS(order.total)}</p>
        </div>
      </div>

      {payment && (
        <div className="card space-y-2">
          <p className="text-xs uppercase text-text-muted font-semibold">Pago</p>
          <div className="flex justify-between text-sm"><span className="text-text-secondary">Cobrado</span><span className="text-text-primary">{formatARS(payment.grossAmount)}</span></div>
          <div className="flex justify-between text-sm"><span className="text-text-secondary">Comisión Healthier</span><span className="text-text-primary">{formatARS(payment.platformFee)}</span></div>
          <div className="flex justify-between text-sm font-semibold"><span className="text-text-primary">Neto farmacia</span><span className="text-text-primary">{formatARS(payment.netToProfessional)}</span></div>
        </div>
      )}

      {canEdit && NEXT_STATUS[order.status] && (
        <button className="btn-primary" disabled={updating} onClick={advance}>
          {updating ? 'Actualizando...' : `Marcar ${STATUS_LABEL[NEXT_STATUS[order.status]].toLowerCase()}`}
        </button>
      )}
    </div>
  )
}
