import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Package, CaretRight } from '@phosphor-icons/react'
import { medicationOrdersService } from '../../services/medicationOrdersService'
import { farmaciaVisible } from '../../lib/featureFlags'
import { STATUS_FLOW, STATUS_PATIENT_LABEL, STATUS_PATIENT_HINT } from '../../lib/pharmacyOrders'
import { usePolling } from '../../hooks/usePolling'

// El estado lo cambia la farmacia desde su panel, así que la única forma de
// que el paciente lo vea moverse es volver a preguntar. Un minuto alcanza: no
// es una videollamada, es un pedido que tarda horas. `usePolling` lo frena
// mientras la pestaña esté en segundo plano.
const REFRESCO_MS = 60_000

/**
 * El pedido de farmacia en curso, en el inicio del paciente.
 *
 * No se muestra nada si no hay pedido activo — que es también la razón por la
 * que Farmacia puede seguir afuera del menú sin que esto quede huérfano
 * (decisión de Mateo, 2026-09-02): lo ve el que ya compró.
 */
export default function ActivePharmacyOrderCard({ profile }) {
  const navigate = useNavigate()
  const [order, setOrder] = useState(null)

  const cargar = useCallback(() => {
    if (!profile?.id || !farmaciaVisible(profile)) return
    medicationOrdersService.getActiveOrders(profile.id)
      .then(pedidos => setOrder(pedidos?.[0] ?? null))
      .catch(() => {}) // aditivo: nunca rompe el inicio
  }, [profile])

  usePolling(cargar, REFRESCO_MS)

  if (!order) return null

  const paso = STATUS_FLOW.indexOf(order.status)
  const cantidad = (order.items ?? []).reduce((s, it) => s + it.quantity, 0)

  return (
    <button
      onClick={() => navigate(`/paciente/farmacia/pedido/${order.id}`)}
      className="w-full text-left rounded-2xl border border-border-default bg-bg-surface p-4 flex items-center gap-3 hover:bg-bg-secondary transition-colors"
    >
      <div className="w-10 h-10 rounded-full bg-brand/10 flex items-center justify-center shrink-0">
        <Package className="w-5 h-5 text-brand" weight="fill" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-text-primary">{STATUS_PATIENT_LABEL[order.status]}</p>
        <p className="text-[11px] text-text-secondary truncate">
          {cantidad} medicamento{cantidad !== 1 ? 's' : ''} · {STATUS_PATIENT_HINT[order.status]}
        </p>
        <div className="flex gap-1 mt-2">
          {STATUS_FLOW.map((step, i) => (
            <span key={step} className={`h-1 flex-1 rounded-full ${i <= paso ? 'bg-brand' : 'bg-border-default'}`} />
          ))}
        </div>
      </div>
      <CaretRight className="w-4 h-4 text-text-tertiary shrink-0" />
    </button>
  )
}
