import { useEffect, useState } from 'react'
import { Signature, CaretDown } from '@phosphor-icons/react'
import { firmaService } from '../../services/firmaService'
import FirmaPad from './FirmaPad'

/**
 * El aviso de "todavía no cargaste tu firma", dentro del panel de receta.
 *
 * ── Por qué acá y no sólo en Configuración ──────────────────────────────────
 * El profesional se entera de que existe la firma en el momento en que va a
 * emitir, no antes. Mandarlo a Configuración desde acá sería sacarlo de la
 * consulta —y en la app esta pantalla es la videollamada, así que navegar
 * significa cortar la llamada—, por eso el recuadro de firmar se abre acá
 * mismo y al guardar vuelve a cerrarse solo.
 *
 * ── Por qué es un aviso y no un bloqueo ─────────────────────────────────────
 * La firma es opcional (decisión de Mateo, 2026-09-11). La receta sin ella es
 * igual de válida: la firma electrónica la aplica el servicio de recetas contra
 * la matrícula. Frenar una emisión por esto dejaría a un paciente sin su receta
 * con el médico en pantalla, que es peor que una receta con la línea de puño en
 * blanco. De ahí que se pueda cerrar y siga estando el botón de emitir.
 */
export default function FirmaFaltante({ professionalId }) {
  const [estado, setEstado] = useState('cargando') // cargando | falta | ok
  const [abierto, setAbierto] = useState(false)

  useEffect(() => {
    if (!professionalId) return
    let vivo = true
    firmaService.get(professionalId)
      .then(f => { if (vivo) setEstado(f ? 'ok' : 'falta') })
      // Un fallo leyendo la firma no puede meter ruido en la pantalla donde se
      // receta: se calla y no muestra nada.
      .catch(() => { if (vivo) setEstado('ok') })
    return () => { vivo = false }
  }, [professionalId])

  if (estado !== 'falta') return null

  return (
    <div className="rounded-xl border border-border-default bg-bg-surface overflow-hidden">
      <button
        type="button"
        onClick={() => setAbierto(v => !v)}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left"
      >
        <Signature className="h-4 w-4 text-text-secondary shrink-0" />
        <span className="flex-1 text-xs text-text-secondary">
          Tus recetas salen sin tu firma. Cargala una vez y queda para todas.
        </span>
        <CaretDown className={`h-3.5 w-3.5 text-text-tertiary shrink-0 transition-transform ${abierto ? 'rotate-180' : ''}`} />
      </button>

      {abierto && (
        <div className="border-t border-border-default p-3">
          <FirmaPad
            userId={professionalId}
            compacto
            onGuardada={firma => { if (firma) setEstado('ok') }}
          />
        </div>
      )}
    </div>
  )
}
