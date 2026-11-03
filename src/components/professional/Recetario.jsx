import { useState } from 'react'
import { Certificate, Pill, TestTube } from '@phosphor-icons/react'
import PrescriptionCreator from './PrescriptionCreator'
import EstudiosCreator from './EstudiosCreator'
import CertificadoCreator from './CertificadoCreator'
import { esSimulado } from '../../lib/simulacion'
import { useEspecialidades } from '../../hooks/useEspecialidades'

// Tres tarjetas con el ícono arriba para que entren en el panel angosto de la
// videollamada (Felipe, 2026-11-02). "Certificado": constancia, reposo, escolar.
const OPCIONES = [
  { id: 'medicamentos', label: 'Medicamentos', icon: Pill },
  { id: 'estudios',     label: 'Estudios',     icon: TestTube },
  { id: 'certificado',  label: 'Certificado',  icon: Certificate },
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
  onEntryAdded, consultaFecha, consulta,
}) {
  const [modo, setModo] = useState('medicamentos')
  // Certificados: sólo las especialidades que recetan, mismo criterio que la
  // receta (Mateo, 2026-11-02). El corte real lo hace `rcta-certificado`.
  const { puedeRecetar } = useEspecialidades()
  const opciones = OPCIONES.filter(o => o.id !== 'certificado' || puedeRecetar(profProfile?.specialty))

  return (
    <div className="space-y-4">
      <div className={`grid gap-2.5 ${opciones.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
        {opciones.map(o => {
          const selected = modo === o.id
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => setModo(o.id)}
              aria-pressed={selected}
              className={`flex flex-col items-center justify-center gap-1 py-3 px-2 rounded-2xl border font-semibold text-xs transition-colors ${
                selected
                  ? 'bg-brand-muted/20 border-brand text-brand'
                  : 'bg-white border-border-default text-text-primary hover:border-brand hover:text-brand hover:bg-brand-muted/20'
              }`}
            >
              <o.icon className="h-5 w-5 shrink-0" weight={selected ? 'fill' : 'regular'} />
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
      ) : modo === 'certificado' ? (
        <CertificadoCreator
          consultationId={consultationId}
          encounterId={encounterId}
          consultaFecha={consultaFecha}
          consulta={consulta}
          professionalId={professionalId}
          profile={profile}
          profProfile={profProfile}
          paciente={paciente}
          patientId={patientId}
          onDatosActualizados={onDatosActualizados}
          enPractica={esSimulado(encounterId) || esSimulado(consultationId)}
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
