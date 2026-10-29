// Reglas de la contraseña nueva. Un solo lugar: lo usa NuevaContrasenaForm
// ("olvidé mi contraseña", recuperar cuenta, y /super-admin/perfil). El mínimo
// es el de Supabase Auth (`password_min_length` = 6 en staging y producción).
export const MIN_CONTRASENA = 6

/** Devuelve el mensaje de error para mostrar, o '' si la contraseña sirve. */
export function validarContrasena(password, repetir) {
  if ((password || '').length < MIN_CONTRASENA) return `La contraseña tiene que tener al menos ${MIN_CONTRASENA} caracteres.`
  if (password !== repetir) return 'Las dos contraseñas no coinciden.'
  return ''
}
