/**
 * Caché del perfil profesional (`professional_profiles`) del profesional
 * logueado — lo comparten `useMiPerfilProfesional` / `useMiEspecialidad`.
 * Vive aparte del hook para que `professionalService.upsert` lo actualice sin
 * importar el hook (sería un import circular).
 */
export const miPerfilCache = new Map()
const listeners = new Set()

/** Deja el perfil recién guardado (o lo borra si no viene) y avisa. */
export function actualizarMiPerfil(userId, perfil) {
  if (!userId) return
  if (perfil) miPerfilCache.set(userId, perfil)
  else miPerfilCache.delete(userId)
  listeners.forEach(fn => fn(userId))
}

export function alCambiarMiPerfil(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
