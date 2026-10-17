/**
 * Caché de la especialidad del profesional logueado (`useMiEspecialidad`).
 * Vive aparte del hook para que `professionalService.upsert` lo pueda vaciar
 * sin importar el hook (sería un import circular): cualquier escritura del
 * perfil profesional —el onboarding que cambia de especialidad, Configuración—
 * lo invalida y la próxima pantalla la vuelve a leer.
 */
export const miEspecialidadCache = new Map()
const listeners = new Set()

export function invalidarMiEspecialidad(userId) {
  if (userId) miEspecialidadCache.delete(userId)
  else miEspecialidadCache.clear()
  listeners.forEach(fn => fn(userId))
}

export function alInvalidarMiEspecialidad(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
