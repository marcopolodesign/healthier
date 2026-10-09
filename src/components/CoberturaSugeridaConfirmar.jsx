import { useState } from 'react'
import { Sparkle, CircleNotch } from '@phosphor-icons/react'

/**
 * Sugerencia de obra social para un perfil YA guardado (perfil propio o un
 * familiar) que no tiene ninguna cargada: no se escribe sola, la persona toca
 * "Usar". Si ya tenía algo cargado, la pantalla ni la muestra
 * (lib/coberturaSugerida.js → tieneCobertura).
 */
export default function CoberturaSugeridaConfirmar({ sugerencia, quien = 'tu', onUsar, onDescartar }) {
  const [guardando, setGuardando] = useState(false)
  if (!sugerencia?.financiadorId) return null
  const usar = async () => {
    setGuardando(true)
    try { await onUsar(sugerencia) } finally { setGuardando(false) }
  }
  return (
    <div className="mt-3 text-[13px] text-text-secondary bg-brand-muted/40 border border-brand/30 rounded-xl px-3 py-2.5 flex flex-wrap items-center gap-2">
      <Sparkle className="h-4 w-4 text-brand shrink-0" weight="fill" />
      <span className="flex-1 min-w-[12rem]">
        En el listado de obras sociales, {quien} obra social figura como{' '}
        <strong className="font-semibold text-text-primary">{sugerencia.financiadorNombre}</strong>.
      </span>
      <button type="button" onClick={usar} disabled={guardando}
        className="px-3 py-1.5 rounded-full bg-brand text-white text-[13px] font-semibold disabled:opacity-60 flex items-center gap-1">
        {guardando && <CircleNotch className="h-3.5 w-3.5 animate-spin" />}Usar
      </button>
      <button type="button" onClick={onDescartar} className="px-2 py-1.5 text-[13px] text-text-tertiary hover:text-text-primary">
        No es
      </button>
    </div>
  )
}
