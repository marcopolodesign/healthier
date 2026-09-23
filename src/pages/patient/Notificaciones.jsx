import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Bell, CalendarBlank, VideoCamera, FileText, Package, CurrencyCircleDollar,
} from '@phosphor-icons/react'
import { notificacionesService } from '../../services/notificacionesService'
import { track } from '../../utils/analytics'

/** Ícono por tipo — spec: turno/consulta → calendario/video; receta → receta;
 *  pedido-* → farmacia/paquete; devolucion-* → dinero. */
function iconoDe(tipo) {
  if (tipo === 'profesional-listo') return VideoCamera
  if (tipo?.startsWith('turno') || tipo?.startsWith('recordatorio') || tipo === 'consulta-cancelada' || tipo === 'post-consulta') return CalendarBlank
  if (tipo?.startsWith('receta')) return FileText
  if (tipo?.startsWith('pedido')) return Package
  if (tipo?.startsWith('devolucion')) return CurrencyCircleDollar
  return Bell
}

function haceCuanto(iso) {
  const ms = Date.now() - new Date(iso).getTime()
  const min = Math.floor(ms / 60000)
  if (min < 1) return 'Recién'
  if (min < 60) return `Hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `Hace ${h} h`
  const d = Math.floor(h / 24)
  if (d < 7) return `Hace ${d} d`
  return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })
}

/**
 * `/paciente/notificaciones` — la campanita, spec 2026-09-23.
 *
 * Al abrirse marca TODAS como leídas (RPC sin args) — el contador vuelve a 0
 * de una. Tocar una lleva a `url` (ya es una ruta del website, la misma que
 * arma `send-push-notification` para el push — ver migración 167).
 */
export default function Notificaciones({ profile }) {
  const navigate = useNavigate()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!profile?.id) return
    let cancelled = false
    notificacionesService.listar(profile.id)
      .then(data => { if (!cancelled) setItems(data) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    // Aditivo: si falla marcar-como-leídas el paciente igual ve su lista, sólo
    // que el contador de la campanita no baja hasta la próxima vez.
    notificacionesService.marcarLeidas(null).catch(() => {})
    return () => { cancelled = true }
  }, [profile?.id])

  const abrir = (n) => {
    track('notificacion_open', { tipo: n.tipo, flow: 'paciente' })
    if (n.url) navigate(n.url)
  }

  return (
    <div className="absolute inset-0 bg-bg-primary overflow-y-auto scrollbar-hide animate-fade-in">
      <div className="max-w-2xl mx-auto px-6 pt-6 sm:pt-8 pb-32">
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => navigate(-1)}
            aria-label="Volver"
            className="w-10 h-10 rounded-full bg-bg-secondary border border-border-default flex items-center justify-center hover:bg-gray-100 transition-colors shrink-0"
          >
            <ArrowLeft className="w-5 h-5 text-text-primary" />
          </button>
          <h1 className="text-[26px] sm:text-[28px] font-light text-text-primary tracking-tight leading-none">Notificaciones</h1>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => <div key={i} className="h-20 bg-bg-secondary rounded-2xl border border-border-default animate-pulse" />)}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 bg-bg-secondary rounded-full flex items-center justify-center mb-4 border border-border-default">
              <Bell className="w-8 h-8 text-text-muted" />
            </div>
            <p className="font-semibold text-[16px] text-text-primary mb-1">Acá van a aparecer tus avisos</p>
            <p className="text-[13px] text-text-tertiary max-w-xs">Turnos confirmados, recetas, pedidos de farmacia y devoluciones.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {items.map(n => {
              const Icon = iconoDe(n.tipo)
              const noLeida = !n.leidaAt
              return (
                <button
                  key={n.id}
                  onClick={() => abrir(n)}
                  className={`text-left rounded-2xl border p-4 flex gap-3 items-start transition-colors ${
                    noLeida ? 'bg-brand-muted/40 border-brand/20' : 'bg-bg-secondary border-border-default hover:border-brand/30'
                  }`}
                >
                  <span className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${noLeida ? 'bg-white' : 'bg-white/70'}`}>
                    <Icon className="w-5 h-5 text-brand" />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="flex items-center gap-2">
                      <span className={`text-[14px] text-text-primary leading-snug ${noLeida ? 'font-semibold' : 'font-medium'}`}>{n.titulo}</span>
                      {noLeida && <span className="w-2 h-2 rounded-full bg-brand shrink-0" />}
                    </span>
                    {n.cuerpo && <span className="block text-[13px] text-text-secondary mt-0.5 leading-snug">{n.cuerpo}</span>}
                    <span className="block text-[11px] text-text-muted mt-1">{haceCuanto(n.createdAt)}</span>
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
