/**
 * Reglas de precio de una consulta — un solo lugar.
 *
 * El piso lo fijó Mateo el 2026-09-02: **$15.000 para toda consulta, presencial
 * o por videollamada, de cualquier profesional de la app**. No es una
 * sugerencia: un precio por debajo no cuenta como campo completado y la base lo
 * rechaza (migración 142), así que el mismo número tiene que vivir acá, en el
 * checklist del dashboard y en el trigger — si divergen, el profesional ve un
 * formulario que lo deja guardar algo que después le rebota.
 */
export const PRECIO_MINIMO = 15000

/** "$15.000" — para el copy, siempre derivado del número de arriba. */
export const PRECIO_MINIMO_TEXTO = `$${PRECIO_MINIMO.toLocaleString('es-AR')}`

/** Orientativo, por encima del piso. No se valida: es una recomendación. */
export const SUGGESTED_PRICE_RANGE = { min: 20000, max: 35000, recommended: 25000 }

/**
 * Un precio vacío/`null` es "todavía no lo cargó", que es distinto de "lo cargó
 * mal": no rompe nada, sólo deja el campo pendiente. Lo que no se acepta es un
 * número por debajo del piso.
 */
export function cumplePrecioMinimo(valor) {
  if (valor === null || valor === undefined || valor === '') return false
  const n = Number(valor)
  return Number.isFinite(n) && n >= PRECIO_MINIMO
}

/** `true` si hay un valor cargado y está por debajo del piso. */
export function estaPorDebajoDelMinimo(valor) {
  if (valor === null || valor === undefined || valor === '') return false
  const n = Number(valor)
  return Number.isFinite(n) && n > 0 && n < PRECIO_MINIMO
}
