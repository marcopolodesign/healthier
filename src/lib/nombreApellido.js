/**
 * Nombre y apellido por separado (migración 183).
 *
 * `profiles.first_name` / `profiles.last_name` son la fuente; `full_name` lo
 * arma la base sola con los dos. Este archivo tiene las tres cosas que el front
 * necesita alrededor de eso:
 *
 *   · `necesitaApellido(profile)` — a quién se le pide el paso bloqueante.
 *   · `propuestaDeNombre(fullName)` — cómo se precarga ese paso. Es una
 *     PROPUESTA: la persona la confirma o la corrige, nunca se guarda sola.
 *   · `validarNombreApellido(nombre, apellido)` — el mensaje de error si falta algo.
 *
 * Espejado en `mobile/src/lib/nombreApellido.ts`.
 */

// Los mismos títulos que salta `nombreDePila` (lib/format.js).
const TITULOS = new Set(['dr', 'dra', 'lic', 'licda', 'mg', 'mgtr', 'prof', 'ing', 'od', 'klgo', 'klga', 'tec'])

/** Roles a los que se les exige apellido. Farmacia, despacho y admins no. */
const ROLES_CON_APELLIDO = new Set(['patient', 'professional'])

/**
 * ¿Hay que pedirle el apellido a esta persona antes de dejarla seguir?
 *
 * - Sólo pacientes y profesionales.
 * - Nunca a un familiar sin login propio (`titularId`, migración 181): sus
 *   datos los carga el titular desde el grupo familiar.
 * - Nunca a quien entró con Sign in with Apple (`provider === 'apple'`):
 *   Guideline 4 de App Review — no se le puede volver a pedir el nombre a quien
 *   ya se lo dio Apple. Lo completa, si quiere, desde Perfil.
 */
export function necesitaApellido(profile, provider = null) {
  if (!profile || !ROLES_CON_APELLIDO.has(profile.role)) return false
  // Sin la clave, el perfil viene de una base sin la migración 183 (o de un
  // cache anterior a ella, que la revalidación reemplaza enseguida). Ahí no se
  // pide nada: no hay dónde guardarlo, y bloquear a todos sería peor.
  if (!('lastName' in profile)) return false
  if (profile.titularId) return false
  if (provider === 'apple') return false
  return !String(profile.lastName ?? '').trim()
}

function capitalizarSiHaceFalta(texto) {
  // Sólo se toca lo que está TODO en mayúsculas o TODO en minúsculas
  // ("DRA SEMINARIO", "maria laura"). Un "María de los Ángeles" escrito a mano
  // se respeta tal cual.
  if (texto !== texto.toUpperCase() && texto !== texto.toLowerCase()) return texto
  return texto
    .toLocaleLowerCase('es-AR')
    .split(' ')
    .map(p => (['de', 'del', 'la', 'las', 'los', 'y'].includes(p) ? p : p.charAt(0).toLocaleUpperCase('es-AR') + p.slice(1)))
    .join(' ')
}

/**
 * Propuesta para precargar el paso. Es la misma regla con la que la receta
 * parte el nombre hoy (`splitName` en `rcta-issue`: la última palabra es el
 * apellido), así la persona ve exactamente cómo está saliendo y lo corrige.
 * Además saca el título del principio y arregla las mayúsculas.
 */
export function propuestaDeNombre(fullName) {
  const partes = String(fullName ?? '').trim().split(/\s+/).filter(Boolean)
  while (partes.length > 1 && TITULOS.has(partes[0].toLowerCase().replace(/\.$/, ''))) partes.shift()
  if (partes.length === 0) return { nombre: '', apellido: '' }
  const limpio = capitalizarSiHaceFalta(partes.join(' ')).split(' ')
  if (limpio.length === 1) return { nombre: limpio[0], apellido: '' }
  return { nombre: limpio.slice(0, -1).join(' '), apellido: limpio[limpio.length - 1] }
}

/** El nombre y el apellido de un perfil para editarlos: lo guardado, o la propuesta. */
export function nombreApellidoDe(profile) {
  if (profile?.lastName?.trim()) {
    return { nombre: profile.firstName ?? '', apellido: profile.lastName }
  }
  return propuestaDeNombre(profile?.fullName)
}

/** `null` si está todo bien; si no, el mensaje para mostrar. */
export function validarNombreApellido(nombre, apellido) {
  if (!String(nombre ?? '').trim()) return 'Ingresá tu nombre.'
  if (!String(apellido ?? '').trim()) return 'Ingresá tu apellido.'
  return null
}

/**
 * Mismo criterio que `nombre_normalizado()` de la base (migración 183): las
 * palabras en minúsculas, sin tildes ni títulos, ordenadas. Si da distinto, a
 * un profesional verificado el cambio le vuelve a abrir la revisión.
 */
export function nombreNormalizado(texto) {
  return String(texto ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-zñ\s]/g, ' ')
    .split(/\s+/)
    .filter(p => p && !['dr', 'dra', 'lic', 'lica', 'prof', 'mg', 'mgtr'].includes(p))
    .sort()
    .join(' ')
}

/** "Ana" + "Pérez" → "Ana Pérez". Es lo mismo que arma la base. */
export function armarNombreCompleto(nombre, apellido) {
  return [nombre, apellido].map(s => String(s ?? '').trim().replace(/\s+/g, ' ')).filter(Boolean).join(' ')
}
