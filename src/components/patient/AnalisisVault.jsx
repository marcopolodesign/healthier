import { useNavigate } from 'react-router-dom'
import { Drop, CaretRight } from '@phosphor-icons/react'
import EstudiosVault from './EstudiosVault'

/**
 * "Análisis" dentro de la Bóveda: estudios por imágenes (radiografías,
 * ecografías, fotos clínicas) con especialidad y nombre, en
 * `medical_documents` (`category='analisis'`, migración 174).
 *
 * Hasta el 2026-09-24 esto escribía en `diagnostic_reports`, la tabla del
 * BioVisor, y la app escribía en `medical_documents`: el mismo botón guardaba
 * en dos lugares según desde dónde lo apretaras. Mateo eligió separar: acá van
 * los estudios por especialidad (lo que pidió Nacho), y los análisis de sangre
 * siguen yendo al BioVisor, que es el que los lee y los grafica. Web y app
 * quedan iguales. El profesional ve los dos: estos por la policy
 * `docs_professional_select` y los de sangre por la del BioVisor.
 */
export default function AnalisisVault({ profile }) {
  const navigate = useNavigate()

  return (
    <div className="p-4 space-y-4">
      <div>
        <p className="font-semibold text-text-primary text-[15px]">Subir un estudio</p>
        <p className="text-xs text-text-secondary mt-1">
          Radiografías, ecografías, fotos. Elegí la especialidad y tu profesional lo encuentra más rápido.
        </p>
      </div>

      <button
        onClick={() => navigate('/paciente/biovisor')}
        className="w-full card p-3 flex items-center gap-3 text-left hover:border-brand/60 transition-colors"
      >
        <div className="w-9 h-9 rounded-lg bg-red-50 flex items-center justify-center shrink-0">
          <Drop size={18} weight="fill" className="text-red-500" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-text-primary">¿Es un análisis de sangre?</p>
          <p className="text-xs text-text-secondary">Subilo en el BioVisor y seguí tus valores en el tiempo.</p>
        </div>
        <CaretRight size={16} className="text-text-tertiary" />
      </button>

      <EstudiosVault
        patientId={profile?.id}
        category="analisis"
        conEspecialidad
        vacio="Todavía no subiste ningún estudio"
      />
    </div>
  )
}
