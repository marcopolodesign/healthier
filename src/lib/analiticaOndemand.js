/**
 * Analítica de la consulta inmediata (Hyppo, 2026-11-11). Funciones puras o
 * casi, para poder probarlas sin montar la pantalla: `npm run test:camino-al-turno`.
 */

/**
 * Qué tipo de error de pago fue, para `payment_error` con
 * `checkout_type: 'ondemand'`. Nunca manda el texto del error (puede traer datos
 * de la tarjeta o del banco): sólo una de tres categorías.
 *
 *   debit_not_allowed — la consulta inmediata sólo se pre-autoriza con crédito
 *                       (`ondemand-despacho` contesta 422 con débito o dinero en
 *                       cuenta).
 *   server_error      — red, timeout, 5xx o falla de Mercado Pago.
 *   card_error        — todo lo demás: rechazo del banco, datos mal cargados.
 */
export function tipoDeErrorDePago({ mensaje = '', paymentMethodId = null } = {}) {
  const texto = String(mensaje ?? '')
  const metodo = String(paymentMethodId ?? '').toLowerCase()
  if (/tarjeta de cr[eé]dito/i.test(texto) || metodo.startsWith('deb') || metodo === 'account_money') {
    return 'debit_not_allowed'
  }
  if (/internal_error|timeout|failed to fetch|network|\b5\d\d\b|no respondi/i.test(texto)) return 'server_error'
  return 'card_error'
}

const CLAVE_PURCHASE = 'hl_purchase_enviado'

function leerEnviados() {
  try {
    const crudo = window.localStorage.getItem(CLAVE_PURCHASE)
    const lista = JSON.parse(crudo || '[]')
    return Array.isArray(lista) ? lista : []
  } catch {
    return []
  }
}

/**
 * `purchase` sale una sola vez por consulta, aunque la pantalla se rehidrate
 * después de un refresh o el pago se autorice por el reintento. Devuelve `true`
 * si es la primera vez (y la marca); `false` si ya se había mandado.
 *
 * `memoria` es un Set de respaldo para cuando el navegador no deja escribir en
 * localStorage (modo privado): dentro de la misma pantalla igual no duplica.
 */
export function marcarPurchase(consultationId, memoria) {
  if (!consultationId) return false
  if (memoria?.has(consultationId)) return false
  const enviados = leerEnviados()
  if (enviados.includes(consultationId)) { memoria?.add(consultationId); return false }
  memoria?.add(consultationId)
  try {
    // Las últimas 50 alcanzan: el pedido vivo se rehidrata sólo por media hora.
    window.localStorage.setItem(CLAVE_PURCHASE, JSON.stringify([...enviados, consultationId].slice(-50)))
  } catch { /* sin storage: queda la memoria */ }
  return true
}
