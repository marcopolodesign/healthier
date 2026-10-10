import { ShareFat } from '@phosphor-icons/react'

/**
 * Chip "Derivado por Dr. X" para las tarjetas de turno. `derivacion` es el embed
 * de `consultations` (ver `DERIVACION_EMBED`); sin derivación no renderiza nada.
 */
export default function DerivadoChip({ derivacion }) {
  if (!derivacion) return null
  const quien = derivacion.derivado?.fullName
  return (
    <span
      title={derivacion.motivo}
      className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-brand-tertiary/10 text-brand-tertiary max-w-full"
    >
      <ShareFat className="h-3 w-3 shrink-0" />
      <span className="truncate">{quien ? `Derivado por ${quien}` : 'Derivado'}</span>
    </span>
  )
}
