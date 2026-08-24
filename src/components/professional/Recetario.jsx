import { useState } from 'react'
import { Pill, TestTube } from '@phosphor-icons/react'
import PrescriptionCreator from './PrescriptionCreator'
import EstudiosCreator from './EstudiosCreator'

const OPCIONES = [
  { id: 'medicamentos', label: 'Recetar medicamentos', icon: Pill },
  { id: 'estudios',     label: 'Recetar estudios',     icon: TestTube },
]

/**
 * "Recetario": lo que antes era directamente `PrescriptionCreator` (sólo
 * medicamentos) ahora es un selector de 2 tarjetas — el profesional también
 * necesita pedir estudios (análisis, imágenes), y eran dos flujos con muy
 * poco en común como para meterlos en un solo formulario.
 *
 * Arranca en "medicamentos": es el comportamiento que había antes de este
 * cambio, y sigue siendo lo que más se usa. (Mateo, 2026-08-24)
 *
 * Recibe todas las props que necesitan ambos hijos y las reparte — la
 * Cobertura de arriba (en VideoCall/ConsultationDetail) queda afuera de este
 * componente, sin cambios, porque sólo aplica a la receta de medicamentos.
 */
export default function Recetario({
  patientId, encounterId, ensureEncounter, professionalId, profProfile, bloqueada,
  cobertura, profile, paciente, consultationId, onIssued, onDatosActualizados,
  onEntryAdded,
}) {
  const [modo, setModo] = useState('medicamentos')

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5">
        {OPCIONES.map(o => {
          const selected = modo === o.id
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => setModo(o.id)}
              aria-pressed={selected}
              className={`flex items-center justify-center gap-1.5 py-4 px-2 rounded-2xl border font-semibold text-xs transition-colors ${
                selected
                  ? 'bg-brand-muted/20 border-brand text-brand'
                  : 'bg-white border-border-default text-text-primary hover:border-brand hover:text-brand hover:bg-brand-muted/20'
              }`}
            >
              <o.icon className="h-4 w-4 shrink-0" weight={selected ? 'fill' : 'regular'} />
              {o.label}
            </button>
          )
        })}
      </div>

      {modo === 'medicamentos' ? (
        <PrescriptionCreator
          patientId={patientId}
          encounterId={encounterId}
          ensureEncounter={ensureEncounter}
          professionalId={professionalId}
          cobertura={cobertura}
          profile={profile}
          profProfile={profProfile}
          paciente={paciente}
          consultationId={consultationId}
          onIssued={onIssued}
          onDatosActualizados={onDatosActualizados}
          bloqueada={bloqueada}
        />
      ) : (
        <EstudiosCreator
          patientId={patientId}
          encounterId={encounterId}
          ensureEncounter={ensureEncounter}
          professionalId={professionalId}
          profProfile={profProfile}
          bloqueada={bloqueada}
          onEntryAdded={onEntryAdded}
        />
      )}
    </div>
  )
}
