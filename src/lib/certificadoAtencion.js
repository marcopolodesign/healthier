// Espejo de `consultaNoCertificable` (supabase/functions/rcta-certificado/armado.ts):
// un certificado dice que hubo atención. El corte real lo hace la función; acá
// sólo se avisa antes de armar el certificado. `npm run test:certificados`
// compara las dos copias caso por caso.

const ESTADOS_ATENDIDA = ['in_progress', 'closing', 'pending_pro_close', 'completed']

/** null si se puede certificar; si no, `{ error, code }` (mismo texto que la función). */
export function consultaNoCertificable(c, ahoraMs) {
  if (c.status === 'cancelled') return { error: 'La consulta está cancelada.', code: 'CERT_CONSULTA_CANCELADA' }
  if (c.status === 'no_show' || c.status === 'expired') {
    return { error: 'La consulta no se llegó a hacer: no se puede emitir un certificado.', code: 'CERT_CONSULTA_NO_REALIZADA' }
  }
  // Una 'confirmed' cuenta desde la hora del turno (Mateo, 2026-11-02).
  if (c.started_at || ESTADOS_ATENDIDA.includes(c.status)) return null
  if (c.status === 'confirmed' && c.scheduled_at && Date.parse(c.scheduled_at) <= ahoraMs) return null
  return { error: 'La consulta todavía no empezó: el certificado se emite desde la hora del turno.', code: 'CERT_CONSULTA_FUTURA' }
}
