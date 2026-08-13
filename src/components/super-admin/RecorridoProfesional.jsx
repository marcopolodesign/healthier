import { useEffect, useState } from 'react'
import { CircleNotch, ArrowClockwise } from '@phosphor-icons/react'
import { professionalOnboardingService } from '../../services/professionalOnboardingService'
import {
  construirRecorrido, formatearDuracion, etiquetaEvento,
  EVENT_META, PAUSA_SIGNIFICATIVA_MS,
} from '../../lib/recorridoProfesional'

/**
 * El recorrido de UN profesional, en vertical.
 *
 * Lo que importa acá no son los eventos sino los huecos ENTRE eventos: un
 * listado de asientos no dice nada, "estuvo 3 días frenado en Documentos y
 * volvió el martes" sí. Por eso cada pausa larga se dibuja como un tramo con su
 * duración, y el evento que la corta queda marcado como "retomó".
 *
 * Recibe `eventos` cuando quien lo usa ya los trajo en lote (vista de
 * recorrido); si no, los busca solo (sidecart de prospectos).
 */

const fechaHora = ts => new Date(ts).toLocaleString('es-AR', {
  day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  timeZone: 'America/Argentina/Buenos_Aires',
})

export default function RecorridoProfesional({ userId, pro = {}, eventos: eventosProp = null }) {
  const [eventos, setEventos] = useState(eventosProp)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (eventosProp) { setEventos(eventosProp); return }
    let cancelado = false
    professionalOnboardingService.listByUser(userId)
      .then(e => { if (!cancelado) setEventos(e) })
      .catch(() => { if (!cancelado) setError(true) })
    return () => { cancelado = true }
  }, [userId, eventosProp])

  if (error) return <p className="text-xs text-danger py-3">No pudimos cargar el recorrido.</p>
  if (eventos === null) {
    return <div className="flex justify-center py-4"><CircleNotch className="h-4 w-4 animate-spin text-brand" /></div>
  }
  if (!eventos.length) {
    return (
      <p className="text-xs text-gray-400 py-3">
        Sin recorrido registrado. La bitácora empezó el 2026-08-13 — de antes sólo
        se conservan los hitos que ya tenían fecha propia (alta, envío, verificación).
      </p>
    )
  }

  const r = construirRecorrido(eventos, pro)

  return (
    <div className="py-1">
      {r.eventos.map((e, i) => {
        const meta = EVENT_META[e.event]
        const pausaLarga = e.pausaMs != null && e.pausaMs >= PAUSA_SIGNIFICATIVA_MS
        return (
          <div key={e.id ?? `${e.event}-${e.ts}`}>
            {/* El hueco anterior — lo que de verdad se quiere leer. */}
            {i > 0 && (
              <div className="flex items-stretch gap-3 min-h-[18px]">
                <div className="w-2 flex justify-center">
                  <div className={`w-px ${pausaLarga ? 'border-l border-dashed border-gray-300' : 'bg-gray-200'}`} />
                </div>
                {pausaLarga && (
                  <p className="text-[11px] text-gray-400 py-0.5">{formatearDuracion(e.pausaMs)} sin actividad</p>
                )}
              </div>
            )}

            <div className="flex items-start gap-3">
              <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${meta?.dot ?? 'bg-gray-300'}`} />
              <div className="flex-1 min-w-0 flex items-baseline justify-between gap-3">
                <p className={`text-xs ${meta?.texto ?? 'text-gray-700'}`}>
                  {etiquetaEvento(e)}
                  {e.retomo && (
                    <span className="ml-1.5 inline-flex items-center gap-0.5 text-[10px] font-medium text-blue-600">
                      <ArrowClockwise className="h-3 w-3" weight="bold" /> retomó
                    </span>
                  )}
                  {e.event === 'rejected' && e.detail?.reason && (
                    <span className="block text-[11px] text-gray-500 mt-0.5">{e.detail.reason}</span>
                  )}
                </p>
                <span className="text-[11px] text-gray-400 tabular-nums shrink-0">{fechaHora(e.ts)}</span>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
