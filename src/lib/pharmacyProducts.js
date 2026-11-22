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

// ── El mosaico de la farmacia del paciente (rediseño 2026-11-22) ─────────────
// Dos clases de grupo, con foto cada uno: las categorías de siempre
// (`category`) y las necesidades (`necesidad`, migración 246). Un producto
// puede estar en los dos: "Sindolito" está en Clínica Y en Dolor y fiebre.
// Las fotos viven en el bucket `pharmacy-products/categorias/` de cada base
// (las sube scripts/farmacia-necesidades.mjs). Mismo vocabulario en
// mobile/src/lib/farmaciaGrupos.ts.

const fotoGrupo = (clave, sufijo = '') =>
  `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/pharmacy-products/categorias/${clave}${sufijo}.jpg`

export const NECESIDADES = [
  { id: 'dolor', label: 'Dolor y fiebre' },
  { id: 'resfrio', label: 'Resfrío y alergia' },
  { id: 'piel', label: 'Piel y sol' },
  { id: 'presion', label: 'Presión y glucemia' },
  { id: 'digestion', label: 'Digestión' },
  { id: 'antibioticos', label: 'Antibióticos' },
]

export const CATEGORIAS = [
  { id: 'clinica', label: 'Clínica' },
  { id: 'pediatria', label: 'Pediatría' },
  { id: 'nutricion', label: 'Nutrición' },
  { id: 'bienestar', label: 'Bienestar' },
]

export const NECESIDAD_LABELS = Object.fromEntries(NECESIDADES.map(n => [n.id, n.label]))
export const CATEGORY_LABELS = Object.fromEntries(CATEGORIAS.map(c => [c.id, c.label]))

/**
 * Los grupos del mosaico con sus productos: primero las necesidades, después
 * las categorías. Un grupo sin productos no se muestra (Mateo, 2026-11-22).
 */
export function gruposDelMosaico(productos) {
  const armar = (lista, campo) => lista.map(g => ({
    ...g,
    campo,
    foto: fotoGrupo(g.id),               // 1200×1500, arriba de la página del grupo
    fotoAncha: fotoGrupo(g.id, '-ancha'), // 1600×640, la misma en pantalla ancha
    fotoChica: fotoGrupo(g.id, '-640'),  // 640×800, la tarjeta del mosaico
    productos: productos.filter(p => p[campo] === g.id),
  })).filter(g => g.productos.length > 0)
  return [...armar(NECESIDADES, 'necesidad'), ...armar(CATEGORIAS, 'category')]
}
