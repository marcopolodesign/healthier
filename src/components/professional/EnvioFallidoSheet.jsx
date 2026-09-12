import { CloudSlash, ArrowClockwise, Check } from '@phosphor-icons/react'
import PatientSheet from '../patient/PatientSheet'

/**
 * La hoja que se abre cuando el envío del legajo no llegó a completarse.
 *
 * ── Por qué una hoja y no un toast ──────────────────────────────────────────
 * Pedido de Mateo (2026-09-12), después de que un profesional se quedara mirando
 * un "Failed to fetch" del navegador. Un toast se va solo y no ofrece nada: acá
 * el profesional necesita dos cosas que un cartel que desaparece no da —
 * **reintentar sin buscar el botón**, y saber que **no perdió lo que ya subió**.
 * Ese miedo es el que hace que alguien abandone el alta.
 *
 * ── Por qué se listan los documentos ────────────────────────────────────────
 * "Se cortó la conexión" no dice si hay que empezar de cero. La lista de lo que
 * ya está guardado lo responde antes de que lo pregunte.
 *
 * `PatientSheet` es el primitivo del repo: bottom sheet abajo de 640px, modal
 * centrado arriba. El onboarding se llena desde el teléfono, así que abajo
 * aparece como hoja de verdad.
 */
export default function EnvioFallidoSheet({ open, onClose, motivo, subidos = [], reintentando, onReintentar }) {
  return (
    <PatientSheet open={open} onClose={onClose} maxWidth="max-w-md" backdropClose={!reintentando}>
      <div className="px-5 pt-4 pb-5">
        <div className="flex items-center gap-2.5 mb-3">
          <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
            <CloudSlash className="h-5 w-5 text-amber-700" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-text-primary">Se cortó la conexión</h3>
            <p className="text-xs text-text-secondary">No llegamos a enviar tu legajo.</p>
          </div>
        </div>

        {motivo && (
          <p className="text-sm text-text-secondary mb-3">{motivo}</p>
        )}

        {subidos.length > 0 && (
          <div className="rounded-xl border border-border-default bg-bg-secondary p-3 mb-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-1.5">
              Esto ya quedó guardado
            </p>
            <ul className="space-y-1">
              {subidos.map(nombre => (
                <li key={nombre} className="flex items-center gap-1.5 text-[13px] text-text-primary">
                  <Check className="h-3.5 w-3.5 text-brand shrink-0" weight="bold" />
                  {nombre}
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-text-tertiary mt-2">
              No los vas a tener que subir de nuevo, ni ahora ni si cerrás la página.
            </p>
          </div>
        )}

        <button
          type="button"
          className="btn-primary w-full flex items-center justify-center gap-2 py-4"
          disabled={reintentando}
          onClick={onReintentar}
        >
          <ArrowClockwise className="h-4 w-4" />
          {reintentando ? 'Enviando…' : 'Enviar de nuevo'}
        </button>
        <button
          type="button"
          className="btn-secondary w-full mt-2 py-3"
          disabled={reintentando}
          onClick={onClose}
        >
          Ahora no
        </button>
      </div>
    </PatientSheet>
  )
}
