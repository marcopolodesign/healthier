// Control de "lo arreglado no vuelve" para la orden de estudios: falla si el
// armado del payload de prescribirPractica deja de cumplir lo que pide la wiki
// (docs/innovamed-wiki-2026-11-02/2309947393.txt) o si un estudio sin id del
// catálogo vuelve a poder mandarse (el servicio lo rechaza con QBI232).
//
//   npm run test:estudios
import { assert, assertEquals } from 'jsr:@std/assert@1'
import {
  armarPayloadOrden, problemasDeLaOrden, estudiosDeLaEntrada, elegirDelCatalogo, resolverCobertura,
  nombreDelProblemaOrden, consultasPara,
} from './armado.ts'

const FIRMA = 'iVBORw0KGgo' + 'A'.repeat(200)
const paciente = { first_name: 'Paciente', last_name: 'Demo', dni: '30.123.456', gender: 'femenino', birth_date: '1990-03-15', phone: null }
const profesional = { first_name: 'Laura', last_name: 'Gómez', dni: '28456789', gender: 'femenino', birth_date: '1981-06-09' }
const legajo = { specialty: 'medicina_general', license_type: 'MN', license_number: '112233', license_province: null, address: 'Avenida Santa Fe 1234, Palermo, Ciudad Autónoma de Buenos Aires' }

const armar = (extra: Record<string, unknown> = {}) => armarPayloadOrden({
  clienteAppId: 597,
  estudios: [{ id: 884, nombre: 'Hemograma Completo Con Plaquetas' }, { id: 914, nombre: 'Ferritina' }],
  indicaciones: 'En ayunas de 8 horas.',
  patient: paciente, professional: profesional, legajo, especialidadLabel: 'Medicina General',
  firmabase64: FIRMA, cobertura: null, ...extra,
})

Deno.test('orden: cumple los obligatorios de la wiki', () => {
  const p = armar()
  assertEquals(problemasDeLaOrden(p), [])
  assertEquals(p.prescripcion, [
    { id: 884, nombre: 'Hemograma Completo Con Plaquetas', cantidad: 1 },
    { id: 914, nombre: 'Ferritina', cantidad: 1 },
  ])
  assertEquals(p.indicaciones, 'En ayunas de 8 horas.')
  assertEquals(p.paciente.nroDoc, '30123456')
  assertEquals(p.imprimirDiagnostico, 'N')
  assertEquals('diagnostico' in JSON.parse(JSON.stringify(p)), false)
  assert(p.lugarAtencion?.domicilio)
})

Deno.test('orden: un estudio sin id del catálogo no se manda', () => {
  const p = armar({ estudios: [{ id: 884, nombre: 'Hemograma' }, { id: null, nombre: 'Tsh escrita a mano' }] })
  assertEquals(problemasDeLaOrden(p), ['prescripcion[1].id'])
  assertEquals(nombreDelProblemaOrden('prescripcion[1].id'), 'elegir cada estudio del listado')
})

Deno.test('orden: sin estudios no se manda', () => {
  assertEquals(problemasDeLaOrden(armar({ estudios: [] })), ['prescripcion'])
})

Deno.test('orden: el diagnóstico, si se cargó, se imprime', () => {
  const p = armar({ diagnostico: 'D50.9' })
  assertEquals(p.diagnostico, 'D50.9')
  assertEquals(p.imprimirDiagnostico, 'S')
})

Deno.test('entrada de la HC → estudios: usa catalogoId y descarta vacíos', () => {
  assertEquals(estudiosDeLaEntrada({ estudios: [
    { nombre: 'Ferritina', catalogoId: 914, categoria: 'Bioquímica' },
    { nombre: 'Tsh', codigo: '61167004' },
    { nombre: '  ' },
  ] }), [
    { id: 914, nombre: 'Ferritina', categoria: 'Bioquímica' },
    { id: null, nombre: 'Tsh', categoria: null },
  ])
  assertEquals(estudiosDeLaEntrada(null), [])
})

Deno.test('órdenes viejas: sólo coincidencia exacta del nombre (sin mayúsculas ni tildes)', () => {
  const practicas = [
    { id: 343, practica: 'hemograma completo (procedimiento)', categoria: 'Bioquímica' },
    { id: 884, practica: 'HEMOGRAMA COMPLETO CON PLAQUETAS', categoria: 'Bioquímica' },
  ]
  assertEquals(elegirDelCatalogo('Hemograma Completo con Plaquetas', practicas), { id: 884, categoria: 'Bioquímica' })
  assertEquals(elegirDelCatalogo('Hemograma Completo', practicas), null)
  assertEquals(elegirDelCatalogo('Medición de Hierro Sérico (Procedimiento)', [{ id: 1, practica: 'medicion de hierro serico (procedimiento)' }]), { id: 1, categoria: null })
})

Deno.test('cobertura: misma regla que la receta', () => {
  const perfilOsde = { coverage_type: 'financiador', financiador_id: 28, insurance_num: '123' }
  assertEquals(resolverCobertura(null, perfilOsde).cobertura, { idFinanciador: '28', numero: '123' })
  assertEquals(resolverCobertura({ coverage_type: 'particular' }, perfilOsde).cobertura, null)
  assertEquals(resolverCobertura({ coverage_type: 'financiador', financiador_id: null }, null).error?.code, 'RCTA_FINANCIADOR_SIN_CODIGO')
  assertEquals(resolverCobertura({ coverage_type: 'financiador', financiador_id: 9, affiliate_number: '' }, null).error?.code, 'RCTA_AFILIADO_FALTANTE')
  assertEquals(resolverCobertura(null, { coverage_type: 'financiador', financiador_id: 28, insurance_num: '' }).cobertura, null)
})

Deno.test('órdenes viejas: búsquedas más cortas cuando el nombre completo no aparece', () => {
  const q = consultasPara('Vitamina D')
  assertEquals(q[0], 'vitamina d')
  assert(q.includes('vitamina'))
  const h = consultasPara('Medición del Antígeno de Superficie de la Hepatitis B (Procedimiento)')
  assert(h.includes('antígeno superficie') || h.includes('del antígeno'))
  assert(h.includes('procedimiento'))
  assertEquals(new Set(h).size, h.length)
})
