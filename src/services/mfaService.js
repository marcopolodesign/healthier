import { supabase } from '../lib/supabase'
import { EVENTO_MFA_CAMBIO } from '../lib/mfa'

/**
 * Segundo factor (TOTP) con Supabase Auth MFA nativo. Ver `lib/mfa.js`.
 * Todos los errores salen con el `message` real de Supabase (regla: nunca un
 * "algo salió mal" genérico).
 */

function avisarCambio() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENTO_MFA_CAMBIO))
}

// Supabase contesta en inglés; el caso de todos los días (código mal tipeado o
// vencido) va en castellano. Cualquier otro error sale tal cual, con su mensaje real.
function fallar(error) {
  if (/invalid totp code/i.test(error.message ?? '')) {
    throw new Error('Código incorrecto o vencido. Probá con el que muestra tu app ahora.')
  }
  throw new Error(error.message || 'Error de verificación en dos pasos')
}

export const mfaService = {
  /**
   * Estado actual: nivel de la sesión + factores TOTP.
   * `listFactors().totp` trae sólo los VERIFICADOS; `.all` incluye los que
   * quedaron a medio dar de alta.
   */
  async estado() {
    const [{ data: aal, error: aalError }, { data: factores, error: factoresError }] = await Promise.all([
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      supabase.auth.mfa.listFactors(),
    ])
    if (aalError) fallar(aalError)
    if (factoresError) fallar(factoresError)
    const verificados = factores?.totp ?? []
    const sinVerificar = (factores?.all ?? []).filter(f => f.factor_type === 'totp' && f.status !== 'verified')
    return {
      currentLevel: aal?.currentLevel ?? 'aal1',
      nextLevel: aal?.nextLevel ?? 'aal1',
      verificados,
      sinVerificar,
      tieneFactor: verificados.length > 0,
    }
  },

  /**
   * Empieza el alta: devuelve el QR (data URI SVG), el secreto y el id del factor.
   * Limpia antes los factores que quedaron sin verificar (un intento anterior
   * abandonado) — con uno de esos vivos, `enroll` falla por nombre repetido.
   */
  async iniciarAlta() {
    const { data: factores, error: listError } = await supabase.auth.mfa.listFactors()
    if (listError) fallar(listError)
    for (const f of (factores?.all ?? [])) {
      if (f.factor_type === 'totp' && f.status !== 'verified') {
        const { error } = await supabase.auth.mfa.unenroll({ factorId: f.id })
        if (error) fallar(error)
      }
    }
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      issuer: 'Healthier',
      friendlyName: `Healthier ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
    })
    if (error) fallar(error)
    return { factorId: data.id, qr: data.totp.qr_code, secreto: data.totp.secret, uri: data.totp.uri }
  },

  /** Confirma el alta con el primer código. Deja la sesión en aal2. */
  async confirmarAlta(factorId, codigo) {
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: codigo })
    if (error) fallar(error)
    avisarCambio()
  },

  /** Cancela un alta a medio hacer (cierra el QR sin confirmar). */
  async cancelarAlta(factorId) {
    const { error } = await supabase.auth.mfa.unenroll({ factorId })
    if (error) fallar(error)
  },

  /** Login: pide el código del primer factor verificado. aal1 → aal2. */
  async verificar(codigo) {
    const { data: factores, error: listError } = await supabase.auth.mfa.listFactors()
    if (listError) fallar(listError)
    const factor = factores?.totp?.[0]
    if (!factor) throw new Error('No hay un factor de verificación activo en esta cuenta.')
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: codigo })
    if (error) fallar(error)
  },

  /** Da de baja un factor verificado. Supabase exige que la sesión ya sea aal2. */
  async darDeBaja(factorId) {
    const { error } = await supabase.auth.mfa.unenroll({ factorId })
    if (error) fallar(error)
    avisarCambio()
  },
}
