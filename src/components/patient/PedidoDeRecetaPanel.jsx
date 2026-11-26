import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Stethoscope } from '@phosphor-icons/react'
import { formatARS } from '../../lib/format'
import { faseDeReceta } from '../../lib/pharmacyOrders'

const corto = id => `#${(id ?? '').slice(0, 8).toUpperCase()}`

/**
 * "Tu pedido" de un pedido con receta por resolver (migración 254). Versión 3
 * de Felipe — "Panel de color" — elegida por Mateo (2026-11-26), más la fila
 * de quién es el médico que lo tomó (de la Versión 2).
 *
 * El color dice dónde está la plata: lavanda = reservado, verde = cobrado,
 * neutro = liberado. Todo sale de lo que escribió el servidor.
 */
export default function PedidoDeRecetaPanel({ order, codigo, telefono, onVolver }) {
  const navigate = useNavigate()
  const fase = faseDeReceta(order)
  const medico = order.medico?.fullName ?? null
  const direccion = order.deliveryAddress

  const PASO = { pendiente: 2, en_preparacion: 2, enviado: 3, entregado: 4 }
  const v = {
    esperando_medico: {
      tono: 'lavanda',
      titulo: 'Esperando tu receta',
      bajada: `${medico ?? 'Un médico'} te va a llamar${telefono ? ` al ${telefono}` : ''}.`,
      eyebrow: 'Reservado, no cobrado',
      paso: 1,
    },
    farmacia_revisando: {
      tono: 'lavanda',
      titulo: 'La farmacia está revisando tu receta',
      bajada: 'Te avisamos apenas la aprueben.',
      eyebrow: 'Reservado, no cobrado',
      paso: 1,
    },
    cobrado: {
      tono: 'verde',
      titulo: order.status === 'enviado' ? 'Tu pedido está en camino'
        : order.status === 'entregado' ? 'Pedido entregado'
        : 'Receta lista. Tu pedido está en preparación',
      bajada: order.status === 'entregado' ? 'Llegó a destino.'
        : direccion ? `Lo llevamos a ${direccion}.` : 'La farmacia lo está preparando.',
      eyebrow: 'Cobrado',
      paso: PASO[order.status] ?? 2,
    },
    liberado: {
      tono: 'neutro',
      titulo: 'No se te cobró nada',
      bajada: order.recetaMotivoRechazo || order.cancellationReason || 'Cancelamos el pedido y liberamos la reserva de tu tarjeta.',
      eyebrow: 'Liberado, no se cobró',
      paso: null,
    },
  }[fase]

  const PANEL = {
    lavanda: 'bg-receta-nivel text-brand-tertiary-hover',
    verde: 'bg-brand-light text-brand-hover',
    neutro: 'bg-bg-surface-hover text-text-primary',
  }[v.tono]
  const BAJADA = { lavanda: 'text-brand-tertiary-hover', verde: 'text-brand-hover', neutro: 'text-text-secondary' }[v.tono]

  return (
    <div className="absolute inset-0 overflow-y-auto bg-bg-primary">
      <div className={`${PANEL} px-6 pt-5 pb-7`}>
        <div className="max-w-lg mx-auto">
          <div className="flex items-center justify-between">
            <button onClick={onVolver} aria-label="Volver" className="w-10 h-10 rounded-full bg-bg-secondary flex items-center justify-center">
              <ArrowLeft className="w-5 h-5 text-text-primary" />
            </button>
            <p className="text-[12px] font-semibold uppercase tracking-[0.14em] tabular-nums">Pedido {corto(order.id)}</p>
          </div>

          <h1 className="font-serif font-light text-[34px] leading-[1.1] mt-8">{v.titulo}</h1>
          <p className={`text-[16px] leading-[23px] mt-3 ${BAJADA}`}>{v.bajada}</p>

          <div className="mt-8 flex items-end justify-between gap-4">
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-[0.14em]">{v.eyebrow}</p>
              <p className="font-serif font-light text-[48px] leading-none mt-2">{formatARS(order.total)}</p>
            </div>
            {v.paso && <p className="text-[12px] font-semibold uppercase tracking-[0.14em] tabular-nums pb-1">{v.paso} de 4</p>}
          </div>
        </div>
      </div>

      <div className="px-6 py-6 pb-32 max-w-lg mx-auto space-y-7">
        {fase === 'liberado' && (
          <button
            onClick={() => navigate('/paciente/ondemand/clinica')}
            className="w-full py-4 rounded-full bg-brand hover:bg-brand-hover text-white text-[16px] font-medium"
          >
            Hacer videoconsulta
          </button>
        )}

        {order.status === 'enviado' && codigo?.code && (
          <div className="rounded-2xl bg-bg-secondary p-4 text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-tertiary">Código de entrega</p>
            <p className="my-2 font-mono text-[34px] leading-none tracking-[0.35em] text-text-primary">{codigo.code}</p>
            <p className="text-[13px] text-text-secondary">Decíselo a quien te traiga el pedido.</p>
          </div>
        )}

        {medico && fase !== 'farmacia_revisando' && (
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-bg-secondary flex items-center justify-center shrink-0">
              <Stethoscope className="w-5 h-5 text-brand-hover" />
            </div>
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-text-tertiary">Te atiende</p>
              <p className="text-[15px] text-text-primary">{medico}</p>
            </div>
          </div>
        )}

        <section>
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-text-tertiary mb-2">Productos</p>
          <ul className="space-y-2.5">
            {(order.items ?? []).map(it => (
              <li key={it.id} className="flex items-baseline justify-between gap-4 text-[15px]">
                <span className="text-text-primary">{it.medicationName}{it.quantity > 1 ? ` × ${it.quantity}` : ''}</span>
                <span className="text-text-secondary tabular-nums shrink-0">{formatARS(it.unitPrice * it.quantity)}</span>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-text-tertiary mb-2">Entrega</p>
          <p className="text-[15px] text-text-primary">{direccion || 'Sin dirección'}</p>
        </section>
      </div>
    </div>
  )
}
