import { Flask } from '@phosphor-icons/react'
import { useIncluirPrueba } from '../../hooks/useIncluirPrueba'

/**
 * "Incluir cuentas de prueba" — el mismo control en todo el super admin.
 * Apagado: métricas, totales y listados sin cuentas de prueba (migración 229).
 */
export default function IncluirPruebaToggle({ className = '' }) {
  const [incluir, setIncluir] = useIncluirPrueba()
  return (
    <label className={`inline-flex items-center gap-2 text-xs text-text-secondary cursor-pointer select-none ${className}`}>
      <input
        type="checkbox"
        checked={incluir}
        onChange={(e) => setIncluir(e.target.checked)}
        className="h-4 w-4 accent-brand"
      />
      <Flask size={14} />
      Incluir cuentas de prueba
    </label>
  )
}
