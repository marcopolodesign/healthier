import { useEffect } from 'react'
import { professionalService, ON_DEMAND_HEARTBEAT_MS } from '../services/professionalService'

/**
 * Mantiene viva la disponibilidad on-demand del profesional mientras tiene la
 * app abierta y el switch encendido.
 *
 * Antes el match miraba solo `is_on_demand`, un flag estático del perfil: un
 * médico que lo tildó hace meses y está durmiendo se matcheaba igual, el
 * paciente pagaba, esperaba los 10 minutos de la ventana y se caía. Este latido
 * es la mitad que faltaba — la intención declarada sigue siendo `is_on_demand`,
 * pero para entrar al pool ahora hay que además estar vivo.
 *
 * **Cerrar la pestaña NO lo baja** (Mateo, 2026-07-31). Antes sí: se llamaba a
 * `goOffline()` al desmontar y al ocultarse la pestaña, así que el médico dejaba
 * de existir en el pool apenas cambiaba de solapa. Ahora el latido sólo **renueva**
 * la hora de vigencia mientras la app está abierta; lo único que apaga la
 * disponibilidad es apagar el switch.
 *
 * @param {boolean} enabled — el profesional tiene on-demand encendido.
 */
export function useOnDemandPresence(enabled) {
  useEffect(() => {
    if (!enabled) {
      // Apagó el switch: bajarlo ya, sin esperar el TTL.
      professionalService.goOffline().catch(() => {})
      return
    }

    let cancelled = false
    const ping = () => {
      if (!cancelled && document.visibilityState === 'visible') {
        professionalService.pingOnline().catch(() => {})
      }
    }

    ping()
    const iv = setInterval(ping, ON_DEMAND_HEARTBEAT_MS)

    // Volver a la pestaña renueva la vigencia. Irse NO la baja: la disponibilidad
    // dura una hora desde el último ping, esté la app abierta o no.
    const onVisibility = () => {
      if (cancelled) return
      if (document.visibilityState === 'visible') ping()
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      clearInterval(iv)
      document.removeEventListener('visibilitychange', onVisibility)
      // Sin `goOffline()`: desmontar es navegar a otra pantalla o cerrar la app, y
      // ninguna de las dos cosas significa "ya no atiendo".
    }
  }, [enabled])
}
