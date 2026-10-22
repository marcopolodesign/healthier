// Vocabulario compartido de pharmacy_products.prescription_type (migración 129).
//
// Los rótulos del panel/Excel y los que ve el paciente NO son los mismos a
// propósito: el catálogo interno habla de "venta libre", pero el paciente que
// filtra está buscando "sin receta". Un solo diccionario para los dos lados
// haría que cambiar el copy del catálogo le cambie el filtro al paciente.

export const PRESCRIPTION_TYPES = ['venta_libre', 'receta', 'receta_archivada']

/** Panel de la farmacia, importación/exportación de Excel. */
export const PRESCRIPTION_TYPE_LABELS = {
  venta_libre: 'Venta libre',
  receta: 'Receta',
  receta_archivada: 'Receta archivada',
}

/** Lo que ve el paciente en los filtros y en la tarjeta del producto. */
export const PRESCRIPTION_TYPE_PATIENT_LABELS = {
  venta_libre: 'Sin receta',
  receta: 'Con receta',
  // Para el paciente "receta archivada" no dice nada: es un controlado
  // (psicotrópicos, antimicrobianos) — cada compra lleva una receta nueva.
  receta_archivada: 'Controlado',
}

/** Necesita receta, con el default de la columna para los productos viejos. */
export const necesitaReceta = (product) => (product?.prescriptionType ?? 'venta_libre') !== 'venta_libre'

/**
 * El servidor rechazó el producto por falta de receta (migración 214): HR001
 * al agregarlo, HR002 al pagar, o el `code` de `mp-payment`. Ante esto se abre
 * la hoja "Necesitás receta", no un toast.
 */
export function esRecetaRequerida(err) {
  return err?.code === 'HR001' || err?.code === 'HR002' || err?.code === 'RECETA_REQUERIDA' || err?.hint === 'receta_requerida'
}
