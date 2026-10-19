/**
 * "Paso 2 de 4" con la barra partida en tramos: el pago es el último. La usan
 * las preguntas de Teleclínica y la pantalla de pago, así el paciente ve que
 * las dos son el mismo recorrido (opción B de Felipe, 2026-10-19).
 */
export default function BarraDePasos({ paso, total, className = '' }) {
  return (
    <div className={className}>
      <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-2" data-testid="paso-de">
        Paso {paso} de {total}
      </p>
      <div className="flex gap-1" aria-hidden="true">
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={`h-1 flex-1 rounded-full ${i < paso ? 'bg-brand' : 'bg-gray-200'}`} />
        ))}
      </div>
    </div>
  )
}
