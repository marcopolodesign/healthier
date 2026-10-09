import { CircleNotch, Sparkle, Info } from '@phosphor-icons/react'

/**
 * El aviso que acompaña al selector de obra social cuando se consultó el
 * listado de obras sociales por DNI (ver lib/coberturaSugerida.js).
 *
 * Copy: nunca se nombra el proveedor — es "el listado de obras sociales".
 *
 * @param {'buscando'|'precargada'|'sin_match'|null} estado
 * @param {string} [nombre] nombre que figura en el listado (para sin_match)
 */
export default function CoberturaSugeridaAviso({ estado, nombre }) {
  if (estado === 'buscando') {
    return (
      <p className="text-xs text-text-tertiary flex items-center gap-1.5 mb-3">
        <CircleNotch className="h-3.5 w-3.5 animate-spin text-brand" />
        Buscando tu obra social en el listado de obras sociales…
      </p>
    )
  }
  if (estado === 'precargada') {
    return (
      <p className="text-xs text-text-secondary bg-brand-muted/40 border border-brand/30 rounded-xl px-3 py-2 flex items-start gap-1.5 mb-3">
        <Sparkle className="h-3.5 w-3.5 text-brand mt-0.5 shrink-0" weight="fill" />
        La completamos con tu DNI desde el listado de obras sociales. Revisala y cambiala si no es la tuya.
      </p>
    )
  }
  if (estado === 'sin_match' && nombre) {
    return (
      <p className="text-xs text-text-secondary bg-bg-primary border border-border-default rounded-xl px-3 py-2 flex items-start gap-1.5 mb-3">
        <Info className="h-3.5 w-3.5 text-text-tertiary mt-0.5 shrink-0" />
        <span>En el listado de obras sociales figurás con <strong className="font-semibold">{nombre}</strong>. Buscala abajo y elegila.</span>
      </p>
    )
  }
  return null
}
