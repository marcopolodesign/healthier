/**
 * Permisos que no son un rol.
 *
 * Casi todo en Healthier se decide por `profile.role`. Esto es para lo que se
 * pidió por cuenta, no por categoría: hoy, el registro de subidas del legajo.
 *
 * 🔴 **Esconder no es proteger.** Lo que de verdad cierra la puerta es la RLS
 * (migración 163): aunque alguien escriba la URL a mano o mire el bundle, la
 * base no le devuelve una sola fila. Lo de acá es para que la pantalla no le
 * aparezca en el menú a quien no la puede usar.
 *
 * Cuando haya que sumar a alguien: se agrega el mail acá **y** en la policy.
 * Si la lista pasa de dos o tres, eso es la señal de que corresponde un rol de
 * verdad y no una lista de mails.
 */

/** Quién ve `/super-admin/subidas`. Pedido de Mateo, 2026-09-16. */
const MAILS_SUBIDAS = ['marcopolo@healthier.app']

export function veSubidas(profile) {
  return MAILS_SUBIDAS.includes((profile?.email || '').trim().toLowerCase())
}
