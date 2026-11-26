import { useState } from 'react'
import { Prescription } from '@phosphor-icons/react'
import { professionalService } from '../../services/professionalService'
import { toast } from '../Toast'

/**
 * "Médico de Healthier" (migración 254): atiende los pedidos de receta de la
 * farmacia — le llegan los avisos y ve "Pedidos de receta" en su panel. Sólo
 * el super admin lo cambia (lo garantiza un trigger de la base). Sólo sirve
 * con el profesional verificado.
 */
export default function MedicoHealthierToggle({ professionalProfileId, valor, verificado, onChanged }) {
  const [activo, setActivo] = useState(Boolean(valor))
  const [guardando, setGuardando] = useState(false)

  const cambiar = async () => {
    setGuardando(true)
    try {
      await professionalService.setMedicoHealthier(professionalProfileId, !activo)
      setActivo(!activo)
      toast.success(!activo ? 'Ahora atiende los pedidos de receta' : 'Ya no atiende pedidos de receta')
      onChanged?.()
    } catch (err) {
      toast.error(err?.message || 'No se pudo cambiar')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 px-4 py-3 flex items-center gap-3">
      <Prescription className="h-5 w-5 text-brand-tertiary-hover shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900">Médico de Healthier</p>
        <p className="text-xs text-gray-500">
          Hace las recetas de los pedidos de farmacia{verificado ? '' : ' (tiene que estar verificado para recibirlos)'}.
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={activo}
        aria-label="Médico de Healthier"
        disabled={guardando}
        onClick={cambiar}
        className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${activo ? 'bg-brand' : 'bg-gray-300'} disabled:opacity-60`}
      >
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${activo ? 'translate-x-5' : ''}`} />
      </button>
    </div>
  )
}
