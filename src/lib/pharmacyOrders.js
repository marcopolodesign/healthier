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
