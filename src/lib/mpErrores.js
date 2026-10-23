/**
 * Mensajes del retorno del OAuth de Mercado Pago (`?mp_error=<código>`), que
 * mandan mp-connect (al inicio del profesional) y pharmacy-mp-connect (a la
 * Configuración de la farmacia). Un solo mapa para los dos.
 */
const MP_ERROR_MESSAGES = {
  token_exchange: 'No pudimos completar la conexión con Mercado Pago. Probá de nuevo en unos minutos.',
  db_save: 'La autorización salió bien pero no pudimos guardarla. Probá conectar de nuevo.',
  invalid_state: 'No pudimos validar la conexión por seguridad. Iniciá el proceso de nuevo desde este botón.',
  state_expired: 'La autorización de Mercado Pago venció. Volvé a tocar Conectar.',
  // Un link viejo (pestaña abierta de antes del cambio del 2026-10-23) llegó sin sesión.
  reintentar: 'Actualizamos cómo se conecta Mercado Pago. Volvé a tocar Conectar.',
}

export const mensajeErrorMp = (codigo) =>
  MP_ERROR_MESSAGES[codigo] ?? 'No pudimos conectar Mercado Pago. Probá de nuevo.'
