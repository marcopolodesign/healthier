// El código de cierre se pide ANTES de cortar (Mateo, 2026-10-22).
//
// Pedido textual: "cuando corta el profesional la videoconsulta, tiene que
// aparecer un bottom sheet para que solicite el código al paciente. Sino
// cortás y no se lo pediste — es peligroso."
//
// Hasta acá el código sólo se podía pedir desde la pestaña "Cerrar Consulta"
// del panel, y colgar no lo recordaba: el profesional cortaba, el paciente se
// iba, y el código ya no había a quién pedírselo. Ahora el colgar (y la X de la
// app) pasan por `alCortar`: si el código no está verificado, se abre la hoja
// (`CodigoAlCortarSheet.jsx`) con el MISMO pedido que ya existía
// (`solicitar_codigo` → `codigo_compartido`, migración 099). No bloquea: se
// puede cortar sin código, con una confirmación — decisión pendiente de Mateo.
//
// Lógica pura a propósito: la corre `scripts/test-codigo-al-cortar.mjs` sin
// navegador. Es el control de que cortar sin código no vuelva a ser directo.

/**
 * ¿Hay que pedir el código antes de cortar?
 *  - `enLlamada`: ya entró a Daily. En la sala de espera no hubo consulta, no
 *    hay código que pedir.
 *  - `codigoVerificadoEn`: `consultations.closing_code_verified_at`.
 *  - `simulando`: la práctica no tiene paciente del otro lado.
 */
export function hayQuePedirCodigo({ enLlamada, codigoVerificadoEn, simulando }) {
  if (simulando) return false
  if (!enLlamada) return false
  return !codigoVerificadoEn
}

/**
 * Qué hace el colgar: cortar directo, o abrir la hoja.
 * `motivo` = 'colgar' (botón rojo / Finalizar) o 'salir' (la X de la app).
 */
export function alCortar(estado, motivo = 'colgar') {
  return hayQuePedirCodigo(estado)
    ? { accion: 'pedir-codigo', motivo }
    : { accion: motivo === 'salir' ? 'salir' : 'cortar', motivo }
}

/**
 * Los pasos de la hoja.
 *  - 'pedir'      → input + "Pedir código" (principal) + "Cortar sin código".
 *  - 'esperando'  → ya se pidió, esperando que el paciente lo comparta.
 *  - 'verificado' → el principal pasa a "Cortar la llamada".
 *  - 'confirmar'  → "¿Cortar sin el código?".
 *  - 'agotado'    → sin intentos: el principal pasa a "Cortar sin código".
 */
export function pasoDeLaHoja({ codigoVerificadoEn, confirmando, intentosRestantes, solicitado }) {
  if (codigoVerificadoEn) return 'verificado'
  if (confirmando) return 'confirmar'
  if (intentosRestantes === 0) return 'agotado'
  if (solicitado) return 'esperando'
  return 'pedir'
}

// ── Puente con la app ────────────────────────────────────────────────────────
// La videollamada del profesional en la app es esta misma página en un WebView
// (`mobile/app/(pro)/videollamada/[id].tsx`). Su X nativa (salir de la sala)
// también tiene que pasar por la hoja: la app llama a
// `window.__healthierAntesDeSalir()` y la página le contesta por
// `ReactNativeWebView.postMessage` con uno de estos mensajes.
export const MENSAJE_APP = {
  HOJA_ABIERTA: 'codigo-hoja-abierta', // se abrió la hoja: la app espera
  SALIR: 'codigo-salir',               // la app puede volver
}

export function avisarALaApp(tipo) {
  try {
    window.ReactNativeWebView?.postMessage(JSON.stringify({ tipo }))
  } catch { /* fuera de la app no hay a quién avisar */ }
}
