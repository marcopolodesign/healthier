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
 * Se apaga explícitamente al desmontar y cuando la pestaña deja de estar
 * visible: un profesional que minimiza la app no debería seguir apareciendo
 * como disponible hasta que venza el TTL.
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

    // Minimizar/cambiar de pestaña baja la disponibilidad; volver la restaura.
    const onVisibility = () => {
      if (cancelled) return
      if (document.visibilityState === 'visible') ping()
      else professionalService.goOffline().catch(() => {})
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      clearInterval(iv)
      document.removeEventListener('visibilitychange', onVisibility)
      professionalService.goOffline().catch(() => {})
    }
  }, [enabled])
}
