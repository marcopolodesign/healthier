import { useCallback, useEffect, useState } from 'react'
import { Check } from '@phosphor-icons/react'
import { referralService } from '../../services/referralService'
import WhatsAppMark from '../icons/WhatsAppMark'
import { toast } from '../Toast'
import { track } from '../../utils/analytics'

/**
 * "Invitá": mi código, mi link y cuántos se sumaron. La misma pieza para
 * paciente y profesional (sólo cambia el mensaje que se comparte y que el
 * profesional además ve sus visitas y cuántos ya sacaron turno). Sin montos ni
 * premios: todavía no están definidos. Sin bordes ni sombras: se separa por
 * relleno (propuesta de Felipe, 2026-11-10).
 */
export default function InvitaCard({ rol = 'patient', nombre }) {
  const [data, setData] = useState(null)
  const [stats, setStats] = useState(null) // sólo profesional: visitas / registros / con turno
  const [error, setError] = useState(false)
  const [copiado, setCopiado] = useState(false)

  const cargar = useCallback(() => {
    setError(false)
    setData(null)
    referralService.miPrograma().then(setData).catch(() => setError(true))
    if (rol === 'professional') referralService.myStats().then(setStats).catch(() => setStats(null))
  }, [rol])

  useEffect(() => { cargar() }, [cargar])

  const codigo = data?.codigo
  const url = codigo ? referralService.buildUrl(codigo) : null
  const mensaje = rol === 'professional'
    ? `¡Hola! Ahora atiendo por Healthier. Desde acá podés sacar turno conmigo, recibir tus recetas y tener tu historia clínica siempre a mano: ${url}`
    : `Te invito a Healthier: turnos, recetas y tu historia clínica en un solo lugar. ${url}`

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopiado(true)
      track('referral_link_copy', { codigo, rol })
      setTimeout(() => setCopiado(false), 2000)
    } catch {
      toast.error('No se pudo copiar el link.')
    }
  }

  const compartir = async () => {
    track('referral_link_share', { codigo, rol, method: 'native' })
    if (navigator.share) {
      try { await navigator.share({ title: 'Healthier', text: mensaje, url }) } catch { /* canceló */ }
    } else {
      await copiar()
    }
  }

  if (!data && !error) {
    return <div className="rounded-2xl bg-brand-muted h-64 animate-pulse" data-testid="invita-cargando" />
  }
  // Si falló la carga o el código no vino, se dice y se puede reintentar: nunca
  // "estamos preparando tu código" para siempre.
  if (error || !codigo) {
    return (
      <div className="rounded-2xl bg-bg-secondary p-6 text-center" data-testid="invita-error">
        <p className="text-text-secondary">No pudimos cargar tu código</p>
        <button type="button" onClick={cargar} className="btn-primary mt-4 px-6 py-2.5">Reintentar</button>
      </div>
    )
  }

  const n = data.seSumaron
  return (
    <div className="rounded-2xl bg-bg-secondary p-6 sm:p-8 text-center" data-testid="invita-card">
      <p className="text-xs font-semibold tracking-widest text-text-tertiary uppercase">Tu código</p>
      <button type="button" onClick={copiar} className="mt-3 block w-full" aria-label="Copiar mi link">
        <span className="block font-serif font-light text-[44px] leading-none tracking-tight text-text-primary" data-testid="invita-codigo">
          {codigo}
        </span>
        <span className="mt-3 block truncate rounded-2xl bg-brand-muted px-4 py-3 text-sm text-text-secondary" data-testid="invita-link">
          {url}
        </span>
      </button>

      <button type="button" onClick={compartir} className="btn-primary w-full mt-6 py-3.5">
        Compartir
      </button>
      <div className="mt-3 flex items-center justify-center gap-6 text-sm">
        <button type="button" onClick={copiar} className="text-brand font-medium">
          {copiado ? <span className="inline-flex items-center gap-1"><Check className="h-4 w-4" /> Copiado</span> : 'Copiar link'}
        </button>
        <a
          href={`https://wa.me/?text=${encodeURIComponent(mensaje)}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => track('referral_link_share', { codigo, rol, method: 'whatsapp' })}
          className="inline-flex items-center gap-1.5 text-brand font-medium"
        >
          <WhatsAppMark className="w-4 h-4" /> WhatsApp
        </a>
      </div>

      <div className="mt-8" data-testid="invita-contador">
        {n === 0 ? (
          <p className="text-text-tertiary">Todavía nadie se sumó</p>
        ) : (
          <p className="text-text-secondary">
            <span className="font-serif text-[28px] text-text-primary mr-2">{n}</span>
            {n === 1 ? 'se sumó' : 'se sumaron'}
          </p>
        )}
      </div>

      {rol === 'professional' && stats && (
        <p className="mt-3 text-sm text-text-tertiary" data-testid="invita-stats-pro">
          {stats.visitas} {stats.visitas === 1 ? 'visita' : 'visitas'}
          {' · '}{stats.registros} {stats.registros === 1 ? 'se registró' : 'se registraron'}
          {' · '}{stats.conConsulta} ya {stats.conConsulta === 1 ? 'sacó turno' : 'sacaron turno'}
        </p>
      )}
      <p className="sr-only">Código de referido{nombre ? ` de ${nombre}` : ''}</p>
    </div>
  )
}
