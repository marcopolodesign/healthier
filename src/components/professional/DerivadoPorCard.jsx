import { Link } from 'react-router-dom'
import { ShareFat, ArrowRight } from '@phosphor-icons/react'

/**
 * "Derivado por Dr. X — motivo" para el profesional que recibe al paciente:
 * arriba de la consulta reservada y en la ficha. Dice también si el paciente
 * compartió la historia clínica, para que se sepa qué se va a poder ver.
 */
export default function DerivadoPorCard({ derivacion, conLink = true }) {
  if (!derivacion) return null
  const quien = derivacion.derivado?.fullName ?? 'otro profesional'

  let hc = 'El paciente todavía no respondió si comparte su historia clínica: por ahora sólo ves la nota de derivación.'
  if (derivacion.consentimientoHc === true) hc = 'El paciente compartió su historia clínica.'
  if (derivacion.consentimientoHc === false) hc = 'El paciente no compartió su historia clínica: sólo ves la nota de derivación.'

  return (
    <div className="card border border-brand-tertiary/30 space-y-2">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-brand-tertiary/10">
          <ShareFat className="h-4 w-4 text-brand-tertiary" />
        </div>
        <h2 className="font-semibold text-text-primary">Derivado por {quien}</h2>
      </div>
      <p className="text-sm text-text-primary whitespace-pre-line">“{derivacion.motivo}”</p>
      <p className="text-xs text-text-secondary">{hc}</p>
      {conLink && (
        <Link
          to={`/profesional/derivaciones/${derivacion.id}`}
          className="inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline"
        >
          Ver derivación <ArrowRight className="h-3 w-3" />
        </Link>
      )}
    </div>
  )
}
