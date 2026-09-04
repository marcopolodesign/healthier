import { useState, useEffect, useCallback } from 'react'
import { NavigationArrow, CheckCircle, WifiSlash } from '@phosphor-icons/react'
import { arrivalsService, esReciente } from '../../services/arrivalsService'
import { formatMeters, formatMinutes } from '../../lib/directions'

/**
 * Las llegadas en vivo de los pacientes de ESTE profesional, indexadas por
 * consulta. Una sola suscripción de Realtime para toda la pantalla — cada
 * tarjeta de la agenda sólo lee del mapa.
 *
 * Devuelve `{}` mientras carga: quien lo usa muestra la tarjeta como siempre y
 * el dato aparece cuando llega. Que falle no rompe la agenda.
 */
export function useLlegadas(professionalId) {
  const [porConsulta, setPorConsulta] = useState({})

  const indexar = useCallback(lista => {
    setPorConsulta(Object.fromEntries(lista.map(a => [a.consultationId, a])))
  }, [])

  useEffect(() => {
    if (!professionalId) return
    let vivo = true
    arrivalsService.getByProfessional(professionalId)
      .then(l => { if (vivo) indexar(l) })
      .catch(() => {})

    const desuscribir = arrivalsService.suscribirProfesional(professionalId, ({ evento, arrival, anterior }) => {
      setPorConsulta(prev => {
        const siguiente = { ...prev }
        if (evento === 'DELETE') delete siguiente[anterior?.consultationId]
        else if (arrival) siguiente[arrival.consultationId] = arrival
        return siguiente
      })
    })

    return () => { vivo = false; desuscribir() }
  }, [professionalId, indexar])

  /*
   * "Hace 4 minutos" deja de ser cierto sin que llegue ningún evento nuevo, así
   * que la frescura se re-evalúa sola cada 30 s. Sin esto un ETA viejo se queda
   * en pantalla como si fuera de ahora.
   */
  const [, forzar] = useState(0)
  useEffect(() => {
    const id = setInterval(() => forzar(n => n + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  return porConsulta
}

/**
 * "Llega en 8 min" al lado del paciente en la agenda.
 *
 * Tres estados y ninguno inventado: llegó, viene con dato fresco, o el dato
 * envejeció (se cerró la app, se quedó sin señal) y entonces se dice eso en vez
 * de mostrar un ETA que ya no vale.
 */
export default function LlegadaBadge({ arrival }) {
  if (!arrival) return null

  if (arrival.status === 'llegado') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[11px] font-semibold shrink-0">
        <CheckCircle className="h-3.5 w-3.5" weight="fill" />
        Ya llegó
      </span>
    )
  }

  if (!esReciente(arrival)) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-bg-surface text-text-tertiary text-[11px] font-semibold shrink-0">
        <WifiSlash className="h-3.5 w-3.5" />
        En camino · sin señal
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-brand-muted text-brand text-[11px] font-semibold shrink-0">
      <NavigationArrow className="h-3.5 w-3.5 animate-pulse" weight="fill" />
      Llega en {formatMinutes(arrival.etaMinutes)}
      {arrival.distanceMeters != null && (
        <span className="font-normal opacity-70">· {formatMeters(arrival.distanceMeters)}</span>
      )}
    </span>
  )
}
