import { UserCircle } from '@phosphor-icons/react'

function elapsedLabel(since) {
  if (!since) return null
  const mins = Math.floor((Date.now() - since.getTime()) / 60000)
  if (mins < 1) return 'recién llegó'
  if (mins === 1) return 'hace 1 min'
  if (mins < 60) return `hace ${mins} min`
  const hours = Math.floor(mins / 60)
  return hours === 1 ? 'hace 1 h' : `hace ${hours} h`
}

/**
 * "Someone is in the waiting room right now" marker for the professional.
 *
 * Deliberately louder than a StatusBadge: this is the one state in the list
 * that costs the professional money and goodwill to miss, so it pulses and
 * carries the elapsed time rather than sitting quietly among the other chips.
 */
export default function PatientWaitingBadge({ since, className = '' }) {
  return (
    <span
      className={`flex items-center gap-1.5 shrink-0 px-2.5 py-1 rounded-full bg-brand text-white text-xs font-semibold ${className}`}
      title="El paciente está en la sala de espera"
    >
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full rounded-full bg-white opacity-70 animate-ping" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
      </span>
      <UserCircle className="h-3.5 w-3.5" weight="fill" />
      En sala · {elapsedLabel(since)}
    </span>
  )
}
