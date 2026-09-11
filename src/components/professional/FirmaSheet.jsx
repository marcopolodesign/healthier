import { Signature } from '@phosphor-icons/react'
import PatientSheet from '../patient/PatientSheet'
import FirmaPad from './FirmaPad'

/**
 * La hoja que se abre al apretar "Emitir receta" cuando el profesional todavía
 * no cargó su firma. Firma ahí y la emisión sigue sola.
 *
 * ── Por qué al apretar, y no un cartel antes ────────────────────────────────
 * Pedido de Mateo (2026-09-11). Antes el botón quedaba apagado y arriba había
 * un cartel que desplegaba el recuadro: el profesional tenía que descubrirlo,
 * y en el panel angosto de la videollamada el cartel puede quedar fuera de
 * pantalla. Con la hoja, el disparador es la acción que él ya quiso hacer.
 *
 * ── Por qué se sigue solo al guardar ────────────────────────────────────────
 * Si al cerrar hubiera que volver a apretar "Emitir", la hoja sería un
 * obstáculo en vez de un atajo. Quien la abrió ya dijo que quiere emitir; la
 * firma es un requisito que le faltaba, no una decisión nueva.
 *
 * ── Por qué `PatientSheet` ──────────────────────────────────────────────────
 * Es el primitivo responsive del repo: bottom sheet abajo de 640px, modal
 * centrado arriba. El recetario de la app es este mismo website dentro de un
 * WebView, así que con esto en el teléfono sale como bottom sheet de verdad —
 * un componente nativo aparte no tendría dónde vivir. El nombre dice "Patient"
 * por dónde nació, pero es genérico y ya se usa fuera de `patient/`
 * (`payment/MPCardHolder.jsx`).
 */
export default function FirmaSheet({ open, onClose, userId, onFirmada }) {
  return (
    <PatientSheet open={open} onClose={onClose} maxWidth="max-w-xl">
      <div className="px-5 pt-4 pb-2 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-brand/10 flex items-center justify-center shrink-0">
            <Signature className="h-5 w-5 text-brand" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-text-primary">Falta tu firma</h3>
            <p className="text-xs text-text-secondary">
              Se carga una sola vez y queda para todas tus recetas.
            </p>
          </div>
        </div>
      </div>

      <div className="px-5 pb-5 overflow-y-auto">
        <FirmaPad
          userId={userId}
          compacto
          onGuardada={firma => { if (firma) onFirmada?.() }}
        />
        <p className="text-[11px] text-text-tertiary mt-3">
          Firmá con el dedo o el mouse, o subí una foto de tu firma hecha en papel.
          Apenas la guardes seguimos con la receta.
        </p>
      </div>
    </PatientSheet>
  )
}
