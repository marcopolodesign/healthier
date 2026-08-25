import { useEffect, useState } from 'react'
import { Copy, Check, ShareNetwork } from '@phosphor-icons/react'
import { referralService } from '../../services/referralService'
import WhatsAppMark from '../icons/WhatsAppMark'
import { toast } from '../Toast'
import { track } from '../../utils/analytics'

/**
 * El link que el profesional le manda a los pacientes que ya atiende afuera.
 *
 * Vive en el Inicio y no en Configuración a propósito: el link sólo sirve si se
 * manda, y algo que hay que ir a buscar a una pantalla de ajustes no se manda.
 * Los contadores están abajo por la misma razón — es lo que convierte "tengo un
 * link" en "mi link trajo tres pacientes".
 */
export default function ReferralLinkCard({ codigo, nombre }) {
  const [copiado, setCopiado] = useState(false)
  const [stats, setStats] = useState(null)

  const url = codigo ? referralService.buildUrl(codigo) : null

  useEffect(() => {
    if (!codigo) return
    referralService.myStats().then(setStats).catch(() => setStats(null))
  }, [codigo])

  if (!codigo) return null

  const primerNombre = nombre?.split(' ').slice(0, 2).join(' ') ?? 'tu profesional'
  const mensaje =
    `Hola! Ahora atiendo por Healthier. Desde acá podés sacar turno conmigo, ` +
    `recibir tus recetas y tener tu historia clínica siempre a mano: ${url}`

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopiado(true)
      track('referral_link_copy', { codigo })
      setTimeout(() => setCopiado(false), 2000)
    } catch {
      toast.error('No se pudo copiar el link. Copialo a mano desde el recuadro.')
    }
  }

  const compartir = async () => {
    track('referral_link_share', { codigo, method: 'native' })
    try {
      await navigator.share({ title: 'Healthier', text: mensaje, url })
    } catch {
      // El usuario canceló el diálogo del sistema, o el navegador no soporta
      // `share`. En los dos casos no hay nada que informar.
    }
  }

  return (
    <div className="card">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-2xl bg-brand-muted flex items-center justify-center shrink-0">
          <ShareNetwork className="h-6 w-6 text-brand" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold text-text-primary">Tu link para tus pacientes</h2>
          <p className="text-sm text-text-secondary mt-0.5">
            Mandáselo a los pacientes que ya atendés. Los que entren por acá quedan asociados a vos.
          </p>

          <div className="mt-4 flex flex-col sm:flex-row gap-2">
            <div className="flex-1 min-w-0 rounded-xl border border-border-default bg-bg-surface px-3 py-2.5">
              <p className="font-mono text-sm text-text-primary truncate" title={url}>{url}</p>
            </div>
            {/* En mobile la columna de contenido queda angosta (la tarjeta le
                come 48px con el ícono), y los tres botones sumaban ~430px en
                ~270px disponibles: se salían de la tarjeta (verificado en el
                simulador, 2026-08-25). Ahora envuelven y se reparten el ancho
                de a dos por fila; en desktop siguen en una sola línea. */}
            <div className="flex flex-wrap gap-2 sm:flex-nowrap sm:shrink-0">
              <button
                onClick={copiar}
                className="btn-secondary inline-flex flex-1 sm:flex-none min-w-[7.5rem] items-center justify-center gap-1.5 whitespace-nowrap"
              >
                {copiado
                  ? <><Check className="h-4 w-4" /> Copiado</>
                  : <><Copy className="h-4 w-4" /> Copiar</>}
              </button>
              <a
                href={`https://wa.me/?text=${encodeURIComponent(mensaje)}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => track('referral_link_share', { codigo, method: 'whatsapp' })}
                className="btn-secondary inline-flex flex-1 sm:flex-none min-w-[7.5rem] items-center justify-center gap-1.5 whitespace-nowrap"
              >
                <WhatsAppMark className="w-4 h-4" /> WhatsApp
              </a>
              {typeof navigator !== 'undefined' && navigator.share && (
                <button onClick={compartir} className="btn-secondary sm:hidden inline-flex flex-1 min-w-[7.5rem] items-center justify-center gap-1.5 whitespace-nowrap">
                  <ShareNetwork className="h-4 w-4" /> Compartir
                </button>
              )}
            </div>
          </div>

          {stats && (
            <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
              <span className="text-text-secondary">
                <strong className="text-text-primary font-semibold">{stats.visitas}</strong> {stats.visitas === 1 ? 'visita' : 'visitas'}
              </span>
              <span className="text-text-secondary">
                <strong className="text-text-primary font-semibold">{stats.registros}</strong> {stats.registros === 1 ? 'se registró' : 'se registraron'}
              </span>
              <span className="text-text-secondary">
                <strong className="text-text-primary font-semibold">{stats.conConsulta}</strong> ya {stats.conConsulta === 1 ? 'sacó turno' : 'sacaron turno'}
              </span>
            </div>
          )}

          <p className="sr-only">Link de referido de {primerNombre}</p>
        </div>
      </div>
    </div>
  )
}
