import { IdentificationCard } from '@phosphor-icons/react'

/**
 * DNI del profesional en el alta (2026-10-16): lo usan el registro por mail y
 * completar registro (Google) cuando el rol es profesional. Se pide desde el
 * alta para que `profiles.es_extranjero` (migración 201) se sepa desde el
 * primer momento; el onboarding lo trae precargado y no lo vuelve a pedir.
 * Revisado por Felipe: label sin asterisco, ayuda con el porqué.
 */
export const dniValido = dni => /^\d{7,8}$/.test(dni ?? '')
export const MENSAJE_DNI_INVALIDO = 'Revisá tu DNI: son 7 u 8 números.'

export default function DniInput({ value, onChange }) {
  return (
    <div>
      <label className="form-label" htmlFor="campo-dni">DNI</label>
      <div className="relative">
        <IdentificationCard className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary" />
        <input
          id="campo-dni"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={8}
          required
          value={value}
          onChange={e => onChange(e.target.value.replace(/\D/g, '').slice(0, 8))}
          placeholder="Ej: 28999888"
          className="form-input pl-9"
        />
      </div>
      <p className="text-xs text-text-tertiary mt-1">Necesario para emitir recetas electrónicas.</p>
    </div>
  )
}
