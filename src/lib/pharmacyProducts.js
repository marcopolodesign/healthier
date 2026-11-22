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

// ── Nombre legible del producto (Felipe, 2026-11-22) ─────────────────────────
// El catálogo de la droguería viene "Sulocten 5 Mg Comp X 60", "Dioxis Cr X
// 5 G", "Alprazolam Micr.0.5Mg Compx30". Al paciente se le muestra
// "Sulocten 5 mg · 60 comp.", "Dioxis crema · 5 g". Sólo para mostrar: la
// búsqueda y lo que se guarda siguen usando `name`. Espejo en
// mobile/src/lib/farmaciaGrupos.ts → nombreLegible.
const FORMAS = {
  comp: 'comp.', cmp: 'comp.', cm: 'comp.', caps: 'cáps.', cap: 'cáps.', cr: 'crema', gts: 'gotas',
  susp: 'susp.', sol: 'solución', rec: 'rec.', subl: 'subl.', emuls: 'emulsión', ser: 'sérum',
  oft: 'oftálmica', bland: 'blandas', mast: 'mast.', 'f-a': 'frasco ampolla',
}
const UNIDADES = { mg: 'mg', g: 'g', ml: 'ml', cc: 'cc', ui: 'UI' }
const FRASES = [
  [/\bCont Oj\b/i, 'contorno de ojos'], [/\bRost\/Cue\b/i, 'rostro y cuello'], [/\bAgua Micel\.?/i, 'agua micelar'],
  [/\bFps\s*(\d+)/i, 'FPS $1'], [/\bHa\b/, 'HA'], [/\bAp Fte\b/i, 'AP Forte'], [/\bAp\b/, 'AP'], [/\bP\/Neb\b/i, 'para nebulizar'],
  [/\bMicro?\.\s*/i, ''], [/\bC\/Color\b/i, 'con color'], [/\bLips Cristal\b/i, 'Lips cristal'], [/\bRepelente Insecto\b/i, 'repelente de insectos'],
]

export function nombreLegible(nombre) {
  let s = String(nombre ?? '').trim()
  if (!s) return s
  s = s
    .replace(/(\d)([A-Za-z])/g, '$1 $2')          // "50Mg" → "50 Mg", "X45G" → "X45 G"
    // "Compx30", "Cmx 30", "Serx28" → "Comp x30" — sólo formas conocidas: "Cracox 90" es una marca.
    .replace(/\b(Comp|Cm|Mast|Ser|Cristal|Rec|Subl|Color|Caps)x\s*(\d)/gi, '$1 x$2')
    .replace(/\bx\s*(\d)/gi, '× $1')              // separador de cantidad
    .replace(/([A-Za-z])\.(\d)/g, '$1. $2')       // "Micel.200" → "Micel. 200", "Micr.0.5" → "Micr. 0.5"
  for (const [de, a] of FRASES) s = s.replace(de, a)
  const palabras = s.split(/\s+/).map((w, i) => {
    const k = w.toLowerCase().replace(/[.,]$/, '')
    if (i > 0 && UNIDADES[k]) return UNIDADES[k]
    if (i > 0 && FORMAS[k]) return FORMAS[k]
    return w
  })
  s = palabras.join(' ')
  // "comp. × 60" → "× 60 comp.": la cantidad va antes de la forma.
  s = s.replace(/((?:(?:comp\.|cáps\.|rec\.|subl\.|blandas|mast\.)\s*)+)×\s*(\d+)/g, (_, forma, n) => `× ${n} ${forma.trim()}`)
  return s.replace(/\s*×\s*/g, ' · ').replace(/\s{2,}/g, ' ').trim()
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
