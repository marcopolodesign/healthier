/**
 * Provincias de una matrícula provincial (MP), con el valor EXACTO que acepta
 * el servicio de recetas (wiki de Generar Receta, "Listado de provincias para
 * matrícula"). Sin la provincia una MP no emite (QBI65). Migración 223.
 *
 * 🔴 Espejo de `supabase/functions/_shared/rcta/provincias.ts`.
 * `npm run test:rcta-armado` falla si se despegan.
 */
export const PROVINCIAS_MATRICULA = [
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

/** "Cordoba" → "Córdoba". '' si no es de la lista. */
export const etiquetaProvincia = v => PROVINCIAS_MATRICULA.find(p => p.value === v)?.label ?? ''

/** ¿A esta matrícula le falta la provincia? Sólo una MP la necesita. */
export const faltaProvinciaMatricula = (licenseType, licenseProvince) =>
  licenseType === 'MP' && !PROVINCIAS_MATRICULA.some(p => p.value === licenseProvince)
