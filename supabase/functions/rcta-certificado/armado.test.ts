// Control de "lo arreglado no vuelve" para los certificados: falla si el armado
// del payload de Otras Prescripciones deja de cumplir lo que pide la wiki
// (docs/innovamed-wiki-2026-11-02/2099773441.txt) o si el diagnóstico vuelve a
// viajar con el interruptor apagado.
//
//   deno test supabase/functions/rcta-certificado/      (o npm run test:certificados)
import { assert, assertEquals, assertMatch } from 'jsr:@std/assert@1'
import {
  armarPayloadCertificado, problemasDelPayload, validarCertificado, domicilioDe,
  provinciaMatricula, textoDelCertificado, type Certificado,
} from './armado.ts'

const FIRMA = 'iVBORw0KGgo' + 'A'.repeat(200)
const paciente = { first_name: 'Paciente', last_name: 'Demo', dni: '30.123.456', gender: 'femenino', birth_date: '1990-03-15', phone: null }
const profesional = { first_name: 'Laura', last_name: 'Gómez', dni: '28456789', gender: 'femenino', birth_date: '1981-06-09' }
const legajo = { specialty: 'medicina_general', license_type: 'MN', license_number: '112233', address: 'Coronel Ramón Lorenzo Falcón 1500, Flores, Buenos Aires, Ciudad Autónoma de Buenos Aires' }

const armar = (c: Certificado, extra: Record<string, unknown> = {}) => armarPayloadCertificado({
  clienteAppId: 597, certificado: c, patient: paciente, professional: profesional, legajo,
  especialidadLabel: 'Medicina General', firmabase64: FIRMA, ...extra,
})

const REPOSO: Certificado = { tipo: 'reposo', dias: 3, desde: '2026-11-02', indicaciones: 'Evitar esfuerzos físicos' }
const CONSTANCIA: Certificado = { tipo: 'constancia', atencionAt: '2026-11-02T17:30:00Z' }

Deno.test('reposo: cumple los obligatorios de la wiki', () => {
  const p = armar(REPOSO)
  assertEquals(problemasDelPayload(p), [])
  assertEquals(p.clienteAppId, 597)
  assertEquals(p.prescripcion[0].prescripcion, 'Certificado de reposo laboral')
  assertEquals(p.prescripcion[0].observaciones,
    'Se indica a Paciente Demo, DNI 30123456, reposo por 3 (tres) días, del 02/11/2026 al 04/11/2026 inclusive.')
  assertEquals(p.indicaciones, 'Evitar esfuerzos físicos')
  assertEquals(p.paciente.nroDoc, '30123456')
  assertEquals(p.paciente.sexo, 'F')
  assertEquals(p.medico.especialidad, 'Medicina General') // legible, nunca el slug
  assertEquals(p.medico.matricula, { tipo: 'MN', numero: '112233', provincia: '', profesion: 'Médico', especialidad: 'Medicina General' })
  assert(!String(p.medico.firmabase64).startsWith('data:'))
})

Deno.test('constancia: fecha y hora en hora argentina, sin segunda hoja', () => {
  const p = armar(CONSTANCIA)
  assertEquals(problemasDelPayload(p), [])
  assertEquals(p.prescripcion[0].prescripcion, 'Constancia de atención médica')
  assertMatch(p.prescripcion[0].observaciones, /el 02\/11\/2026 a las 14:30 h\.$/)
  assertEquals('indicaciones' in p, false)
})

Deno.test('diagnóstico: con el interruptor apagado NO viaja (con N igual se imprimía)', () => {
  const p = armar({ ...REPOSO, cie10Code: 'J06.9', cie10Display: 'Infección aguda de las vías respiratorias superiores', imprimirDiagnostico: false })
  assertEquals(p.diagnostico, undefined)
  assertEquals('diagnostico' in JSON.parse(JSON.stringify(p)), false)
  assertEquals(p.imprimirDiagnostico, 'N')
  assertEquals(JSON.stringify(p).includes('J06.9'), false)
})

Deno.test('diagnóstico: prendido viaja el código con S', () => {
  const p = armar({ ...REPOSO, cie10Code: 'J06.9', imprimirDiagnostico: true })
  assertEquals(p.diagnostico, 'J06.9')
  assertEquals(p.imprimirDiagnostico, 'S')
  assertEquals(problemasDelPayload(p), [])
})

Deno.test('reposo de 1 día y que cruza de mes', () => {
  assertMatch(textoDelCertificado({ tipo: 'reposo', dias: 1, desde: '2026-11-02' }, 'A B', '1').cuerpo, /1 \(un\) día, el 02\/11\/2026\.$/)
  assertMatch(textoDelCertificado({ tipo: 'reposo', dias: 3, desde: '2026-11-30' }, 'A B', '1').cuerpo, /del 30\/11\/2026 al 02\/12\/2026/)
})

Deno.test('validación de lo que manda el profesional', () => {
  assertEquals(validarCertificado(REPOSO), null)
  assertEquals(validarCertificado(CONSTANCIA), null)
  assert(validarCertificado({ tipo: 'reposo', dias: 0, desde: '2026-11-02' }))
  assert(validarCertificado({ tipo: 'reposo', dias: 31, desde: '2026-11-02' }))
  assert(validarCertificado({ tipo: 'reposo', dias: 2, desde: '' }))
  assert(validarCertificado({ tipo: 'constancia', atencionAt: null }))
  assert(validarCertificado({ ...REPOSO, imprimirDiagnostico: true }))
  // deno-lint-ignore no-explicit-any
  assert(validarCertificado({ tipo: 'apto' as any }))
})

Deno.test('falta de datos se detecta antes de llamar', () => {
  const sinDni = armarPayloadCertificado({ clienteAppId: 597, certificado: REPOSO, patient: { ...paciente, dni: null, gender: null },
    professional: profesional, legajo, especialidadLabel: 'Medicina General', firmabase64: FIRMA })
  const probs = problemasDelPayload(sinDni)
  assert(probs.includes('paciente.nroDoc'))
  assertEquals(sinDni.paciente.sexo, 'X') // sin sexo cargado va X, que la API acepta
  const sinMatricula = armar(REPOSO, { legajo: { ...legajo, license_number: null } })
  assert(problemasDelPayload(sinMatricula).includes('medico.matricula.numero'))
  const sinDireccion = armar(REPOSO, { legajo: { ...legajo, address: null } })
  assert(problemasDelPayload(sinDireccion).includes('lugarAtencion.domicilio'))
  assert(problemasDelPayload({ ...armar(REPOSO), clienteAppId: '597' }).includes('clienteAppId'))
  assert(problemasDelPayload({ ...armar(REPOSO), prescripcion: [{ prescripcion: ' ' }] }).includes('prescripcion[0].prescripcion'))
  assert(problemasDelPayload({ ...armar(REPOSO), imprimirDiagnostico: 'X' }).includes('imprimirDiagnostico'))
})

Deno.test('matrícula provincial lleva provincia', () => {
  const p = armar(REPOSO, { legajo: { ...legajo, license_type: 'MP' } })
  assertEquals(p.medico.matricula.provincia, 'Ciudad Autonoma de Bs As')
  assertEquals(problemasDelPayload(p), [])
  const sinProv = armar(REPOSO, { legajo: { ...legajo, license_type: 'MP', address: 'Calle Falsa 123' } })
  assert(problemasDelPayload(sinProv).includes('medico.matricula.provincia'))
  assertEquals(provinciaMatricula('Bv. Oroño 500, Rosario, Santa Fe'), 'Santa Fe')
})

Deno.test('domicilio: las formas en que se guarda la dirección', () => {
  assertEquals(domicilioDe('Av. Santa Fe 1900, Recoleta, Buenos Aires'), { calle: 'Av. Santa Fe', numero: '1900', direccion: 'Av. Santa Fe 1900, Recoleta, Buenos Aires' })
  assertEquals(domicilioDe('3709, Arenales, Palermo, CABA')?.calle, 'Arenales')
  assertEquals(domicilioDe('3709, Arenales, Palermo, CABA')?.numero, '3709')
  assertEquals(domicilioDe('IFER, 2259, Gorriti, Palermo')?.calle, 'Gorriti')
  // Sin altura: sólo `direccion`, nunca una calle sin número.
  assertEquals(domicilioDe('Hospital Italiano, Almagro'), { direccion: 'Hospital Italiano, Almagro' })
  assertEquals(domicilioDe(''), null)
  assertEquals(problemasDelPayload(armar(REPOSO, { legajo: { ...legajo, address: 'Hospital Italiano, Almagro' } })), [])
})
