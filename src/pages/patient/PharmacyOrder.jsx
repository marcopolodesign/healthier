import { useState, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, MapPin, Pill, Check, Package, Truck, House, XCircle } from '@phosphor-icons/react'
import { medicationOrdersService } from '../../services/medicationOrdersService'
import { toast } from '../../components/Toast'
import { formatARS as fmtPrice, formatDate } from '../../lib/format'
import { STATUS_FLOW, STATUS_PATIENT_LABEL, STATUS_PATIENT_HINT } from '../../lib/pharmacyOrders'
import { usePolling } from '../../hooks/usePolling'

const STEP_ICON = { pendiente: Check, en_preparacion: Package, enviado: Truck, entregado: House }

// Quien está esperando un pedido vuelve a esta pantalla justamente para ver si
// cambió algo. Se refresca sola cada 20s en vez de pedirle que recargue —
// `usePolling` la frena mientras la pestaña esté en segundo plano.
const REFRESCO_MS = 20_000

export default function PharmacyOrder() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [order, setOrder] = useState(null)
  const [loading, setLoading] = useState(true)

  const primeraRef = useRef(true)
  const cargar = useCallback(async () => {
    try {
      const data = await medicationOrdersService.getById(id)
      setOrder(data)
    } catch (err) {
      // Sólo la primera carga avisa: un refresco de fondo que falla no tiene
      // por qué tirarle un cartel encima a quien está mirando el pedido.
      if (primeraRef.current) toast.error(err?.message || 'Error al cargar el pedido')
    } finally {
      primeraRef.current = false
      setLoading(false)
    }
  }, [id])

  usePolling(cargar, REFRESCO_MS)

  if (loading) {
    return (
      <div className="absolute inset-0 bg-bg-primary p-4 pt-20">
        <div className="h-40 rounded-2xl bg-bg-secondary animate-pulse max-w-lg mx-auto" />
      </div>
    )
  }

  if (!order) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-bg-primary px-8 text-center">
        <p className="text-text-tertiary text-[14px]">
          No encontramos ese pedido.{' '}
          <button onClick={() => navigate('/paciente/farmacia')} className="text-brand underline">Volver a Farmacia</button>
        </p>
      </div>
    )
  }

  const cancelado = order.status === 'cancelado'
  const pasoActual = STATUS_FLOW.indexOf(order.status)

  return (
    <div className="absolute inset-0 overflow-y-auto bg-bg-primary">
      <div className="sticky top-0 z-20 bg-bg-primary/95 backdrop-blur-sm border-b border-border-default">
        <div className="flex items-center gap-3 px-4 py-4 max-w-lg mx-auto">
          <button onClick={() => navigate(-1)} className="w-9 h-9 rounded-full bg-bg-secondary border border-border-default flex items-center justify-center flex-shrink-0">
            <ArrowLeft className="w-5 h-5 text-text-primary" />
          </button>
          <h2 className="flex-1 text-center font-bold text-lg text-text-primary">Tu pedido</h2>
          <div className="w-9" />
        </div>
      </div>

      <div className="px-4 py-6 pb-32 max-w-lg mx-auto space-y-4">
        <div>
          <p className="text-[11px] font-mono text-text-tertiary">#{order.id.slice(0, 8)}</p>
          <p className="text-[12px] text-text-secondary">{formatDate(order.createdAt)}</p>
        </div>

        {cancelado ? (
          <div className="rounded-2xl border border-danger/30 bg-danger/5 p-4 flex gap-3">
            <XCircle className="w-5 h-5 text-danger shrink-0 mt-0.5" weight="fill" />
            <div>
              <p className="text-[14px] font-semibold text-text-primary">{STATUS_PATIENT_LABEL.cancelado}</p>
              <p className="text-[12px] text-text-secondary mt-0.5">
                {order.cancellationReason || STATUS_PATIENT_HINT.cancelado}
              </p>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-border-default bg-bg-secondary p-4">
            <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-widest mb-4">Estado</p>
            <ol className="space-y-0">
              {STATUS_FLOW.map((step, i) => {
                const Icono = STEP_ICON[step]
                const hecho = i <= pasoActual
                const actual = i === pasoActual
                return (
                  <li key={step} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                        hecho ? 'bg-brand text-white' : 'bg-bg-primary border border-border-default text-text-tertiary'
                      }`}>
                        <Icono className="w-4 h-4" weight={hecho ? 'fill' : 'regular'} />
                      </div>
                      {i < STATUS_FLOW.length - 1 && (
                        <div className={`w-0.5 flex-1 min-h-[22px] ${i < pasoActual ? 'bg-brand' : 'bg-border-default'}`} />
                      )}
                    </div>
                    <div className="pb-4">
                      <p className={`text-[13px] leading-8 ${actual ? 'font-bold text-text-primary' : hecho ? 'font-medium text-text-primary' : 'text-text-tertiary'}`}>
                        {STATUS_PATIENT_LABEL[step]}
                      </p>
                      {actual && <p className="text-[11px] text-text-secondary -mt-2">{STATUS_PATIENT_HINT[step]}</p>}
                    </div>
                  </li>
                )
              })}
            </ol>
          </div>
        )}

        <div className="rounded-2xl border border-border-default bg-bg-secondary p-4">
          <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-widest mb-2 flex items-center gap-1.5">
            <MapPin className="w-3.5 h-3.5" /> Entrega
          </p>
          <p className="text-[13px] text-text-primary">{order.deliveryAddress || 'Sin dirección'}</p>
        </div>

        <div className="rounded-2xl border border-border-default bg-bg-secondary p-4">
          <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-widest mb-1">Medicamentos</p>
          <ul className="divide-y divide-border-default">
            {(order.items ?? []).map(it => (
              <li key={it.id} className="flex items-center gap-2 py-2">
                <Pill className="w-3.5 h-3.5 text-brand shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-text-primary truncate leading-tight">{it.medicationName}</p>
                  <p className="text-[10px] text-text-tertiary leading-tight">{it.quantity} × {fmtPrice(it.unitPrice)}</p>
                </div>
                <span className="text-[12px] font-semibold text-text-primary shrink-0">{fmtPrice(it.unitPrice * it.quantity)}</span>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between pt-3 mt-1 border-t border-border-default">
            <span className="text-[13px] font-semibold text-text-secondary">Total</span>
            <span className="text-[18px] font-black text-text-primary">{fmtPrice(order.total)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
