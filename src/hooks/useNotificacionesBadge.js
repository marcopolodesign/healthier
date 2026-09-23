import { useState, useEffect } from 'react'
import { notificacionesService } from '../services/notificacionesService'

/**
 * Contador de notificaciones no leídas del paciente — compartido entre el
 * header (campanita) y la pantalla de Notificaciones vía
 * `notificacionesService`. Se refresca al montar y se mantiene al día con
 * Realtime (INSERT filtrado por `user_id`).
 */
export function useNotificacionesBadge(userId) {
  const [count, setCount] = useState(0)

  useEffect(() => {
    if (!userId) return
    const dejarDeEscuchar = notificacionesService.suscribirseANoLeidas(setCount)
    notificacionesService.refrescarContador(userId).catch(() => {})
    const dejarDeEscucharRealtime = notificacionesService.suscribirseARealtime(userId)
    return () => { dejarDeEscuchar(); dejarDeEscucharRealtime() }
  }, [userId])

  return count
}
