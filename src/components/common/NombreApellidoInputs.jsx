import { User } from '@phosphor-icons/react'

/**
 * Nombre y Apellido, los dos obligatorios (migración 183). Lo usan el alta de
 * paciente y de profesional, completar registro y el paso de confirmar
 * apellido, para que el formulario sea el mismo en todos lados.
 */
export default function NombreApellidoInputs({ nombre, apellido, onChange, autoFocus = false }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div>
        <label className="form-label" htmlFor="campo-nombre">Nombre</label>
        <div className="relative">
          <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary" />
          <input
            id="campo-nombre"
            name="given-name"
            autoComplete="given-name"
            type="text"
            required
            autoFocus={autoFocus}
            value={nombre}
            onChange={e => onChange({ nombre: e.target.value, apellido })}
            placeholder="Juan"
            className="form-input pl-9"
          />
        </div>
      </div>
      <div>
        <label className="form-label" htmlFor="campo-apellido">Apellido</label>
        <input
          id="campo-apellido"
          name="family-name"
          autoComplete="family-name"
          type="text"
          required
          value={apellido}
          onChange={e => onChange({ nombre, apellido: e.target.value })}
          placeholder="Pérez"
          className="form-input"
        />
      </div>
    </div>
  )
}
