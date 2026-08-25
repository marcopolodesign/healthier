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

  // Botón compacto: ícono arriba, label abajo, esquinas suaves (no pill) y los
  // tres repartiéndose la fila en partes iguales (Mateo, 2026-08-25). Antes eran
  // `btn-secondary` —pills con 24px de padding a cada lado— en una fila que no
  // envolvía: en mobile sumaban ~430px contra ~270px disponibles y se salían de
  // la tarjeta.
  const claseBoton =
    'flex-1 min-w-0 flex flex-col items-center justify-center gap-1.5 rounded-xl ' +
    'border border-border-default bg-bg-surface px-2 py-3 text-xs font-medium ' +
    'text-text-primary hover:border-brand hover:text-brand transition-colors'

  return (
    <div className="card">
      {/* El ícono va arriba y la tarjeta entera es una columna (Mateo,
          2026-08-25): en fila le comía 48px + gap al contenido, que en mobile
          es justo lo que hacía falta. */}
      <div className="w-11 h-11 rounded-xl bg-brand-muted flex items-center justify-center">
        <ShareNetwork className="h-5 w-5 text-brand" />
      </div>

      <h2 className="mt-3 font-semibold text-text-primary">Tu link para tus pacientes</h2>
      <p className="text-sm text-text-secondary mt-0.5">
        Mandáselo a los pacientes que ya atendés. Los que entren por acá quedan asociados a vos.
      </p>

      <div className="mt-4 rounded-xl border border-border-default bg-bg-surface px-3 py-2.5">
        <p className="font-mono text-sm text-text-primary truncate" title={url}>{url}</p>
      </div>

      <div className="mt-2 flex gap-2">
        <button onClick={copiar} className={claseBoton}>
          {copiado
            ? <><Check className="h-5 w-5" /> Copiado</>
            : <><Copy className="h-5 w-5" /> Copiar</>}
        </button>
        <a
          href={`https://wa.me/?text=${encodeURIComponent(mensaje)}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => track('referral_link_share', { codigo, method: 'whatsapp' })}
          className={claseBoton}
        >
          <WhatsAppMark className="w-5 h-5" /> WhatsApp
        </a>
        {typeof navigator !== 'undefined' && navigator.share && (
          <button onClick={compartir} className={claseBoton}>
            <ShareNetwork className="h-5 w-5" /> Compartir
          </button>
        )}
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
  )
}
