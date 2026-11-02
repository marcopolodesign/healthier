/**
 * Qué modalidad de turno ofrece un profesional — un solo lugar.
 *
 * Incidente 2026-11-02 (prod): una paciente eligió "Presencial", reservó y pagó
 * $15.000 con una profesional que atiende SÓLO por video. La lista no filtraba
 * por modalidad, el precio presencial caía al de video (`?? sessionPrice`) y el
 * pago convertía en "presencial" cualquier modalidad que no fuera 'virtual'.
 *
 * Las reglas, que la base repite en el trigger de la migración 220
 * (`validar_turno_presencial`) — si una cambia, cambia la otra:
 *   Presencial = (a) atiende presencial, (b) tiene precio presencial propio y
 *                (c) tiene un consultorio con calle y número.
 *   Virtual    = tiene precio de video.
 * Y la modalidad NUNCA se deduce por descarte: o es 'virtual' / 'presencial'
 * explícita, o es un error.
 */
import { atiendePresencial } from './profileCompleteness'

export const MODALIDADES = ['virtual', 'presencial']

/**
 * ¿La dirección tiene calle y número? Mismo criterio que `direccionTieneNumero`
 * de `geo.js` (la validación del formulario del consultorio) y que
 * `direccion_con_numero()` en la base. Nominatim pone la altura primero:
 * "2839, Arenales, Barrio Norte…".
 */
export function direccionConNumero(direccion) {
  const calle = String(direccion ?? '').split(',')[0].replace(/\s+/g, ' ').trim()
  if (!calle) return false
  if (/^\d{1,5}\s?[A-Za-z]?$/.test(calle) && String(direccion).includes(',')) {
    const siguiente = String(direccion).split(',')[1] ?? ''
    return /\p{L}{3}/u.test(siguiente)
  }
  const sinNombresConNumero = calle
    .replace(/\s*\b(piso|p\.|dto\.?|depto\.?|departamento|of\.?|oficina|local)\b.*$/i, '')
    .replace(/^(?:calle|cl\.?)?\s*\d{1,4}\s*[-–—]\s*/i, '')
    .replace(/\b(?:calle|cl\.?|ruta|rn|rp|camino|diagonal|diag\.?|autopista|pasaje|pje\.?)\s*n?[°º.]?\s*\d{1,3}\b/gi, '')
    .replace(/\b\d{1,2}(?:ro|°|º)?\s+de\s+\p{L}+/giu, '')
  return /\d/.test(sinNombresConNumero) && /\p{L}{2}/u.test(calle)
}

const positivo = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Precio presencial PROPIO. Jamás cae al de video ni al `sessionPrice`. */
export function precioPresencial(pro) {
  return positivo(pro?.pricePresencial)
}

/**
 * Precio de video. `sessionPrice` (la columna anterior a la división por
 * modalidad) sólo sirve de respaldo para quien nunca cargó ningún precio
 * dividido; si ya cargó el presencial, no se lo toma por el de video.
 */
export function precioVideo(pro) {
  const propio = positivo(pro?.priceVideo)
  if (propio != null) return propio
  return precioPresencial(pro) == null ? positivo(pro?.sessionPrice) : null
}

/**
 * ¿Ofrece este profesional esa modalidad? → `{ ok, precio, motivo }`.
 * `motivo` es una línea legible para decirle al paciente por qué no.
 */
export function ofreceModalidad(pro, modalidad) {
  if (modalidad === 'virtual') {
    const precio = precioVideo(pro)
    return precio != null
      ? { ok: true, precio, motivo: null }
      : { ok: false, precio: null, motivo: 'Este profesional no tiene precio cargado para videoconsulta.' }
  }
  if (modalidad === 'presencial') {
    if (!atiendePresencial(pro)) {
      return { ok: false, precio: null, motivo: 'Este profesional atiende sólo por videoconsulta.' }
    }
    const precio = precioPresencial(pro)
    if (precio == null) {
      return { ok: false, precio: null, motivo: 'Este profesional no tiene precio cargado para consultas presenciales.' }
    }
    if (!direccionConNumero(pro?.address)) {
      return { ok: false, precio: null, motivo: 'Este profesional todavía no cargó la dirección completa de su consultorio.' }
    }
    return { ok: true, precio, motivo: null }
  }
  return { ok: false, precio: null, motivo: 'Elegí si la consulta es por videoconsulta o presencial.' }
}

/**
 * Valor de la columna `consultations.modality`. Nunca por descarte: cualquier
 * cosa que no sea 'virtual' o 'presencial' explícito (null, undefined, otro
 * texto) es un error — antes caía en 'presencial' y se cobraba y guardaba mal.
 */
export function modalidadParaBase(modalidad) {
  if (modalidad === 'virtual') return 'video'
  if (modalidad === 'presencial') return 'presencial'
  throw new Error('No pudimos saber si la consulta es presencial o por videoconsulta. Volvé a elegir la modalidad.')
}
