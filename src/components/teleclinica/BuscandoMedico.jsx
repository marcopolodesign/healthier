import { Clock, Lightning } from '@phosphor-icons/react'

/** "3:42" — sin el cero adelante (Felipe). */
function formatCountdown(total) {
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/** Lo que lee un lector de pantalla: una vez por minuto, y segundo a segundo al final. */
function countdownParaLeer(total) {
  if (total > 30) {
    const min = Math.ceil(total / 60)
    return `Quedan unos ${min} ${min === 1 ? 'minuto' : 'minutos'}`
  }
  return `Quedan ${total} segundos`
}

/**
 * "Buscando un médico disponible" de Teleclínica: sonar en el medio sobre el
 * fondo de marca de la app (Mateo + Felipe, 2026-10-13). Paridad con
 * `mobile/app/ondemand/[vertical].tsx`. El fondo y el sonar viven en
 * `index.css` (`fondo-marca`, `sonar`).
 */
export default function BuscandoMedico({ vertical, segundos, ocupado, onCancelar }) {
  const IconComp = vertical?.icon || Lightning
  return (
    <div className="absolute inset-0 z-[100] flex flex-col animate-fade-in">
      <div className="fondo-marca" aria-hidden="true">
        <span className="mancha-tl" />
        <span className="mancha-br" />
      </div>

      <div className="relative flex items-center justify-center px-4 pt-6 pb-2 sm:pt-8">
        <h1 className="text-[16px] font-medium text-gray-900">Tele-{vertical?.nombre}</h1>
      </div>

      <div className="relative flex-1 flex items-center justify-center min-h-[264px]">
        <div className="sonar" aria-hidden="true">
          <i /><i /><i />
          <div className="relative w-[84px] h-[84px] rounded-full bg-white shadow-[0_4px_16px_rgba(45,42,38,0.10)] flex items-center justify-center">
            <IconComp className="w-8 h-8 text-brand-hover" />
          </div>
        </div>
      </div>

      <div className="relative w-full max-w-[360px] mx-auto px-5 flex flex-col items-center text-center" aria-live="polite">
        <h2 className="text-[28px] leading-[34px] font-medium text-gray-900" data-testid="ondemand-buscando">
          Buscando<br />un médico disponible
        </h2>
        <p className="mt-2 text-[15px] leading-5 text-gray-500">
          Avisamos a los médicos de {vertical?.nombre ?? 'esta especialidad'} que están conectados. El primero que acepte te atiende.
        </p>
        <div className="mt-5 h-9 px-3.5 inline-flex items-center gap-1.5 rounded-full bg-white/85" role="timer" aria-label={countdownParaLeer(segundos)}>
          <Clock className="w-4 h-4 text-gray-500" />
          <span className="text-[17px] leading-[22px] font-medium tabular-nums text-gray-900">{formatCountdown(segundos)}</span>
        </div>
        <p className="mt-3 text-[15px] leading-5 text-gray-500">No se te cobra nada hasta que alguien acepte.</p>
      </div>

      <div className="relative w-full max-w-[360px] mx-auto px-5 pt-6 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <button
          onClick={onCancelar}
          disabled={ocupado}
          className="w-full h-14 rounded-full bg-white border border-gray-200 text-gray-900 font-semibold text-[17px] disabled:opacity-50"
        >
          {ocupado ? 'Cancelando…' : 'Cancelar'}
        </button>
      </div>
    </div>
  )
}
