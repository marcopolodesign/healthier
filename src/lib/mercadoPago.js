/**
 * Restricciones de monto de Mercado Pago — una sola fuente de verdad.
 *
 * MP publica un mínimo por medio de pago en
 * `GET /v1/payment_methods` (campo `min_allowed_amount`). Hoy, en Argentina:
 *
 *   visa · master · amex · maestro · débitos …… 3
 *   naranja · cabal · diners · argencard ……… 15
 *
 * No es decorativo: por debajo de ese mínimo MP se comporta como si la tarjeta
 * no existiera. Lo primero que se rompe es el formulario, antes de cualquier
 * cobro — el Card Payment Brick pide las cuotas
 * (`/v1/payment_methods/installments?bin=…&amount=…`), recibe `[]` y corta con
 * `{cause: 'missing_payment_information', message: 'empty_installments'}`: no
 * emite token y marca los campos en rojo como si el paciente se hubiera
 * equivocado al tipear.
 *
 * Por eso el turno presencial funcionaba y la consulta on-demand no: no había
 * ninguna diferencia de código entre las dos pantallas, sólo de número. El
 * presencial cobra el precio del profesional ($1.000, $8.500, $9.000) y la
 * on-demand cobraba `vertical_settings.ondemand_price`, que estaba en $1 para
 * probar. Agregar tarjeta desde el Perfil estaba roto siempre, con cualquier
 * precio, porque mandaba un monto fijo de 1 (ahí no se cobra nada y el monto
 * es sólo un requisito formal del Brick).
 *
 * El piso propio es 100 y no 15: deja margen si MP mueve sus mínimos, cubre de
 * una todos los medios de pago, y queda muy por debajo de cualquier precio real
 * de consulta, así que en producción no se activa nunca.
 */
export const MP_MONTO_MINIMO_ARS = 100

/** Formatea el mínimo para mensajes de UI: "$100". */
export const mpMontoMinimoTexto = () =>
  `$${MP_MONTO_MINIMO_ARS.toLocaleString('es-AR')}`
