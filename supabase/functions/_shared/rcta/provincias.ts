// ── Provincias de la matrícula (lista "Provincias" de Generar Receta) ─────────
// Fuente: website/docs/innovamed-wiki-2026-11-02/2086174790.txt, apartado
// "Listado de provincias para matrícula". Los valores van TAL CUAL los acepta
// el servicio de recetas: sin tildes ("Cordoba"), "Ciudad Autonoma de Bs As",
// "La rioja" con minúscula. La etiqueta es lo que ve la persona.
//
// Quedan afuera a propósito "Sin especificar" y "Nacional": esta lista es para
// una matrícula PROVINCIAL (MP), que el servicio rechaza sin provincia (QBI65).
// "Bs As ó Buenos Aires" es un solo valor en la wiki: se usa "Buenos Aires".
//
// 🔴 Espejo exacto de `src/lib/provinciasMatricula.js` (el front no importa
// TypeScript de las funciones). `scripts/test-rcta-armado.mjs` falla si se
// despegan, o si algún valor deja de estar en la wiki.
// ─────────────────────────────────────────────────────────────────────────────

export const PROVINCIAS_MATRICULA: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'Buenos Aires', label: 'Buenos Aires' },
  { value: 'Catamarca', label: 'Catamarca' },
  { value: 'Chaco', label: 'Chaco' },
  { value: 'Chubut', label: 'Chubut' },
  { value: 'Ciudad Autonoma de Bs As', label: 'Ciudad Autónoma de Buenos Aires' },
  { value: 'Cordoba', label: 'Córdoba' },
  { value: 'Corrientes', label: 'Corrientes' },
  { value: 'Entre Rios', label: 'Entre Ríos' },
  { value: 'Formosa', label: 'Formosa' },
  { value: 'Jujuy', label: 'Jujuy' },
  { value: 'La Pampa', label: 'La Pampa' },
  { value: 'La rioja', label: 'La Rioja' },
  { value: 'Mendoza', label: 'Mendoza' },
  { value: 'Misiones', label: 'Misiones' },
  { value: 'Neuquen', label: 'Neuquén' },
  { value: 'Rio Negro', label: 'Río Negro' },
  { value: 'Salta', label: 'Salta' },
  { value: 'San Juan', label: 'San Juan' },
  { value: 'San Luis', label: 'San Luis' },
  { value: 'Santa Cruz', label: 'Santa Cruz' },
  { value: 'Santa Fe', label: 'Santa Fe' },
  { value: 'Santiago del Estero', label: 'Santiago del Estero' },
  { value: 'Tierra del Fuego', label: 'Tierra del Fuego' },
  { value: 'Tucuman', label: 'Tucumán' },
]

const VALORES = new Set(PROVINCIAS_MATRICULA.map(p => p.value))

/** ¿Es uno de los valores que acepta el servicio para una MP? */
export function esProvinciaMatricula(valor: unknown): boolean {
  return typeof valor === 'string' && VALORES.has(valor)
}
