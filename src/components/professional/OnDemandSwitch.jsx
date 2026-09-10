import { useState, useEffect } from 'react'
import { Lightning, CircleNotch } from '@phosphor-icons/react'
import { professionalService } from '../../services/professionalService'
import { toast } from '../Toast'

/**
 * El switch de "consulta inmediata", arriba de todo en el panel del profesional.
 *
 * Vivía enterrado en Agenda y, peor, detrás de un botón "Guardar configuración":
 * había que acordarse de entrar a otra pantalla y guardar para existir en el pool
 * on-demand. Lo lógico es que esté donde el profesional aterriza al entrar
 * (Mateo, 2026-07-31). Guarda al instante, sin botón aparte.
 *
 * La disponibilidad dura una hora desde la última vez que se declaró y **no**
 * depende de tener la app abierta — ver `useOnDemandPresence`.
 *
 * 🔴 **Es controlado: el estado lo tiene el padre (`value`), no este componente.**
 * Antes tenía el suyo propio, cargado una sola vez al montar — y como el modal
 * de "¿estás disponible?" del Dashboard prende la disponibilidad por otro lado,
 * el switch seguía mostrándose apagado después de aceptar (Mateo, 2026-09-10).
 * Dos widgets del mismo dato con dos estados separados siempre se van a
 * desincronizar; la solución no es sincronizarlos, es que haya uno solo.
 */
export default function OnDemandSwitch({ profileId, value, onChange }) {
  const [cargado, setCargado] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!profileId) return
    professionalService.getByUserId(profileId)
      .then(p => {
        // El valor inicial se reporta hacia arriba, no se guarda acá: el padre
        // es el dueño. También al cargar y no sólo al togglear, porque el
        // dashboard necesita saber que está apagado para poder preguntar.
        onChange?.(Boolean(p?.isOnDemand))
        setCargado(true)
      })
      .catch(() => { onChange?.(false); setCargado(true) })
    // `onChange` a propósito fuera de las deps: es un callback inline del padre y
    // re-dispararía el fetch en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId])

  const enabled = cargado ? Boolean(value) : null

  const toggle = async () => {
    if (saving || enabled === null) return
    const next = !enabled
    setSaving(true)
    // Optimista: el switch tiene que responder al toque, no después del round-trip.
    onChange?.(next)
    try {
      await professionalService.setOnDemand(profileId, next)
      toast.success(next
        ? 'Estás disponible para consultas inmediatas'
        : 'Ya no aparecés para consultas inmediatas')
    } catch {
      onChange?.(!next)
      toast.error('No pudimos guardar el cambio')
    } finally {
      setSaving(false)
    }
  }

  const on = enabled === true

  return (
    <div className={`card flex items-center justify-between gap-4 ${on ? 'border-2 border-accent/40' : ''}`}>
      <div className="flex items-center gap-3 min-w-0">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${on ? 'bg-accent-muted' : 'bg-bg-surface'}`}>
          <Lightning className={`h-5 w-5 ${on ? 'text-accent' : 'text-text-tertiary'}`} weight={on ? 'fill' : 'regular'} />
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-text-primary">Consulta inmediata</p>
          <p className="text-sm text-text-secondary">
            {enabled === null
              ? 'Cargando…'
              : on
                ? 'Estás disponible: te pueden llegar consultas ahora.'
                : 'No estás disponible para consultas inmediatas.'}
          </p>
        </div>
      </div>

      <button
        onClick={toggle}
        disabled={saving || enabled === null}
        aria-pressed={on}
        aria-label="Disponible para consulta inmediata"
        className={`w-12 h-7 rounded-full transition-colors relative shrink-0 disabled:opacity-60 ${on ? 'bg-accent' : 'bg-gray-300'}`}
      >
        {saving
          ? <CircleNotch className="h-4 w-4 animate-spin text-white absolute top-1.5 left-4" />
          : <div className={`w-5 h-5 bg-white rounded-full absolute top-1 transition-transform ${on ? 'translate-x-6' : 'translate-x-1'}`} />}
      </button>
    </div>
  )
}
