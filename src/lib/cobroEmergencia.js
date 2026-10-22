/**
 * Qué pasó con la plata de una emergencia, en una palabra (historial del
 * despacho; Felipe pidió definir cada chapa en una línea). Mismo criterio en
 * la app (`mobile/src/lib/cobroEmergencia.ts`).
 *
 * `e` trae `bonificada`, `cierreSinPago`, `status`, `paidAt` y `pagos` (las
 * filas de `payments` de la emergencia).
 */
export const COBRO = {
  cobrada:    { label: 'Cobrada',           ayuda: 'Se cobró lo reservado en la tarjeta del paciente.' },
  bonificada: { label: 'Bonificada',        ayuda: 'No se le cobra al paciente: la emergencia está bonificada.' },
  sin_cobro:  { label: 'Sin cobro',         ayuda: 'Se cerró sin cobrar: no había nada reservado en la tarjeta.' },
  reservada:  { label: 'Reserva sin cobrar', ayuda: 'Terminó, pero lo reservado en la tarjeta no se cobró (vence sola).' },
  liberada:   { label: 'Reserva liberada',  ayuda: 'Se canceló y se le devolvió al paciente lo reservado.' },
  sin_pago:   { label: 'Sin pago',          ayuda: 'Se canceló antes de que el paciente pagara.' },
}

export function cobroDe(e) {
  const pagos = Array.isArray(e?.pagos) ? e.pagos : e?.pagos ? [e.pagos] : []
  if (pagos.some(p => p.status === 'approved')) return 'cobrada'
  if (e?.bonificada) return 'bonificada'
  if (e?.cierreSinPago) return 'sin_cobro'
  if (pagos.some(p => p.status === 'authorized')) return 'reservada'
  if (pagos.some(p => p.status === 'cancelled')) return 'liberada'
  return e?.status === 'completed' ? 'sin_cobro' : 'sin_pago'
}

/**
 * Pedido → cierre (o cancelación), en minutos. Sin hora de cierre no se
 * inventa una: `updatedAt` cambia con cualquier escritura posterior.
 */
export function duracionMin(e) {
  const fin = e?.completedAt ?? e?.cancelledAt
  if (!e?.createdAt || !fin) return null
  return Math.max(0, Math.round((new Date(fin) - new Date(e.createdAt)) / 60000))
}

export function formatDuracion(min) {
  if (min == null) return '—'
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60), m = min % 60
  return m ? `${h} h ${m} min` : `${h} h`
}

export const DESENLACE = { en_el_lugar: 'Atendido en el lugar', traslado: 'Trasladado' }
