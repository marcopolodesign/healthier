// Shared formatters for super-admin pages (Payments, Emergencias).
// Do NOT duplicate these locally — import from here.

export function formatARS(amount) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(amount || 0)
}

export function formatDate(dateStr) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/**
 * Texto para "cuántos días tarda en liberarse la plata" (B3), a partir de lo
 * que devuelve `paymentsService.getSettlementPlazo`. Un solo lugar para que
 * la Configuración del profesional y el drawer del super admin digan
 * exactamente lo mismo.
 */
export function formatSettlementPlazo({ count, lastDays, minDays, maxDays } = {}) {
  if (!count) return null
  if (minDays === maxDays) return `${lastDays} día${lastDays === 1 ? '' : 's'}`
  return `${minDays} a ${maxDays} días (último cobro: ${lastDays})`
}
