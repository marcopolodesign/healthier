// Cruce entre lo que devuelve el padrón (rnos + razón social) y el catálogo de
// financiadores de recetas (id + nombre comercial, sin rnos).
//
// Orden:
//   1. Puente explícito `cobertura_rnos` (rnos → nombre del catálogo).
//   2. Nombre igual, ignorando acentos, puntos y "OBRA SOCIAL".
//   3. Sigla: lo que viene entre paréntesis en el padrón ("O.S.P. SANTA FE
//      (IAPOSS)") o las iniciales de la razón social, contra el nombre del
//      catálogo sin espacios. Sólo se acepta si hay UN candidato: con dos, se
//      deja elegir al paciente antes que adivinar.
// Sin match se devuelve el nombre del padrón igual, para mostrárselo.

export type Financiador = { id: number; nombre: string }
export type Cobertura = { rnos: string; cobertura: string }
export type Sugerencia = {
  rnos: string
  coberturaNombre: string
  financiadorId: number | null
  financiadorNombre: string | null
}

const STOP = new Set(['DE', 'DEL', 'LA', 'LAS', 'LOS', 'EL', 'Y', 'E', 'PARA', 'A'])

export function normalizar(s: string): string {
  return s
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[.()\-–/,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const compacto = (s: string) => normalizar(s).replace(/\s/g, '')

function sinObraSocial(s: string) {
  return normalizar(s).replace(/^(OBRA SOCIAL|O S P|O S)\s+/, '').trim()
}

function siglas(razon: string): string[] {
  const out = new Set<string>()
  for (const m of razon.matchAll(/\(([^)]+)\)/g)) {
    for (const parte of normalizar(m[1]).split(' ')) if (parte.length >= 3) out.add(parte)
  }
  const palabras = normalizar(razon.replace(/\([^)]*\)/g, '')).split(' ').filter(Boolean)
  if (palabras.length >= 3) {
    out.add(palabras.map(p => p[0]).join(''))
    out.add(palabras.filter(p => !STOP.has(p)).map(p => p[0]).join(''))
  }
  return [...out].filter(s => s.length >= 3)
}

export function matchear(c: Cobertura, catalogo: Financiador[], puente: { rnos: string; nombre_catalogo: string }[]): Financiador | null {
  const p = puente.find(x => x.rnos === c.rnos)
  if (p) {
    const f = catalogo.find(x => normalizar(x.nombre) === normalizar(p.nombre_catalogo))
    if (f) return f
  }

  const razon = sinObraSocial(c.cobertura)
  const exactos = catalogo.filter(x => sinObraSocial(x.nombre) === razon || normalizar(x.nombre) === normalizar(c.cobertura))
  if (exactos.length === 1) return exactos[0]

  const sig = new Set(siglas(c.cobertura))
  const porSigla = catalogo.filter(x => sig.has(compacto(x.nombre)))
  if (porSigla.length === 1) return porSigla[0]

  return null
}

/** De varias coberturas, sugiere la primera que matchea; si ninguna, la primera. */
export function elegirSugerencia(
  coberturas: Cobertura[],
  catalogo: Financiador[],
  puente: { rnos: string; nombre_catalogo: string }[],
): { sugerencia: Sugerencia | null; todas: Sugerencia[] } {
  const todas: Sugerencia[] = coberturas.map(c => {
    const f = matchear(c, catalogo, puente)
    return { rnos: c.rnos, coberturaNombre: c.cobertura, financiadorId: f?.id ?? null, financiadorNombre: f?.nombre ?? null }
  })
  const sugerencia = todas.find(t => t.financiadorId) ?? todas[0] ?? null
  return { sugerencia, todas }
}
