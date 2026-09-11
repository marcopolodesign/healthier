import { useState } from 'react'
import { Warning, PencilSimple } from '@phosphor-icons/react'
import FirmaPad from './FirmaPad'

/**
 * "Falta tu firma para poder emitir", dentro del panel de receta.
 *
 * ── Por qué acá y no sólo en Configuración ──────────────────────────────────
 * El profesional se entera de que existe la firma en el momento en que va a
 * emitir, no antes. Mandarlo a Configuración desde acá sería sacarlo de la
 * consulta —y en la app esta pantalla es la videollamada, así que navegar
 * significa cortar la llamada—, por eso el recuadro de firmar se abre acá
 * mismo y al guardar desbloquea el botón sin recargar nada.
 *
 * ── Es un bloqueo, no un aviso (Mateo, 2026-09-11) ──────────────────────────
 * Arrancó siendo opcional y Mateo lo cambió: sin firma no se emite. El bloqueo
 * de verdad lo hace `rcta-issue` (`RCTA_FIRMA_FALTANTE`, 422) — esto es la
 * mitad que le explica al profesional qué le falta y se lo deja resolver sin
 * moverse. Mismo formato que `DatosRecetaFaltantes`, que es el otro cartel de
 * "falta algo para emitir" de esta misma pantalla: dos carteles distintos para
 * el mismo problema confundirían.
 */
export default function FirmaFaltante({ userId, onCargada }) {
  const [abierto, setAbierto] = useState(false)

  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 space-y-2">
      <div className="flex items-start gap-2">
        <Warning className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" weight="fill" />
        <p className="text-xs font-bold text-amber-900">
          Falta tu firma para emitir la receta electrónica
        </p>
      </div>

      <div className="flex items-start justify-between gap-2 flex-wrap">
        <p className="text-[11px] text-amber-800">
          Se carga una sola vez y queda para todas tus recetas.
        </p>
        <button
          type="button"
          onClick={() => setAbierto(v => !v)}
          className="flex items-center gap-1 text-[11px] font-semibold text-amber-900 underline shrink-0"
        >
          <PencilSimple className="h-3 w-3" />
          {abierto ? 'Cerrar' : 'Firmar acá'}
        </button>
      </div>

      {abierto && (
        <div className="rounded-lg bg-white border border-amber-200 p-3">
          <FirmaPad
            userId={userId}
            compacto
            onGuardada={firma => { if (firma) onCargada?.() }}
          />
        </div>
      )}
    </div>
  )
}
