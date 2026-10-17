/**
 * Estado compartido del perfil profesional (`professional_profiles`) del
 * profesional logueado — lo escriben `useMiPerfilProfesional` y
 * `professionalService.upsert`, y lo lee `clinicalService` para decir POR QUÉ
 * no hay matrícula al firmar (ver `motivoSinMatricula`).
 *
 * - `miPerfilCache`: el último perfil leído o guardado.
 * - `version`: sube con cada escritura (upsert). Una lectura que arrancó antes
 *   de una escritura no pisa el caché con datos viejos.
 * - `estadoLectura`: si la última lectura falló (red) o todavía está en curso.
 */
export const miPerfilCache = new Map()
const version = new Map()
const estadoLectura = new Map()
const listeners = new Set()

const avisar = userId => listeners.forEach(fn => fn(userId))

export const versionDe = userId => version.get(userId) ?? 0

/** Lo recién guardado por `upsert`: gana sobre cualquier lectura en vuelo. */
export function guardarMiPerfil(userId, perfil) {
  if (!userId) return
  version.set(userId, versionDe(userId) + 1)
  if (perfil) miPerfilCache.set(userId, perfil)
  estadoLectura.set(userId, { error: null, cargando: false, sinPerfil: !perfil })
  avisar(userId)
}

/** Resultado de una lectura que arrancó en `versionLeida`: se descarta si hubo una escritura después. */
export function leidoMiPerfil(userId, perfil, versionLeida) {
  if (!userId || versionLeida !== versionDe(userId)) return false
  if (perfil) miPerfilCache.set(userId, perfil)
  else miPerfilCache.delete(userId)
  estadoLectura.set(userId, { error: null, cargando: false, sinPerfil: !perfil })
  avisar(userId)
  return true
}

export function marcarLectura(userId, { cargando = false, error = null } = {}) {
  if (!userId) return
  const previo = estadoLectura.get(userId) ?? {}
  estadoLectura.set(userId, { ...previo, cargando, error })
}

export function alCambiarMiPerfil(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/**
 * Por qué un asiento de HC llegó sin matrícula: `null` si de verdad el perfil
 * no la tiene (→ "Falta tu matrícula"), o un mensaje si es que el perfil no se
 * pudo leer (red), todavía se está leyendo, o no existe. Un solo lugar para
 * esa distinción; lo usa `clinicalService` al firmar.
 */
export function motivoSinMatricula(userId) {
  const e = userId ? estadoLectura.get(userId) : null
  if (!e) return null
  if (e.error) return `No pudimos leer tu perfil profesional (${e.error.message || 'sin conexión'}). Revisá la conexión y probá de nuevo.`
  if (e.cargando && !miPerfilCache.has(userId)) return 'Todavía estamos leyendo tu perfil profesional: probá de nuevo en un segundo.'
  if (e.sinPerfil) return 'No encontramos tu perfil profesional.'
  return null
}
