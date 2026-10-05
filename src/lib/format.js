// Shared formatters for super-admin pages (Payments, Emergencias).
// Do NOT duplicate these locally — import from here.

export function formatARS(amount) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(amount || 0)
}

export function formatDate(dateStr) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/**
 * Texto para "cuántos días tarda en liberarse la plata" (B3), a partir de lo
 * que devuelve `paymentsService.getSettlementPlazo`. Un solo lugar para que
 * la Configuración del profesional y el drawer del super admin digan
 * exactamente lo mismo.
 */
export function formatSettlementPlazo({ count, lastDays, minDays, maxDays } = {}) {
  if (!count) return null
  if (minDays === maxDays) return `${lastDays} día${lastDays === 1 ? '' : 's'}`
  return `${minDays} a ${maxDays} días (último cobro: ${lastDays})`
}

/**
 * Nombres de estudios y medicamentos de los catálogos de Innovamed, que llegan
 * en cualquier casing ("hemograma completo", "HEMOGRAMA COMPLETO CON
 * PLAQUETAS"). Se normalizan a oración con mayúscula por palabra, dejando en
 * minúscula los conectores — es sólo presentación: lo que se guarda es lo que
 * devuelve el catálogo, para no divergir del código SNOMED/regNo asociado.
 */
const CONECTORES = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'con', 'sin', 'y', 'o', 'u', 'en', 'a', 'al', 'por', 'para'])
export function capitalizarNombreCatalogo(nombre) {
  if (!nombre) return nombre
  return nombre
    .toLocaleLowerCase('es-AR')
    .split(' ')
    .map((w, i) => {
      if (i > 0 && CONECTORES.has(w)) return w
      // La primera letra "de verdad" puede venir detrás de un paréntesis.
      const j = w.search(/[a-záéíóúüñ]/)
      if (j === -1) return w
      return w.slice(0, j) + w[j].toLocaleUpperCase('es-AR') + w.slice(j + 1)
    })
    .join(' ')
}

/**
 * El nombre de pila, salteando el título profesional.
 *
 * En la base TODOS los profesionales se guardan con el título adelante
 * ("Dra. Valentina Ortega", "Lic. Camila Duarte"), así que un
 * `fullName.split(' ')[0]` saluda con **"Hola, Dra."** y **"Hola, Lic."**.
 * Pasaba en el website y en la app, y lo ve cada profesional cada vez que entra.
 *
 * Espejado en `mobile/src/lib/format.ts`.
 */
const TITULOS = new Set(['dr', 'dra', 'lic', 'licda', 'mg', 'mgtr', 'prof', 'ing', 'od', 'klgo', 'klga', 'tec'])

export function nombreDePila(fullName, fallback = 'Profesional') {
  const partes = String(fullName ?? '').trim().split(/\s+/).filter(Boolean)
  const sinTitulo = partes.filter((p, i) => !(i === 0 && TITULOS.has(p.toLowerCase().replace(/\.$/, ''))))
  return sinTitulo[0] || partes[0] || fallback
}

/**
 * La inicial (o las iniciales) de una persona, salteando el título.
 *
 * Sin esto, "Dra. Valentina Ortega" queda como **D** en el avatar y "Lic. Camila
 * Duarte" como **L**: todos los profesionales terminan con la misma letra.
 */
export function inicialesDe(fullName, cantidad = 1) {
  const partes = String(fullName ?? '').trim().split(/\s+/).filter(Boolean)
  const sinTitulo = partes.filter((p, i) => !(i === 0 && TITULOS.has(p.toLowerCase().replace(/\.$/, ''))))
  const usar = (sinTitulo.length ? sinTitulo : partes).slice(0, cantidad)
  return usar.map(p => p.charAt(0).toUpperCase()).join('') || '?'
}
