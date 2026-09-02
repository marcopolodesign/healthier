import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Package, CaretRight } from '@phosphor-icons/react'
import { medicationOrdersService } from '../../services/medicationOrdersService'
import { toast } from '../../components/Toast'
import { formatARS as fmtPrice, formatDate } from '../../lib/format'
import { STATUS_PATIENT_LABEL } from '../../lib/pharmacyOrders'

/** Los pedidos de farmacia del paciente, del más nuevo al más viejo. */
export default function PharmacyOrders({ profile }) {
  const navigate = useNavigate()
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!profile?.id) return
    medicationOrdersService.getMyOrders(profile.id)
      .then(setOrders)
      .catch(err => toast.error(err?.message || 'Error al cargar tus pedidos'))
      .finally(() => setLoading(false))
  }, [profile?.id])

  return (
    <div className="absolute inset-0 overflow-y-auto bg-bg-primary">
      <div className="sticky top-0 z-20 bg-bg-primary/95 backdrop-blur-sm border-b border-border-default">
        <div className="flex items-center gap-3 px-4 py-4 max-w-lg mx-auto">
          <button onClick={() => navigate(-1)} className="w-9 h-9 rounded-full bg-bg-secondary border border-border-default flex items-center justify-center flex-shrink-0">
            <ArrowLeft className="w-5 h-5 text-text-primary" />
          </button>
          <h2 className="flex-1 text-center font-bold text-lg text-text-primary">Mis pedidos</h2>
          <div className="w-9" />
        </div>
      </div>

      <div className="px-4 py-6 pb-32 max-w-lg mx-auto space-y-2">
        {loading ? (
          <div className="h-20 rounded-2xl bg-bg-secondary animate-pulse" />
        ) : orders.length === 0 ? (
          <div className="text-center py-16">
            <Package className="h-10 w-10 text-text-muted mx-auto mb-3" />
            <p className="text-text-secondary text-[14px]">Todavía no hiciste ningún pedido</p>
            <button onClick={() => navigate('/paciente/farmacia')} className="mt-3 text-brand underline text-[13px]">Ir a Farmacia</button>
          </div>
        ) : orders.map(o => (
          <button
            key={o.id}
            onClick={() => navigate(`/paciente/farmacia/pedido/${o.id}`)}
            className="w-full text-left rounded-2xl border border-border-default bg-bg-surface p-4 flex items-center gap-3 hover:bg-bg-secondary transition-colors"
          >
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-text-primary">{STATUS_PATIENT_LABEL[o.status]}</p>
              <p className="text-[11px] text-text-secondary">
                {formatDate(o.createdAt)} · {(o.items ?? []).length} medicamento{(o.items ?? []).length !== 1 ? 's' : ''} · {fmtPrice(o.total)}
              </p>
            </div>
            <CaretRight className="w-4 h-4 text-text-tertiary shrink-0" />
          </button>
        ))}
      </div>
    </div>
  )
}
