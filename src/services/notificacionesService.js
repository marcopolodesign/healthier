import { supabase, toCamelCase } from '../lib/supabase'

/**
 * La campanita del paciente (migración 167). Las filas las escribe
 * `send-push-notification` con service role — este archivo sólo lee, marca
 * como leídas (vía RPC, nunca UPDATE directo) y escucha Realtime.
 *
 * El contador de no leídas vive en un pequeño pub-sub a nivel de módulo
 * (mismo patrón que `useVerticales`/`useEspecialidades`): así el badge de la
 * campanita en el header y la pantalla de Notificaciones comparten el mismo
 * número sin prop-drilling, y marcar todo como leído en la pantalla baja el
 * badge al instante aunque estén montados por separado.
 */

let unreadCount = 0
const listeners = new Set()

function notificar() {
  listeners.forEach(fn => fn(unreadCount))
}

export const notificacionesService = {
  /** Últimas notificaciones del paciente, más nuevas primero. */
  async listar(userId, { limit = 50 } = {}) {
    if (!userId) return []
    const { data, error } = await supabase
      .from('notificaciones')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) throw error
    return toCamelCase(data ?? [])
  },

  async contarNoLeidas(userId) {
    if (!userId) return 0
    const { count, error } = await supabase
      .from('notificaciones')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('leida_at', null)
    if (error) return 0
    return count ?? 0
  },

  /** Relee el contador de la base y avisa a todos los que están escuchando. */
  async refrescarContador(userId) {
    unreadCount = await this.contarNoLeidas(userId)
    notificar()
    return unreadCount
  },

  /**
   * Marca como leídas. `ids = null` marca TODAS las del paciente (lo que usa
   * la pantalla de Notificaciones al abrirse). Va por RPC — no hay policy de
   * UPDATE sobre la tabla a propósito (ver migración 167).
   */
  async marcarLeidas(ids = null) {
    const { data, error } = await supabase.rpc('marcar_notificaciones_leidas', { p_ids: ids })
    if (error) throw error
    unreadCount = ids ? Math.max(0, unreadCount - (Array.isArray(ids) ? ids.length : 1)) : 0
    notificar()
    return data
  },

  /** Suscribe un callback al contador compartido. Devuelve función para desuscribirse. */
  suscribirseANoLeidas(onCambio) {
    listeners.add(onCambio)
    onCambio(unreadCount)
    return () => listeners.delete(onCambio)
  },

  /**
   * Realtime — nueva notificación insertada para este paciente. Sube el
   * contador compartido en el momento, sin esperar un refetch.
   */
  suscribirseARealtime(userId, onNuevaNotificacion) {
    if (!userId) return () => {}
    const channel = supabase
      .channel(`notificaciones-${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notificaciones', filter: `user_id=eq.${userId}` },
        (payload) => {
          unreadCount += 1
          notificar()
          onNuevaNotificacion?.(toCamelCase(payload.new))
        }
      )
      .subscribe()
    return () => supabase.removeChannel(channel)
  },
}
