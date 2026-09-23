import { useState, useEffect, useRef } from 'react'
import { Lightning, CircleNotch } from '@phosphor-icons/react'
import { professionalService, ON_DEMAND_PRESENCE_TTL_MS } from '../../services/professionalService'
import { toast } from '../Toast'

/** Hora local AR, "HH:MM" — el profesional puede estar en cualquier huso al viajar. */
function formatHoraAR(date) {
  return new Intl.DateTimeFormat('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(date)
}

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
 *
 * 🔴 **"Estás disponible" mentía después de vencer** (Mateo, 2026-09-23): el
 * switch mostraba el texto fijo de arriba aunque `on_demand_last_seen_at` ya
 * hubiera pasado el TTL de una hora — le pasó a una profesional real, con el
 * switch prendido y cero pacientes pudiendo verla. Ahora la vigencia se calcula
 * de verdad (`onDemandLastSeenAt + TTL`) y se re-chequea cada minuto, sin
 * esperar a que alguien recargue la página.
 */
export default function OnDemandSwitch({ profileId, value, onChange }) {
  const [cargado, setCargado] = useState(false)
  const [saving, setSaving] = useState(false)
  const [lastSeenAt, setLastSeenAt] = useState(null)
  // Fuerza un re-render cada minuto para que "vence a las..." / "ya venció" se
  // actualicen solos mientras el panel sigue abierto, sin depender de un fetch.
  const [, setTick] = useState(0)
  const profileIdRef = useRef(profileId)
  profileIdRef.current = profileId

  const cargarEstado = () => {
    if (!profileIdRef.current) return
    professionalService.getByUserId(profileIdRef.current)
      .then(p => {
        // El valor inicial se reporta hacia arriba, no se guarda acá: el padre
        // es el dueño. También al cargar y no sólo al togglear, porque el
        // dashboard necesita saber que está apagado para poder preguntar.
        onChange?.(Boolean(p?.isOnDemand))
        setLastSeenAt(p?.onDemandLastSeenAt ? new Date(p.onDemandLastSeenAt) : null)
        setCargado(true)
      })
      .catch(() => { onChange?.(false); setCargado(true) })
  }

  useEffect(() => {
    cargarEstado()
    // `onChange` a propósito fuera de las deps: es un callback inline del padre y
    // re-dispararía el fetch en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId])

  // Re-lee `on_demand_last_seen_at` cada minuto: el latido de `useOnDemandPresence`
  // lo renueva en la base cada 30s mientras el panel está abierto, y sin este
  // refresco el cartel se quedaba mostrando la hora de vencimiento del primer
  // fetch en vez de la que el latido va corriendo.
  useEffect(() => {
    if (!profileId) return
    const iv = setInterval(cargarEstado, 60_000)
    return () => clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId])

  // Tick de un minuto sólo para recalcular "vencido" en pantalla — no pega a la red.
  useEffect(() => {
    const iv = setInterval(() => setTick(t => t + 1), 60_000)
    return () => clearInterval(iv)
  }, [])

  const enabled = cargado ? Boolean(value) : null
  const on = enabled === true
  const expiresAt = lastSeenAt ? new Date(lastSeenAt.getTime() + ON_DEMAND_PRESENCE_TTL_MS) : null
  // Prendido pero sin latido vigente (o sin latido nunca escrito): invisible
  // para el pool aunque el switch diga que sí.
  const vencido = on && (!expiresAt || Date.now() >= expiresAt.getTime())

  const toggle = async () => {
    if (saving || enabled === null) return
    setSaving(true)

    // Vencido: no apaga, renueva. Es la misma función que ya escribe
    // `on_demand_last_seen_at` — nada de duplicar la lógica acá.
    if (vencido) {
      try {
        await professionalService.setOnDemand(profileId, true)
        setLastSeenAt(new Date())
        onChange?.(true)
        toast.success('Volviste a estar disponible para consultas inmediatas')
      } catch {
        toast.error('No pudimos renovar tu disponibilidad')
      } finally {
        setSaving(false)
      }
      return
    }

    const next = !enabled
    // Optimista: el switch tiene que responder al toque, no después del round-trip.
    onChange?.(next)
    try {
      await professionalService.setOnDemand(profileId, next)
      if (next) setLastSeenAt(new Date())
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

  let subtitulo = 'No estás disponible para consultas inmediatas.'
  if (enabled === null) subtitulo = 'Cargando…'
  else if (vencido) subtitulo = 'Ya no te ven: tocá para volver a estar disponible.'
  else if (on && expiresAt) subtitulo = `Visible para pacientes hasta las ${formatHoraAR(expiresAt)}.`

  return (
    <div className={`card flex items-center justify-between gap-4 ${on && !vencido ? 'border-2 border-accent/40' : vencido ? 'border-2 border-amber-400/50' : ''}`}>
      <div className="flex items-center gap-3 min-w-0">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${vencido ? 'bg-amber-100' : on ? 'bg-accent-muted' : 'bg-bg-surface'}`}>
          <Lightning className={`h-5 w-5 ${vencido ? 'text-amber-600' : on ? 'text-accent' : 'text-text-tertiary'}`} weight={on ? 'fill' : 'regular'} />
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-text-primary">Consulta inmediata</p>
          <p className={`text-sm ${vencido ? 'text-amber-700 font-medium' : 'text-text-secondary'}`}>
            {subtitulo}
          </p>
        </div>
      </div>

      <button
        onClick={toggle}
        disabled={saving || enabled === null}
        aria-pressed={on && !vencido}
        aria-label={vencido ? 'Volver a estar disponible para consulta inmediata' : 'Disponible para consulta inmediata'}
        className={`w-12 h-7 rounded-full transition-colors relative shrink-0 disabled:opacity-60 ${vencido ? 'bg-amber-400' : on ? 'bg-accent' : 'bg-gray-300'}`}
      >
        {saving
          ? <CircleNotch className="h-4 w-4 animate-spin text-white absolute top-1.5 left-4" />
          : <div className={`w-5 h-5 bg-white rounded-full absolute top-1 transition-transform ${on ? 'translate-x-6' : 'translate-x-1'}`} />}
      </button>
    </div>
  )
}
