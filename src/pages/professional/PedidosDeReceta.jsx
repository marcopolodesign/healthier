import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Phone, Prescription, CircleNotch } from '@phosphor-icons/react'
import { pedidosDeRecetaService } from '../../services/pedidosDeRecetaService'
import { usePolling } from '../../hooks/usePolling'
import { toast } from '../../components/Toast'
import { formatARS } from '../../lib/format'
import WhatsAppMark from '../../components/icons/WhatsAppMark'
import NoCorrespondeSheet from '../../components/professional/NoCorrespondeSheet'

// Un pedido nuevo le suena a todos los médicos de Healthier (push, migración
// 256): la lista se refresca sola para que el que ya tomó otro desaparezca.
const REFRESCO_MS = 15_000

function haceCuanto(iso) {
  if (!iso) return ''
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  return h < 24 ? `${h} h` : `${Math.floor(h / 24)} d`
}

const hora = iso => iso
  ? new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })
  : ''

const productos = items => (items ?? [])
  .map(it => `${it.nombre}${it.cantidad > 1 ? ` × ${it.cantidad}` : ''}`)
  .join(' · ')

const BOTON = 'w-full py-3.5 rounded-full bg-brand hover:bg-brand-hover text-white text-[15px] font-medium'

const SEGMENTOS = [
  { id: 'nuevos', label: 'Nuevos' },
  { id: 'tuyos', label: 'Tuyos' },
  { id: 'hoy', label: 'Hoy' },
]

/**
 * Pedidos de receta — el tablero del médico de Healthier (migración 254).
 * Versión 3 de Felipe, "Tablero por estado", elegida por Mateo (2026-11-26):
 * Nuevos · Tuyos · Hoy. En escritorio, tres columnas; en el teléfono (y en la
 * app, que la abre en un WebView) un segmento por vez.
 *
 * Tomar crea una consulta sin costo con el paciente y abre el panel de
 * consulta de siempre (historia clínica + Recetario). Con la receta emitida,
 * "Receta lista" cobra la reserva y el pedido pasa a la farmacia. Quién puede
 * qué y si de verdad hay receta lo valida el servidor.
 */
export default function PedidosDeReceta() {
  const navigate = useNavigate()
  const [vivos, setVivos] = useState([])
  const [hoy, setHoy] = useState([])
  const [cargando, setCargando] = useState(true)
  const [segmento, setSegmento] = useState('nuevos')
  const [ocupado, setOcupado] = useState(null)
  const [rechazando, setRechazando] = useState(null)

  const cargar = useCallback(async () => {
    try {
      const [v, h] = await Promise.all([pedidosDeRecetaService.listar(), pedidosDeRecetaService.resueltosHoy()])
      setVivos(v); setHoy(h)
    } catch (err) {
      toast.error(err?.message || 'No pudimos cargar los pedidos de receta')
    } finally {
      setCargando(false)
    }
  }, [])

  usePolling(cargar, REFRESCO_MS)

  const nuevos = vivos.filter(p => p.recetaEstado === 'pendiente')
  const tuyos = vivos.filter(p => p.tomadoPorMi)
  const columnas = { nuevos, tuyos, hoy }

  const tomar = async p => {
    setOcupado(p.orderId)
    try {
      const consultaId = await pedidosDeRecetaService.tomar(p.orderId)
      navigate(`/profesional/consulta/${consultaId}`)
    } catch (err) {
      toast.error(err?.message || 'No pudimos tomar el pedido')
      cargar()
    } finally {
      setOcupado(null)
    }
  }

  const cobrar = async p => {
    setOcupado(p.orderId)
    try {
      await pedidosDeRecetaService.cobrar(p.orderId)
      toast.success('Cobrado. El pedido ya está en la farmacia.')
      cargar()
    } catch (err) {
      toast.error(err?.message || 'No pudimos cobrar el pedido')
    } finally {
      setOcupado(null)
    }
  }

  const rechazar = async motivo => {
    const p = rechazando
    await pedidosDeRecetaService.rechazar(p.orderId, motivo)
    toast.success('Listo. Se canceló el pedido y no se le cobró nada.')
    setRechazando(null)
    cargar()
  }

  // Funciones que devuelven JSX (no componentes): definidos acá adentro se
  // remontarían en cada refresco.
  const tarjeta = (p, tipo) => {
    const tel = p.pacienteTelefono
    return (
      <div key={p.orderId} className="rounded-[20px] bg-bg-surface p-5 flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[17px] text-text-primary truncate">{p.pacienteNombre ?? 'Paciente'}</p>
          <span className="text-[12px] uppercase tracking-[0.12em] text-text-tertiary tabular-nums shrink-0">
            {tipo === 'hoy' ? hora(p.resueltoAt) : haceCuanto(p.autorizadoAt)}
          </span>
        </div>
        <p className="text-[14px] text-text-secondary -mt-1">{productos(p.items)}</p>

        {tel && (
          <div className="flex items-center justify-between gap-3">
            <a href={`tel:${tel}`} className="text-[15px] text-text-primary tabular-nums">{tel}</a>
            <div className="flex gap-2 shrink-0">
              <a href={`tel:${tel}`} aria-label="Llamar" className="w-10 h-10 rounded-full bg-bg-surface-hover flex items-center justify-center">
                <Phone className="w-4.5 h-4.5 text-text-primary" />
              </a>
              <a href={`https://wa.me/${tel.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer" aria-label="WhatsApp"
                className="w-10 h-10 rounded-full bg-brand-light flex items-center justify-center">
                <WhatsAppMark className="w-4.5 h-4.5" />
              </a>
            </div>
          </div>
        )}

        {tipo === 'nuevos' && (
          <button onClick={() => tomar(p)} disabled={ocupado === p.orderId}
            className={`${BOTON} flex items-center justify-center gap-2 disabled:opacity-60`}>
            {ocupado === p.orderId && <CircleNotch className="w-4 h-4 animate-spin" />} Tomar
          </button>
        )}

        {tipo === 'tuyos' && (
          <>
            {p.listaParaCobrar ? (
              <button onClick={() => cobrar(p)} disabled={ocupado === p.orderId}
                className={`${BOTON} flex items-center justify-center gap-2 disabled:opacity-60`}>
                {ocupado === p.orderId && <CircleNotch className="w-4 h-4 animate-spin" />} Receta lista: cobrar y enviar
              </button>
            ) : (
              <button onClick={() => navigate(`/profesional/consulta/${p.consultaId}`)}
                className={BOTON}>
                Abrir la consulta y hacer la receta
              </button>
            )}
            {p.listaParaCobrar && (
              <button onClick={() => navigate(`/profesional/consulta/${p.consultaId}`)} className="text-[14px] text-text-secondary">
                Abrir la consulta
              </button>
            )}
            <button onClick={() => setRechazando(p)} className="text-[14px] text-text-secondary">No corresponde recetar</button>
          </>
        )}

        {tipo === 'hoy' && (
          <p className={`text-[14px] ${p.recetaEstado === 'resuelta' ? 'text-brand-hover' : 'text-text-secondary'}`}>
            {p.recetaEstado === 'resuelta'
              ? `Enviado a la farmacia · ${formatARS(p.total)}`
              : `No se recetó · ${p.motivo ?? ''}`}
          </p>
        )}
      </div>
    )
  }

  const columna = ({ id, label }) => (
    <section key={id} className={`flex flex-col gap-3 ${segmento === id ? '' : 'hidden lg:flex'}`}>
      <div className="hidden lg:flex items-center justify-between px-1 text-[12px] font-semibold uppercase tracking-[0.14em] text-text-tertiary">
        <span>{label}</span><span className="tabular-nums">{columnas[id].length}</span>
      </div>
      {columnas[id].length === 0 ? (
        <p className="px-1 py-6 text-[14px] text-text-tertiary">
          {id === 'nuevos' ? 'No hay pedidos nuevos.' : id === 'tuyos' ? 'No tenés pedidos tomados.' : 'Todavía no resolviste ninguno hoy.'}
        </p>
      ) : columnas[id].map(p => tarjeta(p, id))}
    </section>
  )

  return (
    <div className="space-y-6 animate-fade-in pb-12">
      <div>
        <h1 className="page-title">Pedidos de receta</h1>
        <p className="text-text-secondary mt-1">Pacientes que compraron un remedio con receta y esperan que los llames.</p>
      </div>

      <div className="flex gap-2 lg:hidden">
        {SEGMENTOS.map(s => (
          <button key={s.id} onClick={() => setSegmento(s.id)}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
              segmento === s.id ? 'bg-brand text-white' : 'bg-bg-surface text-text-secondary'}`}>
            {s.label}{!cargando && ` (${columnas[s.id].length})`}
          </button>
        ))}
      </div>

      {cargando ? (
        <div className="grid lg:grid-cols-3 gap-4">{[1, 2, 3].map(i => <div key={i} className="h-48 bg-bg-surface rounded-[20px] animate-pulse" />)}</div>
      ) : (
        <div className="grid lg:grid-cols-3 gap-4 items-start">
          {SEGMENTOS.map(columna)}
        </div>
      )}

      {!cargando && nuevos.length + tuyos.length + hoy.length === 0 && (
        <div className="flex flex-col items-center py-6 text-center">
          <Prescription className="h-10 w-10 text-text-muted mb-3" />
          <p className="text-text-secondary text-sm">Cuando un paciente compre un remedio con receta, te llega un aviso y aparece acá.</p>
        </div>
      )}

      <NoCorrespondeSheet pedido={rechazando} onCerrar={() => setRechazando(null)} onConfirmar={rechazar} />
    </div>
  )
}
