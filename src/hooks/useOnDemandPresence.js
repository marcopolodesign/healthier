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
 * **`null` significa "todavía no sé"** y no hace nada. Sin esa distinción, montar
 * el layout llamaba a `goOffline()` con el `false` inicial del estado —antes de
 * que llegara el valor real del perfil— y le borraba `on_demand_last_seen_at` a
 * un profesional que tenía el switch prendido. Si la pestaña se cerraba en ese
 * hueco, quedaba en `is_on_demand = true` y `on_demand_last_seen_at = NULL`:
 * "Estás disponible" en su panel y afuera del pool para siempre, porque nada
 * vuelve a latir solo. Es exactamente lo que ya se había arreglado en mobile
 * (`OnDemandStatusBar`, guard `estadoCargado`) y acá faltaba.
 *
 * @param {boolean|null} enabled — on-demand encendido, o `null` si aún no se sabe.
 */
export function useOnDemandPresence(enabled) {
  useEffect(() => {
    if (enabled === null || enabled === undefined) return
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
