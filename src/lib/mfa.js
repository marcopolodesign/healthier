/**
 * mfa.js — segundo factor (TOTP) para el rol `super_admin` del panel web.
 *
 * Lo pide el manual de seguridad del convenio con el RENAPER. Decisión de Mateo
 * (2026-10-28): que exista y funcione, pero que hoy no se muestre — no hay link
 * en el menú (se entra por `/super-admin/seguridad`) y a nadie se le exige.
 *
 *   - Quien YA dio de alta un factor TOTP verificado: después de la contraseña
 *     se le piden los 6 dígitos (aal1 → aal2) antes de entrar al panel.
 *   - Exigirlo a todos los super admins (bloquear el panel si no tienen factor)
 *     queda detrás de `VITE_MFA_SUPERADMIN_OBLIGATORIO=true`. Apagado por defecto.
 *
 * Esto es la puerta del lado del cliente. El corte del lado de la base (que una
 * sesión aal1 de un super admin no pueda operar) NO está hecho: ver
 * docs/mfa-superadmin.md.
 */

/** Flag: ¿se le exige el factor a todo super admin? Apagado salvo que valga exactamente "true". */
export const MFA_SUPERADMIN_OBLIGATORIO =
  String(import.meta.env?.VITE_MFA_SUPERADMIN_OBLIGATORIO ?? '').trim().toLowerCase() === 'true'

/** Ruta de alta del factor. Sin link en el menú a propósito. */
export const RUTA_SEGURIDAD = '/super-admin/seguridad'

export const PASO_MFA = {
  NINGUNO: 'ninguno',     // entra normal
  VERIFICAR: 'verificar', // tiene factor y su sesión es aal1: pedir los 6 dígitos
  ENROLAR: 'enrolar',     // flag prendido y no tiene factor: sólo puede ir a /super-admin/seguridad
}

/**
 * Qué paso le toca a una sesión. Pura (sin Supabase) para poder probarla.
 *
 * @param {object} p
 * @param {string}  p.role          rol del perfil
 * @param {string}  p.currentLevel  'aal1' | 'aal2' — nivel de la sesión actual
 * @param {boolean} p.tieneFactor   ¿tiene un factor TOTP VERIFICADO?
 * @param {boolean} p.obligatorio   el flag VITE_MFA_SUPERADMIN_OBLIGATORIO
 */
export function decidirPasoMfa({ role, currentLevel, tieneFactor, obligatorio = false }) {
  if (role !== 'super_admin') return PASO_MFA.NINGUNO
  if (tieneFactor) return currentLevel === 'aal2' ? PASO_MFA.NINGUNO : PASO_MFA.VERIFICAR
  return obligatorio ? PASO_MFA.ENROLAR : PASO_MFA.NINGUNO
}

/** Evento de window que avisa al guard que cambió el factor (alta o baja) y hay que re-evaluar. */
export const EVENTO_MFA_CAMBIO = 'healthier:mfa-cambio'

/** Sólo dígitos, máximo 6 (pega con espacios o guiones sin romperse). */
export function limpiarCodigo(valor) {
  return String(valor ?? '').replace(/\D/g, '').slice(0, 6)
}

/**
 * Id de la SESIÓN (claim `session_id` del JWT de Supabase), no de la persona.
 * Cada login crea una sesión nueva con su propio id; el refresh del token y el
 * paso aal1 → aal2 de la misma sesión lo conservan. Sin token o sin claim → null.
 */
export function sesionIdDeToken(accessToken) {
  try {
    const payload = String(accessToken ?? '').split('.')[1]
    if (!payload) return null
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    return JSON.parse(json).session_id ?? null
  } catch {
    return null
  }
}

/**
 * Clave con la que `MfaGuard` guarda el resultado de la evaluación: cuenta +
 * sesión. Un login nuevo de la misma cuenta (re-login sin cerrar sesión, o un
 * SIGNED_IN que viene de otra pestaña) es OTRA clave, así que nunca hereda el
 * resultado de la sesión anterior. `null` = no hay nada que evaluar todavía.
 */
export function claveDeEvaluacion(userId, sesionId) {
  return userId && sesionId ? `${userId}:${sesionId}` : null
}

/** El resultado guardado sólo vale si es de la MISMA clave de ahora; si no, hay que re-evaluar. */
export function resultadoVigente(resultado, clave) {
  return clave && resultado?.clave === clave ? resultado : null
}
