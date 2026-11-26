// Shared vocabulary for medication_orders.status across the pharmacy panel,
// order detail, and super-admin visibility pages.

export const STATUS_LABEL = {
  pendiente: 'Pendiente',
  en_preparacion: 'En preparación',
  enviado: 'Enviado',
  entregado: 'Entregado',
  cancelado: 'Cancelado',
}

export const NEXT_STATUS = {
  pendiente: 'en_preparacion',
  en_preparacion: 'enviado',
  enviado: 'entregado',
}

/** El orden en que avanza un pedido. `cancelado` queda afuera: no es un paso. */
export const STATUS_FLOW = ['pendiente', 'en_preparacion', 'enviado', 'entregado']

/**
 * Lo que ve el paciente en el seguimiento. No son los mismos rótulos que los
 * del panel: "Pendiente" no le dice nada a quien está esperando su pedido.
 */
export const STATUS_PATIENT_LABEL = {
  pendiente: 'Pedido confirmado',
  en_preparacion: 'La farmacia lo está preparando',
  enviado: 'En camino',
  entregado: 'Entregado',
  cancelado: 'Cancelado',
}

export const STATUS_PATIENT_HINT = {
  pendiente: 'La farmacia ya lo recibió y lo va a preparar.',
  en_preparacion: 'Están armando tu pedido.',
  enviado: 'Salió para tu dirección de entrega.',
  entregado: 'Llegó a destino.',
  cancelado: 'La farmacia canceló este pedido.',
}

/**
 * Cómo se muestra el estado de pago de un pedido.
 *
 * 'exento' se agregó el 2026-09-17 (migración 165): el pedido se despacha pero
 * no se cobró. Se muestra distinto de "Pagado" a propósito — quien concilia la
 * plata tiene que poder distinguirlos de un vistazo.
 */
export const PAYMENT_LABEL = {
  autorizado: 'Reservado',
  pagado:    'Pagado',
  exento:    'Bonificado',
  no_pagado: 'No pagado',
}

export const PAYMENT_CLASS = {
  autorizado: 'bg-amber-50 text-amber-700',
  pagado:    'bg-emerald-50 text-emerald-600',
  exento:    'bg-violet-50 text-violet-600',
  no_pagado: 'bg-gray-100 text-gray-500',
}

export const etiquetaDePago = (estado) => PAYMENT_LABEL[estado] ?? 'No pagado'
export const claseDePago = (estado) => PAYMENT_CLASS[estado] ?? PAYMENT_CLASS.no_pagado

/**
 * En qué anda la receta de un pedido "Solicitar receta" / "Ya tengo receta"
 * (migración 254). `null` = pedido común (no pasó por ese camino).
 *
 *   esperando_medico   → reservado; un médico de Healthier tiene que hacer la receta
 *   farmacia_revisando → reservado; la farmacia tiene que aprobar la receta subida
 *   cobrado            → la receta quedó resuelta y se cobró
 *   liberado           → no correspondía (o venció): se liberó la reserva
 *
 * Lo decide sólo con lo que escribió el servidor; el front no mueve nada.
 */
export function faseDeReceta(order) {
  if (!order) return null
  const items = order.items ?? []
  const conVia = items.some(it => it.recetaVia)
  if (!conVia && !order.recetaEstado && order.paymentStatus !== 'autorizado') return null
  if (order.status === 'cancelado' && order.recetaEstado === 'rechazada') return 'liberado'
  if (order.paymentStatus === 'autorizado') {
    const faltaMedico = items.some(it => it.recetaVia === 'solicitar')
    return faltaMedico ? 'esperando_medico' : 'farmacia_revisando'
  }
  if (order.paymentStatus === 'pagado' && order.recetaEstado === 'resuelta') return 'cobrado'
  return null
}

/** Rótulo corto para el panel de la farmacia y el del super admin. */
export const FASE_RECETA_LABEL = {
  esperando_medico: 'Esperando receta del médico',
  farmacia_revisando: 'Receta subida: revisar',
  cobrado: 'Receta resuelta',
  liberado: 'Liberado, no se cobró',
}

export const FASE_RECETA_CLASS = {
  esperando_medico: 'bg-receta-nivel text-brand-tertiary-hover',
  farmacia_revisando: 'bg-amber-50 text-amber-700',
  cobrado: 'bg-emerald-50 text-emerald-600',
  liberado: 'bg-gray-100 text-gray-500',
}

/** Rótulo y ayuda para el paciente (Inicio, lista de pedidos), con la receta en cuenta. */
export function estadoParaPaciente(order) {
  const fase = faseDeReceta(order)
  if (fase === 'esperando_medico') return { label: 'Esperando tu receta', hint: 'Reservado, no cobrado: un médico te va a llamar.' }
  if (fase === 'farmacia_revisando') return { label: 'La farmacia revisa tu receta', hint: 'Reservado, no cobrado.' }
  if (fase === 'liberado') return { label: 'No se te cobró nada', hint: 'Se liberó la reserva de tu tarjeta.' }
  return { label: STATUS_PATIENT_LABEL[order?.status], hint: STATUS_PATIENT_HINT[order?.status] }
}
