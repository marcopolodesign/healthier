// ── Dirección ─────────────────────────────────────────────────────────────────
// Llegan dos formatos: el que escribe el profesional ("Av. Santa Fe 1234,
// Recoleta, CABA") y el de Nominatim ("1900, Avenida Santa Fe, Barrio Norte,
// Recoleta, …, C1123AAN, Argentina").
export type Dir = { calle: string; altura: string | null; cp: string | null; provincia: string | null; original: string }

export function parsearDireccion(s: string): Dir | null {
  const original = s.trim()
  if (!original) return null
  const partes = original.split(',').map(x => x.trim()).filter(Boolean)
  const caba = /\b(caba|c\.a\.b\.a|capital federal|ciudad aut[oó]noma de buenos aires)\b/i.test(original)
  const provincia = caba ? 'Ciudad Autónoma de Buenos Aires' : null

  let calle = '', altura: string | null = null
  if (/^\d+$/.test(partes[0] ?? '') && partes[1]) { altura = partes[0]; calle = partes[1] }
  else {
    const m = (partes[0] ?? '').match(/^(.*?)\s+(\d{1,5})\b/)
    if (m) { calle = m[1]; altura = m[2] } else calle = partes[0] ?? ''
  }
  // Código postal: primero el CPA ("C1042AAN"); si no, un número suelto de 4
  // cifras que no sea la altura ni esté en la parte de la calle.
  const cp = original.match(/\b[A-Z](\d{4})[A-Z]{3}\b/i)?.[1]
    ?? partes.slice(altura && /^\d+$/.test(partes[0]) ? 2 : 1)
        .map(x => x.match(/^(?:CP\s*)?(\d{4})$/i)?.[1]).find(Boolean)
    ?? null
  return { calle, altura, cp, provincia, original }
}

