import { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Lightning, Clock, CircleNotch } from '@phosphor-icons/react'
import { ondemandService } from '../../services/ondemandService'
import { useVerticales } from '../../hooks/useVerticales'
import { toast } from '../Toast'

/**
 * Pedidos de consulta inmediata sonando (Teleclínica por despacho, migración 191).
 *
 * Les aparece a TODOS los profesionales elegibles a la vez — la RLS decide
 * quién los ve (especialidad de la vertical, on-demand prendido, MP conectado,
 * latido de la última hora). El primero que toca "Aceptar" se lo queda: la toma
 * es atómica en la base y el resto recibe "otro profesional la tomó".
 *
 * Al aceptar se reserva el pago en la tarjeta del paciente contra la cuenta de
 * Mercado Pago de quien aceptó. Si la tarjeta no pasa, la consulta igual queda
 * tomada y al paciente se le pide otra.
 */
function useSegundosRestantes(expiresAt) {
  const calc = () => Math.max(0, Math.floor((new Date(expiresAt) - Date.now()) / 1000))
  const [left, setLeft] = useState(calc)
  useEffect(() => {
    const iv = setInterval(() => setLeft(calc()), 1000)
    return () => clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expiresAt])
  return left
}

function haceCuanto(iso) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso)) / 1000))
  return s < 60 ? `hace ${s} s` : `hace ${Math.floor(s / 60)} min`
}

function PedidoCard({ pedido, nombreVertical, onAceptar, aceptando }) {
  const left = useSegundosRestantes(pedido.expiresAt)
  if (left <= 0) return null
  const mm = String(Math.floor(left / 60)).padStart(2, '0')
  const ss = String(left % 60).padStart(2, '0')
  return (
    <div className="rounded-2xl border-2 border-brand bg-brand-muted/40 p-4 flex items-center gap-3" data-testid="pedido-ondemand">
      <div className="w-11 h-11 rounded-full bg-brand flex items-center justify-center shrink-0">
        <Lightning className="h-5 w-5 text-white" weight="fill" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[15px] font-semibold text-text-primary truncate">Consulta inmediata · {nombreVertical}</p>
        <p className="text-xs text-text-secondary truncate">Paciente esperando · {haceCuanto(pedido.createdAt)}</p>
      </div>
      <span className={`hidden sm:flex items-center gap-1 text-xs font-mono tabular-nums shrink-0 ${left <= 30 ? 'text-danger' : 'text-text-secondary'}`}>
        <Clock className="h-3.5 w-3.5" /> {mm}:{ss}
      </span>
      <button
        onClick={() => onAceptar(pedido.id)}
        disabled={aceptando}
        className="btn-primary text-[15px] px-5 py-3 shrink-0 disabled:opacity-60"
      >
        {aceptando ? <CircleNotch className="h-4 w-4 animate-spin" /> : 'Aceptar'}
      </button>
    </div>
  )
}

export default function PedidosOndemand({ activo, onTomada }) {
  const navigate = useNavigate()
  const { verticalesById } = useVerticales()
  const [pedidos, setPedidos] = useState([])
  const [aceptandoId, setAceptandoId] = useState(null)
  const aceptandoRef = useRef(false)

  const cargar = useCallback(() => {
    ondemandService.getPedidosAbiertos().then(setPedidos).catch(() => {})
  }, [])

  useEffect(() => {
    if (!activo) { setPedidos([]); return }
    cargar()
    // Realtime trae los nuevos; el refetch resuelve el resto (otro lo tomó,
    // venció) sin replicar acá las reglas de visibilidad, que viven en la RLS.
    const desuscribir = ondemandService.suscribir('profesional', null, cargar)
    const iv = setInterval(cargar, 10_000)
    return () => { desuscribir(); clearInterval(iv) }
  }, [activo, cargar])

  const aceptar = async (requestId) => {
    if (aceptandoRef.current) return
    aceptandoRef.current = true
    setAceptandoId(requestId)
    try {
      const r = await ondemandService.aceptar(requestId)
      if (!r?.tomada) {
        toast.info('Otro profesional ya tomó esta consulta.')
        return
      }
      onTomada?.(r.consultationId)
      if (r.pago === 'rechazado') {
        toast.warning('Tomaste la consulta. La tarjeta del paciente fue rechazada: le pedimos otra y te avisamos.')
        return
      }
      toast.success('Consulta tomada — el paciente está entrando')
      navigate(`/profesional/videollamada/${r.consultationId}`)
    } catch (err) {
      toast.error(err?.message ?? 'No pudimos aceptar la consulta.')
    } finally {
      aceptandoRef.current = false
      setAceptandoId(null)
      cargar()
    }
  }

  if (!pedidos.length) return null

  return (
    <div className="space-y-2 mb-6">
      <div className="flex items-center gap-2">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-brand" />
        </span>
        <h2 className="text-sm font-semibold text-text-primary">
          {pedidos.length === 1 ? 'Un paciente busca atención ahora' : `${pedidos.length} pacientes buscan atención ahora`}
        </h2>
      </div>
      {pedidos.map(p => (
        <PedidoCard
          key={p.id}
          pedido={p}
          nombreVertical={verticalesById[p.vertical]?.nombre ?? p.vertical}
          onAceptar={aceptar}
          aceptando={aceptandoId === p.id}
        />
      ))}
    </div>
  )
}

