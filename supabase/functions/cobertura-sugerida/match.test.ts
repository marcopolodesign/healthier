// deno test supabase/functions/cobertura-sugerida/match.test.ts
import { assertEquals } from 'jsr:@std/assert@1'
import { elegirSugerencia, matchear } from './match.ts'

const catalogo = [
  { id: 28, nombre: 'OSDE' }, { id: 290, nombre: 'OSDEL' }, { id: 500, nombre: 'PAMI' },
  { id: 77, nombre: 'IAPOS' }, { id: 9, nombre: 'LUIS PASTEUR' }, { id: 12, nombre: 'OSECAC' },
  { id: 13, nombre: 'OBRA SOCIAL DE ACTORES' },
]
const puente = [{ rnos: '614081', nombre_catalogo: 'OSDE' }, { rnos: '500807', nombre_catalogo: 'PAMI' }]

Deno.test('puente explícito: OSDE por rnos', () => {
  assertEquals(matchear({ rnos: '614081', cobertura: 'OBRA SOCIAL DE EJECUTIVOS Y DEL PERSONAL DE DIRECCION DE EMPRESAS' }, catalogo, puente)?.id, 28)
})

Deno.test('sigla entre paréntesis', () => {
  // IAPOSS no está, pero el catálogo tiene IAPOS: no adivina.
  assertEquals(matchear({ rnos: 'x', cobertura: 'O.S.P. SANTA FE (IAPOSS)' }, catalogo, [])?.id, undefined)
  assertEquals(matchear({ rnos: 'x', cobertura: 'O.S.P. SANTA FE (IAPOS)' }, catalogo, [])?.id, 77)
})

Deno.test('nombre igual sin "OBRA SOCIAL"', () => {
  assertEquals(matchear({ rnos: 'x', cobertura: 'OBRA SOCIAL DE ACTORES' }, catalogo, [])?.id, 13)
})

Deno.test('sin match devuelve el nombre del padrón, sin id', () => {
  const r = elegirSugerencia([{ rnos: '1', cobertura: 'O.S. INEXISTENTE' }], catalogo, [])
  assertEquals(r.sugerencia, { rnos: '1', coberturaNombre: 'O.S. INEXISTENTE', financiadorId: null, financiadorNombre: null })
})

Deno.test('varias: sugiere la primera que matchea', () => {
  const r = elegirSugerencia([{ rnos: '1', cobertura: 'O.S. INEXISTENTE' }, { rnos: '500807', cobertura: 'INSTITUTO NACIONAL…' }], catalogo, puente)
  assertEquals(r.sugerencia?.financiadorId, 500)
  assertEquals(r.todas.length, 2)
})

Deno.test('puente que apunta a un nombre que no está en el catálogo del ambiente: no rompe', () => {
  assertEquals(matchear({ rnos: '614081', cobertura: 'OBRA SOCIAL DE EJECUTIVOS' }, [{ id: 1, nombre: 'OTRA' }], puente), null)
})
