import { Gift } from '@phosphor-icons/react'
import { formatTasa, formatHasta } from '../../services/comisionService'

/**
 * Frase corta de la comisión propia del profesional (migración 184), o null si
 * paga la general. "Sin comisión de Healthier hasta 31/12" / "Comisión de
 * Healthier: 5% hasta 31/12".
 */
export function textoComisionPropia(comision) {
  if (!comision || comision.origen !== 'profesional') return null
  const hasta = formatHasta(comision.validUntil)
  const base = Number(comision.rate) === 0
    ? 'Sin comisión de Healthier'
    : `Comisión de Healthier: ${formatTasa(comision.rate)}`
  return hasta ? `${base} hasta el ${hasta}` : base
}

/** Chapa para el inicio del profesional. No dibuja nada si paga la general. */
export default function AvisoComision({ comision }) {
  const texto = textoComisionPropia(comision)
  if (!texto) return null
  return (
    <div data-testid="aviso-comision" className="card flex items-center gap-4 border-emerald-200 bg-emerald-50">
      <div className="w-12 h-12 rounded-2xl bg-white border border-emerald-200 flex items-center justify-center shrink-0">
        <Gift className="h-6 w-6 text-emerald-600" />
      </div>
      <div className="min-w-0">
        <p className="font-semibold text-emerald-800">{texto}</p>
        <p className="text-sm text-emerald-700 mt-0.5">
          {Number(comision.rate) === 0
            ? 'Te queda el 100% de cada consulta. Mercado Pago cobra su comisión como siempre.'
            : 'Se aplica a cada consulta que cobres en ese período.'}
        </p>
      </div>
    </div>
  )
}
