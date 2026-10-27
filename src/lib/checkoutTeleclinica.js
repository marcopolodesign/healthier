/**
 * Teleclínica — el orden "primero las preguntas, después el pago" (opción B de
 * Felipe, elegida por Mateo el 2026-10-19).
 *
 *   · Al entrar se abren directo las preguntas, con "Paso 1 de N". N es real:
 *     síntoma, detalle, medicación, "Tus datos" sólo si faltan DNI / sexo /
 *     fecha de nacimiento, y el pago como último paso.
 *   · Mientras se contesta, ningún botón dice "Pagar": sólo "Continuar".
 *   · La pantalla de pago aparece SÓLO con la preconsulta respondida, y su
 *     botón es "Pagar y solicitar" (tarjeta guardada con CVV o tarjeta nueva).
 *
 * Es lógica pura a propósito: la pantalla la usa y el control
 * `npm run test:teleclinica` la prueba. Espejo en la app:
 * `mobile/src/lib/checkoutTeleclinica.ts`.
 */

export const ETIQUETA_PAGAR = 'Pagar y solicitar'

/**
 * Cuántas preguntas hay antes del pago en Clínica: 3, o 4 si faltan datos para la
 * receta. Ya no cuenta el recorrido real (depende del triage de la vertical, ver
 * `pasosDe` en `armarPreconsulta.js`); queda como referencia del caso de Clínica.
 */
export function preguntasTeleclinica({ pideDatos }) {
  return pideDatos ? 4 : 3
}

/** N de "Paso X de N": las preguntas más el pago. */
export function pasosTeleclinica({ pideDatos }) {
  return preguntasTeleclinica({ pideDatos }) + 1
}

/**
 * Qué se muestra: 'preguntas' o 'pago'. Sin preconsulta nunca es 'pago'. La
 * única excepción es la tarjeta rechazada DESPUÉS de que alguien aceptó: ese
 * pedido ya salió con su preconsulta y sólo falta otra tarjeta.
 */
export function vistaTeleclinica({ preconsulta, rechazado = false, editando = false }) {
  if (rechazado) return 'pago'
  if (!preconsulta || editando) return 'preguntas'
  return 'pago'
}

/** ¿Se puede mandar el pedido? Nunca sin la preconsulta respondida. */
export function puedeSolicitar({ preconsulta, rechazado = false }) {
  return rechazado || Boolean(preconsulta)
}

/** El texto del botón principal de la pantalla de pago. */
export function etiquetaBotonPago({ paying = false, rechazado = false, errorPago = false, exento = false }) {
  if (paying) return rechazado ? 'Autorizando…' : 'Procesando…'
  if (errorPago) return 'Reintentar'
  if (rechazado) return 'Pagar con esta tarjeta'
  if (exento) return 'Solicitar consulta'
  return ETIQUETA_PAGAR
}
