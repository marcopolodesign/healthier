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
  receta_archivada: 'Receta archivada',
}
