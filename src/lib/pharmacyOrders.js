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
