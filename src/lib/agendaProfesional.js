/**
 * Qué ve el profesional en su agenda, su historial y sus ganancias.
 *
 * Funciones puras, sin React ni Supabase, para que el control automático
 * (`scripts/verificar-agenda-profesional.mjs`) pruebe exactamente lo mismo que
 * pinta la pantalla. La app mobile tiene el espejo en
 * `src/lib/agendaProfesional.ts`: si cambia una, cambia la otra.
 *
 * Una consulta inmediata aceptada (migración 191) nace con `scheduled_at = now()`
 * y `is_on_demand = true`: para la agenda es una consulta más, de hoy, desde el
 * segundo en que se acepta y también después de terminada.
 */

const mismoDia = (iso, ahora) =>
  !!iso && new Date(iso).toDateString() === ahora.toDateString()

/** Todo lo de HOY, en cualquier estado: una consulta terminada sigue en la agenda de su día. */
export function agendaDelDia(consultas, ahora = new Date()) {
  return (consultas ?? [])
    .filter(c => mismoDia(c.scheduledAt, ahora))
    .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt))
}

/** Historial: lo cerrado, o lo que ya pasó. Una inmediata terminada entra por `completed`. */
export function enHistorial(c, ahora = new Date()) {
  const pasada = c.scheduledAt && new Date(c.scheduledAt) < ahora
  // 'expired' y 'no_show' los escribe el cron una vez vencida la fecha.
  const terminal = ['completed', 'cancelled', 'expired', 'no_show'].includes(c.status)
  return !!(terminal || pasada)
}

/** Bonificada = el paciente no paga (`payment_status = 'exempt'`, migración 135). */
export const esBonificada = c => c?.paymentStatus === 'exempt'

/** Lo que se muestra donde iría el precio: `null` si es bonificada (se escribe "Bonificada"). */
export const montoVisible = c => (esBonificada(c) ? null : c?.priceAtBooking ?? null)

/** Una bonificada no suma plata a las ganancias. */
export const sumarGanancias = consultas =>
  (consultas ?? []).reduce((suma, c) => suma + (esBonificada(c) ? 0 : Number(c.priceAtBooking || 0)), 0)
