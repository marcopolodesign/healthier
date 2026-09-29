import { useEffect, useState } from 'react'
import { Sparkle, X } from '@phosphor-icons/react'
import CopilotoClinico, { contarSugerencias } from './CopilotoClinico'

/**
 * El copiloto clínico en el teléfono (Mateo, 2026-09-28, probando la atención
 * de emergencia en el iPhone): "tiene que estar fijado en el bottom:0 y
 * activarse cuando tenga sugerencias (con un ícono de notificación), porque si
 * no en mobile queda perdido arriba y no se entiende".
 *
 * Una barra fija abajo (respeta el safe area) que está apagada mientras no hay
 * guía para el motivo, y se enciende —color de marca + la cantidad de
 * sugerencias sin tomar— cuando la hay. Si la guía es nueva (se eligió o
 * cambió el motivo) y todavía no se abrió, lleva además un punto que late.
 * Tocarla abre la hoja con el mismo `CopilotoClinico` de escritorio.
 *
 * Sólo existe debajo de `lg`; en escritorio el copiloto sigue en su columna.
 * Quien la usa tiene que dejar lugar abajo (`copiloto-barra-espacio`) para que
 * no tape "Guardar consulta en la HC".
 */
export default function CopilotoMovil({ motivo, motivoLibre, draft, onToggleBandera, onTogglePregunta, onToggleDiferencial }) {
  const [abierto, setAbierto] = useState(false)
  // El motivo cuya guía ya se miró. Una guía distinta vuelve a marcar "nuevo".
  const [motivoVisto, setMotivoVisto] = useState(null)
  const pendientes = contarSugerencias(motivo, draft)
  const activo = pendientes > 0
  const nuevo = activo && motivoVisto !== motivo

  useEffect(() => {
    if (abierto) setMotivoVisto(motivo)
  }, [abierto, motivo])

  // Mientras la hoja está abierta, el fondo no scrollea.
  useEffect(() => {
    if (!abierto) return
    const previo = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previo }
  }, [abierto])

  const leyenda = activo
    ? `${pendientes} ${pendientes === 1 ? 'sugerencia' : 'sugerencias'} para "${motivo}"`
    : (motivo || motivoLibre) ? 'Sin guía para este motivo' : 'Elegí un motivo para ver sugerencias'

  return (
    <div className="lg:hidden">
      <button
        type="button"
        onClick={() => setAbierto(true)}
        aria-label={`Copiloto clínico: ${leyenda}`}
        className={`copiloto-barra fixed inset-x-0 bottom-0 z-40 flex items-center gap-3 px-4 pt-3 border-t text-left transition-colors ${
          activo
            ? 'bg-brand text-white border-brand shadow-[0_-6px_20px_rgba(0,0,0,0.12)]'
            : 'bg-bg-secondary text-text-tertiary border-border-default'
        }`}
      >
        <span className="relative shrink-0">
          <Sparkle className="h-5 w-5" weight={activo ? 'fill' : 'regular'} />
          {nuevo && (
            <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-danger opacity-75 animate-ping" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-danger" />
            </span>
          )}
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-[11px] font-bold uppercase tracking-widest">Copiloto clínico</span>
          <span className={`block text-xs truncate ${activo ? 'text-white/85' : ''}`}>{leyenda}</span>
        </span>
        {activo && (
          <span className="shrink-0 min-w-6 h-6 px-1.5 rounded-full bg-white text-brand text-xs font-bold flex items-center justify-center">
            {pendientes}
          </span>
        )}
      </button>

      {abierto && (
        <div className="fixed inset-0 z-[70] flex flex-col justify-end" role="dialog" aria-modal="true" aria-label="Copiloto clínico">
          <button
            type="button"
            aria-label="Cerrar el copiloto"
            onClick={() => setAbierto(false)}
            className="absolute inset-0 bg-black/40 animate-fade-in"
          />
          <div className="copiloto-hoja relative max-h-[85dvh] flex flex-col rounded-t-[20px] bg-bg-primary shadow-[0_-8px_30px_rgba(0,0,0,0.18)] animate-fade-in-up">
            <div className="shrink-0 flex items-center justify-between px-4 pt-3 pb-2">
              <span className="w-9" aria-hidden />
              <span className="h-1 w-10 rounded-full bg-border-default" aria-hidden />
              <button
                type="button"
                onClick={() => setAbierto(false)}
                aria-label="Cerrar"
                className="w-9 h-9 flex items-center justify-center rounded-full text-text-tertiary hover:text-text-primary"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4">
              <CopilotoClinico
                motivo={motivo}
                motivoLibre={motivoLibre}
                draft={draft}
                onToggleBandera={onToggleBandera}
                onTogglePregunta={onTogglePregunta}
                onToggleDiferencial={onToggleDiferencial}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
