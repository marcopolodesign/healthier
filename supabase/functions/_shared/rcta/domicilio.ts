// ── El domicilio de la atención (`lugarAtencion.domicilio`) ───────────────────
// Generar Receta, sub-objeto Domicilio: si se manda algo, va `calle` (2 a 50)
// + `numero` (1 a 6), o `direccion` sola (3 a 150). Si no, QBI240 ("DEBE
// INGRESAR CALLE Y NÚMERO O BIEN COMPLETAR EL CAMPO DIRECCIÓN") o QBI241
// ("DATOS DE DOMICILIO INSUFICIENTES").
//
// La dirección del consultorio se guarda como un solo texto y llega en tres
// formas: la de Google/a mano ("Av. Santa Fe 1900, Palermo") y las dos de
// Nominatim ("3709, Arenales, Palermo…" y "IFER, 2259, Marcelo T. de Alvear,
// Barrio Norte…"). El `parseAddress` viejo cortaba por la primera coma y
// mandaba calle "3709" sin número, o calle "IFER".
//
// 🔴 El criterio de "tiene calle y número" es EL MISMO que
// `direccionTieneNumero()` (src/lib/geo.js) y `direccion_con_numero()`
// (migraciones 220/221): `calleYNumero(d) !== null` ⇔ `direccionTieneNumero(d)`.
// `scripts/test-rcta-armado.mjs` lo compara sobre las mismas direcciones.
// ─────────────────────────────────────────────────────────────────────────────

const ALTURA_SOLA = /^\d{1,5}\s?[A-Za-z]?$/
// `p.` no lleva `\b` después (el punto no es palabra: "p. 3" no se recortaba
// y el piso salía como altura — revisión 2026-11-02).
const UNIDAD = /\s*\b(?:piso|p\.|dto\.?|depto\.?|departamento|of\.?|oficina|local)(?=[\s\d]|$).*$/i
// Números que son parte del NOMBRE de la calle, no la altura. Los mismos tres
// recortes que `direccionTieneNumero`.
const NOMBRES_CON_NUMERO = [
  /^(?:calle|cl\.?)?\s*\d{1,4}\s*[-–—]\s*/i,                                                      // "Calle 99 - Zárate"
  /\b(?:calle|cl\.?|ruta|rn|rp|camino|diagonal|diag\.?|autopista|pasaje|pje\.?)\s*n?[°º.]?\s*\d{1,3}\b/gi, // "Ruta 8"
  /\b\d{1,2}(?:ro|°|º)?\s+de\s+\p{L}+/giu,                                                         // "9 de Julio"
]
const CP_AR = /^(?:[A-Z]\d{4}[A-Z]{3}|CP\.?\s*\d{4}|\d{4})$/i
const PAIS = /^(?:argentina|república argentina|republica argentina|ar)$/i

const limpiar = (s: string) => s.replace(/\s+/g, ' ').trim()

export type CalleYNumero = { calle: string; numero: string; resto: string[] }

/**
 * La calle y la altura de una dirección, o `null` si no tiene altura (mismo
 * criterio que `direccionTieneNumero`). `resto` son los tramos que siguen
 * (barrio, localidad…), sin tocar.
 */
export function calleYNumero(direccion: string | null | undefined): CalleYNumero | null {
  const texto = String(direccion ?? '')
  const segs = texto.split(',').map(limpiar)

  // Nominatim con lugar con nombre: "<lugar>, <altura>, <calle>, …".
  if (segs.length >= 3 && /\p{L}{2}/u.test(segs[0]) && ALTURA_SOLA.test(segs[1]) && /\p{L}{3}/u.test(segs[2])) {
    return { calle: segs[2], numero: segs[1].replace(/\s/g, ''), resto: segs.slice(3) }
  }

  const primero = segs[0]
  if (!primero) return null

  // Nominatim con la altura primero: "<altura>, <calle>, …".
  if (ALTURA_SOLA.test(primero) && texto.includes(',')) {
    return /\p{L}{3}/u.test(segs[1] ?? '')
      ? { calle: segs[1], numero: primero.replace(/\s/g, ''), resto: segs.slice(2) }
      : null
  }

  // "<calle> <altura> [piso / depto…]". Se tapan los números que son nombre
  // (mismo largo, para que las posiciones sigan valiendo) y la altura es el
  // último número que queda.
  if (!/\p{L}{2}/u.test(primero)) return null
  const sinUnidad = primero.replace(UNIDAD, '')
  let tapado = sinUnidad
  for (const re of NOMBRES_CON_NUMERO) tapado = tapado.replace(re, m => '#'.repeat(m.length))
  const alturas = [...tapado.matchAll(/\d+(?:\s?[A-Za-z](?![A-Za-z]))?/g)]
  const ultima = alturas[alturas.length - 1]
  if (!ultima || ultima.index === undefined) return null
  const calle = limpiar(sinUnidad.slice(0, ultima.index).replace(/[\s,.-]+$/, ''))
  const numero = ultima[0].replace(/\s/g, '')
  const despues = limpiar(sinUnidad.slice(ultima.index + ultima[0].length))
  return { calle, numero, resto: [...(despues ? [despues] : []), ...segs.slice(1)] }
}

export type Domicilio =
  | { calle: string; numero: string; localidad?: string }
  | { direccion: string }

/**
 * El `domicilio` para `lugarAtencion` (o `paciente`). `null` si no hay
 * dirección utilizable: menos de 3 caracteres no lo acepta ni como texto libre.
 *
 * Con calle y número reales dentro de los largos del contrato: `{ calle,
 * numero, localidad? }`. Si no, `{ direccion }` sola, recortada a 150 — nunca
 * una calle sin número ni un número inventado.
 */
export function domicilioDe(direccion: string | null | undefined): Domicilio | null {
  const dir = limpiar(String(direccion ?? ''))
  if (dir.length < 3) return null
  const cn = calleYNumero(dir)
  if (cn && cn.calle.length >= 2 && cn.calle.length <= 50 && cn.numero.length >= 1 && cn.numero.length <= 6) {
    const localidad = cn.resto.find(z => z && /\p{L}{2}/u.test(z) && !CP_AR.test(z) && !PAIS.test(z))
    return { calle: cn.calle, numero: cn.numero, ...(localidad ? { localidad: localidad.slice(0, 200) } : {}) }
  }
  return { direccion: dir.slice(0, 150) }
}
