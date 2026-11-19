import { Pulse } from '@phosphor-icons/react'
import { sintomasDeEmergencia } from '../../services/emergencyService'

/**
 * Los síntomas que el paciente cargó al pedir la emergencia, para la
 * tripulación (reunión del 18/11). Si no hay, lo dice: nunca inventa una lista.
 */
export default function SintomasReportados({ emergencia, className = '' }) {
  const sintomas = sintomasDeEmergencia(emergencia)
  return (
    <div className={`rounded-3xl border border-border-default bg-white p-5 flex flex-col gap-2 ${className}`} data-testid="sintomas-reportados">
      <div className="flex items-center gap-2">
        <Pulse className="w-5 h-5 text-text-secondary" />
        <span className="font-black text-sm uppercase tracking-wide text-text-primary">
          {sintomas.length ? 'Síntomas que cargó el paciente' : 'Sin síntomas registrados'}
        </span>
      </div>
      {sintomas.length ? (
        <ul className="flex flex-col gap-1.5">
          {sintomas.map(s => (
            <li key={s} className="text-sm font-medium text-text-primary">• {s}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-text-secondary">No quedó registro de síntomas. Llamá al paciente para relevarlos.</p>
      )}
    </div>
  )
}
