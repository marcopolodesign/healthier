// Control de "lo arreglado no vuelve" para los certificados: falla si el armado
// del payload de Otras Prescripciones deja de cumplir lo que pide la wiki
// (docs/innovamed-wiki-2026-11-02/2099773441.txt) o si el diagnóstico vuelve a
// viajar con el interruptor apagado.
//
//   deno test supabase/functions/rcta-certificado/      (o npm run test:certificados)
import { assert, assertEquals, assertMatch } from 'jsr:@std/assert@1'
import {
  armarPayloadCertificado, problemasDelPayload, validarCertificado, textoDelCertificado, vistaPrevia,
  consultaNoCertificable, nombreDelProblema, decidirRecuperacion, type Certificado,
} from './armado.ts'

const FIRMA = 'iVBORw0KGgo' + 'A'.repeat(200)
const paciente = { first_name: 'Paciente', last_name: 'Demo', dni: '30.123.456', gender: 'femenino', birth_date: '1990-03-15', phone: null }
const profesional = { first_name: 'Laura', last_name: 'Gómez', dni: '28456789', gender: 'femenino', birth_date: '1981-06-09' }
const legajo = { specialty: 'medicina_general', license_type: 'MN', license_number: '112233', license_province: null, address: 'Coronel Ramón Lorenzo Falcón 1500, Flores, Buenos Aires, Ciudad Autónoma de Buenos Aires' }

const armar = (c: Certificado, extra: Record<string, unknown> = {}) => armarPayloadCertificado({
  clienteAppId: 597, certificado: c, patient: paciente, professional: profesional, legajo,
  especialidadLabel: 'Medicina General', firmabase64: FIRMA, ...extra,
})

const ATENCION = '2026-11-02T17:30:00Z'
const REPOSO: Certificado = { tipo: 'reposo', atencionAt: ATENCION, dias: 3, desde: '2026-11-02', indicaciones: 'Evitar esfuerzos físicos' }
const ESCOLAR: Certificado = { tipo: 'escolar', atencionAt: ATENCION, dias: 2, desde: '2026-11-03', indicaciones: 'Reincorporarse con alta' }
const CONSTANCIA: Certificado = { tipo: 'constancia', atencionAt: ATENCION, indicaciones: 'Control en 7 días' }

Deno.test('reposo: cumple los obligatorios de la wiki', () => {
  const p = armar(REPOSO)
  assertEquals(problemasDelPayload(p), [])
  assertEquals(p.clienteAppId, 597)
  assertEquals(p.prescripcion[0].prescripcion, 'Certificado de reposo laboral')
  assertEquals(p.prescripcion[0].observaciones,
    'Se indica reposo por 3 (tres) días, del 02/11/2026 al 04/11/2026 inclusive.')
  assertEquals(p.indicaciones, 'Evitar esfuerzos físicos')
  assertEquals(p.paciente.nroDoc, '30123456')
  assertEquals(p.paciente.sexo, 'F')
  assertEquals(p.medico.especialidad, 'Medicina General') // legible, nunca el slug
  assertEquals(p.medico.matricula, { tipo: 'MN', numero: '112233', profesion: 'Médica', especialidad: 'Medicina General' })
  assertEquals(p.medico.profesion, 'Médica') // de la especialidad y el género
  assert(!String(p.medico.firmabase64).startsWith('data:'))
})

Deno.test('constancia: fecha y hora en hora argentina; indicaciones a la segunda hoja', () => {
  const p = armar(CONSTANCIA)
  assertEquals(problemasDelPayload(p), [])
  assertEquals(p.prescripcion[0].prescripcion, 'Constancia de atención')
  assertMatch(p.prescripcion[0].observaciones, /^Se deja constancia de que el\/la paciente fue atendido\/a en consulta médica el 02\/11\/2026 a las 14:30\.$/)
  assertEquals(p.indicaciones, 'Control en 7 días')
  assertEquals('indicaciones' in armar({ ...CONSTANCIA, indicaciones: '  ' }), false)
})

Deno.test('escolar: días de inasistencia y fecha de la atención', () => {
  const p = armar(ESCOLAR)
  assertEquals(problemasDelPayload(p), [])
  assertEquals(p.prescripcion[0].prescripcion, 'Certificado médico escolar')
  assertEquals(p.prescripcion[0].observaciones,
    'Se justifica la inasistencia a clases por 2 (dos) días, del 03/11/2026 al 04/11/2026 inclusive. Puede reintegrarse el 05/11/2026.')
  assertEquals(p.indicaciones, 'Reincorporarse con alta')
})

Deno.test('vista previa: los mismos datos que el payload, en el orden del PDF', () => {
  const p = armar({ ...REPOSO, cie10Code: 'J06.9', cie10Display: 'Infección aguda de las vías respiratorias superiores', imprimirDiagnostico: true })
  const v = vistaPrevia(p, '2026-11-02', null)
  assertEquals(v.titulo, p.prescripcion[0].prescripcion)
  assertEquals(v.cuerpo, p.prescripcion[0].observaciones)
  assertEquals(v.diagnostico, 'J06.9')
  assertEquals(v.medico.linea, 'MÉDICA - MEDICINA GENERAL')
  assertEquals(v.medico.matricula, 'Matrícula Nac.: 112233')
  assertEquals(v.paciente, { nombre: 'Paciente Demo', dni: '30123456', sexo: 'Femenino', nacimiento: '15/03/1990' })
  assertEquals(v.indicaciones, 'Evitar esfuerzos físicos')
  assertEquals(vistaPrevia(armar(REPOSO), '2026-11-02', null).diagnostico, null)
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
  assertMatch(textoDelCertificado({ tipo: 'reposo', dias: 1, desde: '2026-11-02' }).cuerpo, /1 \(un\) día, el 02\/11\/2026\.$/)
  assertMatch(textoDelCertificado({ tipo: 'reposo', dias: 3, desde: '2026-11-30' }).cuerpo, /del 30\/11\/2026 al 02\/12\/2026/)
})

Deno.test('validación de lo que manda el profesional', () => {
  assertEquals(validarCertificado(REPOSO), null)
  assertEquals(validarCertificado(CONSTANCIA), null)
  assertEquals(validarCertificado(ESCOLAR, '2026-11-02'), null)
  assert(validarCertificado({ ...REPOSO, dias: 0 }))
  assert(validarCertificado({ ...REPOSO, dias: 31 }))
  assert(validarCertificado({ ...REPOSO, desde: '' }))
  assert(validarCertificado({ ...ESCOLAR, dias: null }))
  assert(validarCertificado({ tipo: 'constancia', atencionAt: null }))
  // No antes del día de la consulta (Mateo, 2026-11-02).
  assert(validarCertificado({ ...REPOSO, desde: '2026-11-01' }, '2026-11-02'))
  assertEquals(validarCertificado({ ...REPOSO, desde: '2026-11-02' }, '2026-11-02'), null)
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

Deno.test('matrícula provincial: la provincia del legajo si está', () => {
  const p = armar(REPOSO, { legajo: { ...legajo, license_type: 'MP', license_province: 'Santa Fe' } })
  assertEquals(p.medico.matricula.provincia, 'Santa Fe')
  assertEquals(problemasDelPayload(p), [])
  // Sin provincia se emite igual, sin la clave (decisión de Mateo, igual que la receta).
  const sinProv = armar(REPOSO, { legajo: { ...legajo, license_type: 'MP', license_province: null } })
  assertEquals('provincia' in sinProv.medico.matricula, false)
  assertEquals(problemasDelPayload(sinProv), [])
})

Deno.test('domicilio de la atención: calle y número, o dirección sola', () => {
  const p = armar(REPOSO)
  assertEquals(p.lugarAtencion?.domicilio, { calle: 'Coronel Ramón Lorenzo Falcón', numero: '1500', localidad: 'Flores' })
  const nominatim = armar(REPOSO, { legajo: { ...legajo, address: 'IFER, 2259, Gorriti, Palermo, CABA' } })
  assertEquals(problemasDelPayload(nominatim), [])
  const sinAltura = armar(REPOSO, { legajo: { ...legajo, address: 'Hospital Italiano, Almagro' } })
  assertEquals(sinAltura.lugarAtencion?.domicilio, { direccion: 'Hospital Italiano, Almagro' })
  assertEquals(problemasDelPayload(sinAltura), [])
})

Deno.test('consultaNoCertificable: sólo con atención (cancelada, no_show, vencida, futura no)', () => {
  const ahora = Date.parse('2026-11-02T15:00:00Z')
  const c = (status: string, started_at: string | null, scheduled_at: string | null) => ({ status, started_at, scheduled_at })
  assertEquals(consultaNoCertificable(c('cancelled', null, null), ahora)?.code, 'CERT_CONSULTA_CANCELADA')
  assertEquals(consultaNoCertificable(c('no_show', null, '2026-11-02T14:00:00Z'), ahora)?.code, 'CERT_CONSULTA_NO_REALIZADA')
  assertEquals(consultaNoCertificable(c('expired', null, null), ahora)?.code, 'CERT_CONSULTA_NO_REALIZADA')
  assertEquals(consultaNoCertificable(c('confirmed', null, '2026-11-03T15:00:00Z'), ahora)?.code, 'CERT_CONSULTA_FUTURA')
  assertEquals(consultaNoCertificable(c('confirmed', null, '2026-11-02T15:10:00Z'), ahora)?.code, 'CERT_CONSULTA_FUTURA')
  // Una 'confirmed' cuenta desde la hora del turno (Mateo, 2026-11-02).
  assertEquals(consultaNoCertificable(c('confirmed', null, '2026-11-01T15:00:00Z'), ahora), null)
  assertEquals(consultaNoCertificable(c('confirmed', null, '2026-11-02T15:00:00Z'), ahora), null)
  assertEquals(consultaNoCertificable(c('pending', null, null), ahora)?.code, 'CERT_CONSULTA_FUTURA')
  assertEquals(consultaNoCertificable(c('closing', null, '2026-11-03T15:00:00Z'), ahora), null)
  assertEquals(consultaNoCertificable(c('pending_pro_close', null, null), ahora), null)
  assertEquals(consultaNoCertificable(c('in_progress', null, '2026-11-03T15:00:00Z'), ahora), null)
  assertEquals(consultaNoCertificable(c('completed', null, null), ahora), null)
  assertEquals(consultaNoCertificable(c('confirmed', '2026-11-02T14:55:00Z', '2026-11-03T15:00:00Z'), ahora), null)
})

Deno.test('nombreDelProblema: ninguna clave de problemasDelPayload llega cruda al profesional', () => {
  // Un payload vacío dispara casi todas las reglas; las de domicilio se prueban aparte.
  const claves = new Set([
    ...problemasDelPayload({ imprimirDiagnostico: 'S', medico: { firmabase64: 'data:x' }, prescripcion: [{ prescripcion: ' ' }], clienteAppId: 'x' }),
    ...problemasDelPayload({ prescripcion: [], lugarAtencion: { domicilio: { calle: 'x', numero: '' } }, imprimirDiagnostico: 'Z' }),
    ...problemasDelPayload({ lugarAtencion: { domicilio: { direccion: '' } } }),
  ])
  assert(claves.size > 10)
  for (const k of claves) assert(nombreDelProblema(k) !== k, `sin nombre legible: ${k}`)
})

Deno.test('decidirRecuperacion: un certificado trabado nunca se reemite a ciegas', () => {
  const ahora = Date.parse('2026-11-02T15:00:00Z')
  const vieja = '2026-11-02T14:50:00Z', nueva = '2026-11-02T14:58:00Z'
  // El log dice que salió → se recupera (aunque sea reciente: el dato es el mismo).
  assertEquals(decidirRecuperacion({ created_at: vieja, llamado_at: vieja }, { s3_link: 'https://x/pdf' }, ahora), 'recuperar')
  assertEquals(decidirRecuperacion({ created_at: nueva, llamado_at: nueva }, { s3_link: 'https://x/pdf' }, ahora), 'recuperar')
  // Otra emisión en curso (menos de 5 min) → 409, nada se toca.
  assertEquals(decidirRecuperacion({ created_at: nueva, llamado_at: nueva }, null, ahora), 'en_curso')
  assertEquals(decidirRecuperacion({ created_at: nueva, llamado_at: null }, null, ahora), 'en_curso')
  // Se llamó al servicio y no quedó respuesta → a revisar, NUNCA reintentar.
  assertEquals(decidirRecuperacion({ created_at: vieja, llamado_at: vieja }, null, ahora), 'a_revisar')
  assertEquals(decidirRecuperacion({ created_at: vieja, llamado_at: vieja }, { s3_link: null }, ahora), 'a_revisar')
  // Nunca se llamó → se puede reintentar.
  assertEquals(decidirRecuperacion({ created_at: vieja, llamado_at: null }, null, ahora), 'reintentar')
})

Deno.test('index.ts marca llamado_at ANTES de llamar al servicio y un timeout queda a revisar', async () => {
  const src = await Deno.readTextFile(new URL('./index.ts', import.meta.url))
  const marca = src.indexOf("update({ llamado_at: new Date().toISOString() })")
  const llamada = src.indexOf("let res = await llamarRcta('POST'")
  assert(marca > 0 && llamada > marca, 'llamado_at tiene que escribirse antes de la primera llamada al servicio')
  const timeout = src.slice(src.indexOf("if (res.kind === 'network_error') {", llamada))
  assertMatch(timeout.slice(0, 400), /a_revisar: true/)
  assertMatch(src, /return json\(\{ certificado: final, recuperado: true \}\)/)
})
