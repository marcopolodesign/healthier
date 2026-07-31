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

/**
 * Monto que se le pasa al Brick cuando SÓLO se tokeniza y no se cobra nada
 * (Perfil → agregar tarjeta). Es el mismo valor que usa BIGG Eye, la otra
 * integración nuestra con este mismo Brick, que viene funcionando hace meses:
 * a igualdad de todo lo demás, conviene no inventar un número propio.
 */
export const MP_MONTO_TOKENIZACION_ARS = 1000

/** Formatea el mínimo para mensajes de UI: "$100". */
export const mpMontoMinimoTexto = () =>
  `$${MP_MONTO_MINIMO_ARS.toLocaleString('es-AR')}`

/**
 * Por qué un pago no salió, en castellano y con qué hacer al respecto.
 *
 * Mercado Pago devuelve el motivo real en `status_detail`, y hasta acá lo
 * tirábamos: el paciente veía siempre "No pudimos autorizar el pago. Probá con
 * otra tarjeta", que además a veces es un consejo equivocado — con
 * `cc_rejected_call_for_authorize` hay que llamar al banco, y con
 * `cc_rejected_bad_filled_security_code` alcanza con corregir tres dígitos. Un
 * mensaje genérico obliga al paciente a adivinar, y lo más probable es que
 * abandone.
 *
 * `accion` es lo que puede hacer ahora; `reintentable` dice si tiene sentido
 * ofrecerle probar de nuevo con la misma tarjeta.
 */
const MOTIVOS_MP = {
  // — Datos mal cargados: se corrigen en el mismo formulario —
  cc_rejected_bad_filled_card_number:   { motivo: 'El número de tarjeta no es correcto.', accion: 'Revisalo y volvé a intentar.', reintentable: true },
  cc_rejected_bad_filled_date:          { motivo: 'La fecha de vencimiento no es correcta.', accion: 'Revisala y volvé a intentar.', reintentable: true },
  cc_rejected_bad_filled_security_code: { motivo: 'El código de seguridad no es correcto.', accion: 'Revisá los números del dorso y volvé a intentar.', reintentable: true },
  cc_rejected_bad_filled_other:         { motivo: 'Alguno de los datos de la tarjeta no es correcto.', accion: 'Revisalos y volvé a intentar.', reintentable: true },

  // — El banco o MP dicen que no: reintentar con la misma tarjeta no cambia nada —
  cc_rejected_high_risk:            { motivo: 'Mercado Pago rechazó el pago por seguridad.', accion: 'Probá con otra tarjeta, o pagá con esta desde la app de Mercado Pago.', reintentable: false },
  cc_rejected_blacklist:            { motivo: 'Mercado Pago rechazó el pago por seguridad.', accion: 'Probá con otra tarjeta.', reintentable: false },
  cc_rejected_insufficient_amount:  { motivo: 'La tarjeta no tiene fondos suficientes.', accion: 'Probá con otra tarjeta.', reintentable: false },
  cc_rejected_card_disabled:        { motivo: 'La tarjeta está inactiva.', accion: 'Llamá al banco para activarla, o probá con otra tarjeta.', reintentable: false },
  cc_rejected_call_for_authorize:   { motivo: 'Tu banco necesita autorizar este pago.', accion: 'Llamá al número que figura al dorso de la tarjeta y autorizalo; después volvé a intentar.', reintentable: true },
  cc_rejected_max_attempts:         { motivo: 'Se alcanzó el límite de intentos con esta tarjeta.', accion: 'Esperá un rato o probá con otra tarjeta.', reintentable: false },
  cc_rejected_duplicated_payment:   { motivo: 'Ya hiciste un pago igual hace instantes.', accion: 'Si el anterior no se acreditó, esperá unos minutos antes de reintentar.', reintentable: false },
  cc_rejected_invalid_installments: { motivo: 'La tarjeta no admite esta cantidad de cuotas.', accion: 'Probá con otra tarjeta.', reintentable: false },
  cc_rejected_card_error:           { motivo: 'No pudimos procesar la tarjeta.', accion: 'Volvé a intentar en unos minutos o probá con otra.', reintentable: true },
  cc_rejected_other_reason:         { motivo: 'El banco rechazó el pago.', accion: 'Probá con otra tarjeta.', reintentable: false },

  // — Ni sí ni no: MP todavía está decidiendo —
  pending_review_manual: { motivo: 'Mercado Pago está revisando el pago.', accion: 'Puede tardar hasta 2 días hábiles. Para empezar la consulta ahora, probá con otra tarjeta.', reintentable: false, enRevision: true },
  pending_contingency:   { motivo: 'Mercado Pago está procesando el pago.', accion: 'Esperá unos minutos y volvé a intentar.', reintentable: true, enRevision: true },
  pending_challenge:     { motivo: 'Mercado Pago necesita que confirmes el pago.', accion: 'Revisá tu app de Mercado Pago o el mail que te mandaron.', reintentable: true, enRevision: true },
}

const MOTIVO_DESCONOCIDO = {
  motivo: 'El pago no se pudo autorizar.',
  accion: 'Probá con otra tarjeta.',
  reintentable: false,
}

/**
 * Traduce la respuesta de un pago a algo que se le pueda mostrar al paciente.
 *
 * Devuelve siempre un objeto usable — un `status_detail` que MP agregue mañana
 * y nosotros no conozcamos cae en el genérico en vez de dejar la pantalla muda,
 * que es justamente lo que hay que evitar.
 */
export function explicarPagoMP({ status, statusDetail } = {}) {
  const conocido = statusDetail ? MOTIVOS_MP[statusDetail] : null
  const base = conocido ?? MOTIVO_DESCONOCIDO
  return {
    ...base,
    enRevision: base.enRevision ?? (status === 'pending' || status === 'in_process'),
    // Se muestra chico junto al mensaje: es lo que hace falta si el paciente
    // termina hablando con soporte de MP o con nosotros.
    codigo: statusDetail || status || null,
  }
}
