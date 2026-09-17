// Gemelo de `mobile/src/lib/fechaNacimiento.ts` — misma validación en los dos
// clientes. La base guarda `date` (ISO `AAAA-MM-DD`) y la persona escribe
// `DD/MM/AAAA`.
//
// Se valida a mano en vez de confiar en `new Date(texto)`: el parser de JS se
// traga "31/02/2020" y devuelve el 2 de marzo, así que una fecha imposible se
// guardaría corrida sin que nadie se entere. Y esta fecha viaja a la receta
// electrónica.

/** `AAAA-MM-DD` → `DD/MM/AAAA`. '' si no hay nada o no se entiende. */
export function isoADdmmaaaa(iso) {
  if (!iso || typeof iso !== 'string') return ''
  const m = iso.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ''
}

/**
 * `DD/MM/AAAA` → `AAAA-MM-DD`.
 *  - '' (vacío)     → `null` ("borrá el dato")
 *  - texto inválido → `undefined` ("no guardes nada y avisá")
 */
export function ddmmaaaaAIso(texto) {
  const t = (texto ?? '').trim()
  if (!t) return null
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!m) return undefined
  const dia = Number(m[1]), mes = Number(m[2]), anio = Number(m[3])
  if (mes < 1 || mes > 12 || dia < 1) return undefined
  const ultimo = new Date(Date.UTC(anio, mes, 0)).getUTCDate()
  if (dia > ultimo) return undefined
  if (new Date(Date.UTC(anio, mes - 1, dia)).getTime() > Date.now()) return undefined
  if (anio < 1900) return undefined
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
}
