import { MapPin, Check, Plus, House, Buildings, MapTrifold } from '@phosphor-icons/react'
import PatientSheet from './PatientSheet'

const ICONO_POR_ETIQUETA = { Casa: House, Trabajo: Buildings, Otra: MapTrifold }

/**
 * Lista de "Mis direcciones" para elegir una — usada por el checkout de
 * farmacia (elegir dónde entregar) y por Perfil (elegir el domicilio
 * principal). Patrón de filas con ícono + texto + check a la derecha,
 * inspirado en el selector de ubicaciones de BIGG
 * (`biggapp/src/Screens/Home/V2/components/LocationSheet.tsx`), llevado a los
 * tokens de Healthier.
 */
export default function AddressPickerSheet({ open, onClose, addresses, selectedId, onSelect, onAdd }) {
  return (
    <PatientSheet open={open} onClose={onClose}>
      <div className="flex-shrink-0 px-5 pt-2 pb-3">
        <h2 className="text-[20px] font-semibold text-text-primary">Elegí una dirección</h2>
      </div>

      <div className="flex-1 overflow-y-auto px-5">
        {addresses.length === 0 && (
          <p className="text-[14px] text-text-tertiary py-6 text-center">Todavía no cargaste ninguna dirección.</p>
        )}
        <div className="divide-y divide-border-subtle">
          {addresses.map(a => {
            const Icon = ICONO_POR_ETIQUETA[a.etiqueta] ?? MapPin
            const selected = a.id === selectedId
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => onSelect(a)}
                className="w-full flex items-center gap-3 py-3.5 text-left"
              >
                <div className="w-10 h-10 rounded-full bg-brand-muted flex items-center justify-center shrink-0">
                  <Icon className="w-5 h-5 text-brand" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[15px] font-semibold text-text-primary">{a.etiqueta}</p>
                  <p className="text-[13px] text-text-secondary truncate">
                    {a.direccion}{a.pisoDepto ? `, ${a.pisoDepto}` : ''}
                  </p>
                </div>
                {selected && <Check className="w-5 h-5 text-brand shrink-0" weight="bold" />}
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex-shrink-0 px-5 pt-3 pb-6 border-t border-border-subtle">
        <button
          type="button"
          onClick={onAdd}
          className="w-full flex items-center justify-center gap-2 py-3.5 rounded-full border border-dashed border-border-default text-[14px] font-semibold text-brand hover:bg-brand-muted/40 transition-colors"
        >
          <Plus className="w-4 h-4" /> Agregar dirección
        </button>
      </div>
    </PatientSheet>
  )
}
