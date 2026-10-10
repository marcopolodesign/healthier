import { ESTADOS_DERIVACION, derivacionVigente } from '../services/derivacionesService'

/** Badge del estado de una derivación. Una pendiente pasada de fecha se muestra vencida
 *  aunque el cron diario todavía no la haya marcado. */
export default function DerivacionEstado({ derivacion }) {
  const estado = derivacion.estado === 'pendiente' && !derivacionVigente(derivacion) ? 'vencida' : derivacion.estado
  const cfg = ESTADOS_DERIVACION[estado] ?? ESTADOS_DERIVACION.pendiente
  return (
    <span className={`inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-full border ${cfg.clase}`}>
      {cfg.label}
    </span>
  )
}

/** "Sí" / "No" / "Sin responder" del consentimiento de historia clínica. */
export function consentimientoLabel(d) {
  if (d.consentimientoHc === true) return 'Sí'
  if (d.consentimientoHc === false) return 'No'
  return 'Sin responder'
}
