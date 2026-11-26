import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Prescription, CircleNotch } from '@phosphor-icons/react'
import { pedidosDeRecetaService } from '../../services/pedidosDeRecetaService'
import { usePolling } from '../../hooks/usePolling'
import { toast } from '../Toast'
import NoCorrespondeSheet from './NoCorrespondeSheet'

/**
 * En la consulta que abrió un médico de Healthier al tomar un pedido de receta
 * (migración 254): qué compró el paciente y los dos cierres — cobrar con la
 * receta emitida, o no recetar. Se refresca solo: apenas la receta sale del
 * Recetario de abajo, el botón de cobrar se habilita (lo dice el servidor).
 */
export default function PedidoDeRecetaEnConsulta({ consultationId }) {
  const navigate = useNavigate()
  const [pedido, setPedido] = useState(null)
  const [cobrando, setCobrando] = useState(false)
  const [rechazando, setRechazando] = useState(null)

  const cargar = useCallback(() => {
    pedidosDeRecetaService.deConsulta(consultationId).then(setPedido).catch(() => {})
  }, [consultationId])
  usePolling(cargar, 10_000)

  if (!pedido) return null

  const cobrar = async () => {
    setCobrando(true)
    try {
      await pedidosDeRecetaService.cobrar(pedido.orderId)
      toast.success('Cobrado. El pedido ya está en la farmacia.')
      navigate('/profesional/pedidos-receta')
    } catch (err) {
      toast.error(err?.message || 'No pudimos cobrar el pedido')
    } finally {
      setCobrando(false)
    }
  }

  return (
    <div className="rounded-2xl bg-receta-nivel p-5 flex flex-col gap-3">
      <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.14em] text-brand-tertiary-hover">
        <Prescription className="w-4 h-4" /> Pedido de receta de farmacia
      </div>
      <ul className="text-[15px] text-text-primary space-y-1">
        {(pedido.items ?? []).map((it, i) => (
          <li key={i}>{it.nombre}{it.presentacion ? ` — ${it.presentacion}` : ''}{it.cantidad > 1 ? ` × ${it.cantidad}` : ''}</li>
        ))}
      </ul>
      <p className="text-[14px] text-text-secondary">
        {pedido.listaParaCobrar
          ? 'La receta ya está emitida. Cobrá y el pedido pasa a la farmacia.'
          : 'Emití la receta de estos medicamentos en el Recetario de abajo. Después cobrás desde acá.'}
      </p>
      <button
        onClick={cobrar}
        disabled={!pedido.listaParaCobrar || cobrando}
        className="w-full py-3.5 rounded-full bg-brand hover:bg-brand-hover text-white text-[15px] font-medium flex items-center justify-center gap-2 disabled:opacity-40"
      >
        {cobrando && <CircleNotch className="w-4 h-4 animate-spin" />} Receta lista: cobrar y enviar a la farmacia
      </button>
      <button onClick={() => setRechazando(pedido)} className="text-[14px] text-text-secondary">No corresponde recetar</button>

      <NoCorrespondeSheet
        pedido={rechazando}
        onCerrar={() => setRechazando(null)}
        onConfirmar={async motivo => {
          await pedidosDeRecetaService.rechazar(pedido.orderId, motivo)
          toast.success('Listo. Se canceló el pedido y no se le cobró nada.')
          navigate('/profesional/pedidos-receta')
        }}
      />
    </div>
  )
}
