/**
 * "Bonificar" de Teleclínica — la regla del front.
 *
 * Para la cuenta que ve el interruptor (`puedeBonificarTeleclinica`), MANDA EL
 * INTERRUPTOR: arranca prendido si el perfil ya es exento (`payment_exempt`) y,
 * si lo apaga, la consulta se cobra. Antes la pantalla decía "Consulta
 * bonificada" con el interruptor apagado porque el perfil exento ganaba igual
 * (2026-10-13). Para cualquier otra cuenta decide sólo `payment_exempt`.
 *
 * El servidor aplica la misma regla en `supabase/functions/_shared/bonificar.ts`
 * con los campos que arma `camposBonificar`. Control: `node scripts/test-bonificar.mjs`.
 */

/** Cómo arranca el interruptor: prendido si la cuenta ya es exenta. */
export function bonificarPorDefecto(paymentExempt) {
  return paymentExempt === true
}

/** ¿Esta consulta va bonificada? Lo que muestra la pantalla. */
export function teleclinicaBonificada({ paymentExempt, puedeBonificar, bonificar }) {
  return puedeBonificar ? bonificar === true : paymentExempt === true
}

/** Lo que viaja en `pedir` para que el servidor decida lo mismo que la pantalla. */
export function camposBonificar({ puedeBonificar, bonificar }) {
  if (!puedeBonificar) return { bonificar: false }
  return { bonificar: bonificar === true, cobrar: bonificar !== true }
}

/**
 * "Bonificar" del S.O.S. (Mateo, 2026-10-22): para la cuenta del interruptor
 * arranca PRENDIDO (lo pidió así) y, si lo apaga, se reserva en la tarjeta
 * como siempre. Para cualquier otra cuenta no hay bonificación: el perfil
 * exento no cambia nada en el S.O.S. Mismo criterio en el servidor
 * (`emergenciaBonificadaEnServidor`), con el payload de `camposBonificar`.
 */
export const SOS_BONIFICAR_POR_DEFECTO = true

/** ¿Este S.O.S. va bonificado? Lo que muestra la pantalla. */
export function sosBonificada({ puedeBonificar, bonificar }) {
  return puedeBonificar === true && bonificar === true
}
