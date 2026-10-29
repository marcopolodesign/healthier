// Los mensajes de GoTrue vienen en inglés. Se traducen los que la persona
// puede resolver; el resto se muestra tal cual — nunca un error mudo.
//
// `contexto`:
//   · 'recuperacion' (por defecto) — se llegó desde el link de un mail: si la
//     sesión no existe, lo que hay que hacer es pedir otro mail.
//   · 'panel' — la persona está logueada en el panel (cambiar la contraseña
//     propia): si la sesión venció, lo que hay que hacer es volver a entrar.
export function traducirErrorDeAuth(error, { contexto = 'recuperacion' } = {}) {
  const code = error?.code || ''
  const msg = error?.message || 'Error desconocido'
  if (code === 'over_email_send_rate_limit' || /rate limit|only request this after/i.test(msg)) {
    return 'Pediste demasiados mails en poco tiempo. Esperá unos minutos y probá de nuevo.'
  }
  if (code === 'same_password') return 'La contraseña nueva tiene que ser distinta de la anterior.'
  if (code === 'weak_password') return 'La contraseña es muy débil. Usá al menos 6 caracteres.'
  if (code === 'session_not_found' || /auth session missing/i.test(msg)) {
    return contexto === 'panel'
      ? 'Tu sesión venció. Volvé a entrar e intentá de nuevo.'
      : 'Tu sesión para cambiar la contraseña venció. Pedí otro mail.'
  }
  if (code === 'reauthentication_needed' || /reauthentication/i.test(msg)) {
    return 'Por seguridad hace falta que vuelvas a iniciar sesión. Cerrá sesión, entrá de nuevo e intentá otra vez.'
  }
  if (code === 'insufficient_aal' || /aal2/i.test(msg)) {
    return 'Para cambiar la contraseña hace falta el código de tu app de códigos. Cerrá sesión, entrá de nuevo con el código e intentá otra vez.'
  }
  return msg
}
