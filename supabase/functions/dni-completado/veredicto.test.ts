// Control: sólo una matrícula declarada y habilitada mantiene la verificación
// al completar el DNI; todo lo demás va a revisión (migración 225).
//   deno test supabase/functions/dni-completado/
import { assertEquals } from 'jsr:@std/assert@1'
import { veredictoDni } from './veredicto.ts'
import { evaluarRefeps, codigoRefeps, normalizarMatricula } from '../_shared/refeps.ts'

const EXT = 'http://fhir.msal.gob.ar/StructureDefinition/'
const practitioner = (matricula: string, habilitada: boolean, active = true) => ({
  active,
  qualification: [{
    identifier: [{ value: matricula }],
    extension: [{ url: EXT + 'MatriculaHabilitada', valueBoolean: habilitada }],
  }],
})

Deno.test('coincide sólo con la matrícula declarada habilitada', () => {
  assertEquals(veredictoDni(evaluarRefeps(practitioner('MN 82854', true), '082854').estado, '82854').resultado, 'coincide')
})

Deno.test('todo lo demás va a revisión', () => {
  assertEquals(veredictoDni(evaluarRefeps(practitioner('82854', false), '82854').estado, '82854').resultado, 'no_coincide')
  assertEquals(veredictoDni(evaluarRefeps(practitioner('82854', true, false), '82854').estado, '82854').resultado, 'no_coincide')
  assertEquals(veredictoDni(evaluarRefeps(practitioner('11111', true), '82854').estado, '82854').resultado, 'no_coincide')
  assertEquals(veredictoDni(evaluarRefeps(null, '82854').estado, '82854').resultado, 'no_coincide')
  assertEquals(veredictoDni(evaluarRefeps(practitioner('82854', true), null).estado, null).resultado, 'no_coincide')
})

Deno.test('mismo código y normalizado que sisa-verify', () => {
  assertEquals(codigoRefeps('30.123.456'), '541030123456')
  assertEquals(codigoRefeps('1234567'), '541001234567')
  assertEquals(normalizarMatricula('MP 14.613'), '14613')
})
