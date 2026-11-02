// Controles de "lo arreglado no vuelve" para la receta electrónica según la
// wiki de Innovamed (2026-11-02, website/docs/innovamed-wiki-2026-11-02/).
//
//   npm run test:rcta-armado
//
// Uno por arreglo: provincia de la matrícula MP (QBI65), errores parciales del
// lote, domicilio del consultorio con calle y número reales (QBI240/241),
// "Pendiente de autorización", especialidad legible + profesión, Accept:
// application/json y la ruta del logo. Prueba el módulo compartido
// `supabase/functions/_shared/rcta/` (TypeScript, por eso corre con tsx).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  PROVINCIAS_MATRICULA, domicilioDe, calleYNumero, armarMedico, matriculaDe, problemaDeMatricula,
  profesionDe, etiquetaDeSlug, cabecerasRcta, leerEmision, asignarRecetas, autorizacionDe, accionPdfAviso,
} from '../supabase/functions/_shared/rcta/mod.ts'
import { PROVINCIAS_MATRICULA as PROVINCIAS_FRONT, faltaProvinciaMatricula } from '../src/lib/provinciasMatricula.js'
import { direccionTieneNumero } from '../src/lib/geo.js'
import { faltanParaRecetar } from '../src/lib/datosReceta.js'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const leer = p => readFileSync(join(RAIZ, p), 'utf8')
const WIKI = leer('docs/innovamed-wiki-2026-11-02/2086174790.txt')

// ── 1 · Provincia de la matrícula ────────────────────────────────────────────
test('las provincias son exactamente las de la wiki, y el front y las funciones coinciden', () => {
  const lista = WIKI.slice(WIKI.indexOf('Listado de provincias para matrícula'), WIKI.indexOf('Diseño de receta'))
  const renglones = lista.split('\n').map(l => l.trim())
  for (const { value } of PROVINCIAS_MATRICULA) {
    assert.ok(renglones.some(r => r === value || r.split(' ó ').includes(value)), `"${value}" no está en la wiki`)
  }
  assert.equal(PROVINCIAS_MATRICULA.length, 24)
  assert.deepEqual(PROVINCIAS_FRONT, PROVINCIAS_MATRICULA)
  assert.ok(PROVINCIAS_MATRICULA.some(p => p.value === 'Ciudad Autonoma de Bs As'))
  assert.ok(PROVINCIAS_MATRICULA.some(p => p.value === 'Cordoba'))
  // La misma lista en el check de la base.
  const sql = leer('supabase/migrations/223_receta_segun_la_wiki.sql')
  for (const { value } of PROVINCIAS_MATRICULA) assert.ok(sql.includes(`'${value}'`), `falta ${value} en la 223`)
})

test('una MP manda la provincia; sin provincia se corta antes de llamar al servicio', () => {
  const legajo = { license_type: 'MP', license_number: 'MP 43.243', license_province: 'Cordoba', specialty: 'medicina_general' }
  const m = armarMedico({ first_name: 'Juan', last_name: 'Castro', dni: '25.123.456', gender: 'masculino' }, legajo, 'Medicina General', 'AAAA')
  assert.equal(m.matricula.tipo, 'MP')
  assert.equal(m.matricula.provincia, 'Cordoba')
  assert.equal(m.nroDoc, '25123456')
  assert.equal(problemaDeMatricula(matriculaDe(legajo)), null)

  const sinProvincia = matriculaDe({ ...legajo, license_province: null })
  assert.equal(problemaDeMatricula(sinProvincia)?.code, 'RCTA_MATRICULA_SIN_PROVINCIA')
  // Un valor que no es de la lista es como no tenerla.
  assert.equal(problemaDeMatricula(matriculaDe({ ...legajo, license_province: 'Córdoba' }))?.code, 'RCTA_MATRICULA_SIN_PROVINCIA')
  // Una MN no lleva provincia ni la necesita.
  const mn = armarMedico({ full_name: 'Ana Pérez' }, { license_type: 'MN', license_number: '123', license_province: 'Cordoba' }, '', null)
  assert.equal('provincia' in mn.matricula, false)
  assert.equal(problemaDeMatricula(matriculaDe({ license_type: 'MN', license_number: '123' })), null)
  // La foto de la medicación manda sobre el legajo para tipo y número.
  assert.equal(matriculaDe(legajo, { tipo: 'MN', numero: '999' }).tipo, 'MN')
})

test('rcta-issue corta con la provincia faltante y la lee del legajo', () => {
  const iss = leer('supabase/functions/rcta-issue/index.ts')
  assert.match(iss, /problemaDeMatricula\(matricula\)/)
  assert.match(iss, /license_province, address\)/)
  // El front pide la provincia en el onboarding, el perfil, el super admin y el aviso del panel.
  assert.match(leer('src/pages/professional/Onboarding.jsx'), /faltaProvinciaMatricula\(form\.licenseType, form\.licenseProvince\)/)
  assert.match(leer('src/pages/professional/Profile.jsx'), /perfil-provincia-matricula/)
  assert.match(leer('src/pages/super-admin/Profesionales.jsx'), /license_province: provincia/)
  assert.match(leer('src/pages/professional/Dashboard.jsx'), /aviso-provincia-matricula/)
  assert.equal(faltaProvinciaMatricula('MP', ''), true)
  assert.equal(faltaProvinciaMatricula('MN', ''), false)
  assert.ok(faltanParaRecetar({ dni: '1', gender: 'f', licenseNumber: '1', licenseType: 'MP', address: 'x', hasSignature: true })
    .includes('provincia de la matrícula'))
})

// ── 3 · Domicilio del consultorio ────────────────────────────────────────────
test('las direcciones de Nominatim salen con calle y número reales', () => {
  assert.deepEqual(domicilioDe('3709, Arenales, Palermo, Comuna 14, Buenos Aires, C1425, Argentina'),
    { calle: 'Arenales', numero: '3709', localidad: 'Palermo' })
  assert.deepEqual(domicilioDe('IFER, 2259, Marcelo T. de Alvear, Barrio Norte, Recoleta, Buenos Aires'),
    { calle: 'Marcelo T. de Alvear', numero: '2259', localidad: 'Barrio Norte' })
  assert.deepEqual(domicilioDe('Av. Santa Fe 1900 Piso 3 Dto B, Palermo'),
    { calle: 'Av. Santa Fe', numero: '1900', localidad: 'Palermo' })
  assert.deepEqual(domicilioDe('Av. 9 de Julio 1000'), { calle: 'Av. 9 de Julio', numero: '1000' })
  assert.deepEqual(domicilioDe('Calle 99 - Zárate 1234, Villa Lynch'), { calle: 'Calle 99 - Zárate', numero: '1234', localidad: 'Villa Lynch' })
  assert.equal(domicilioDe('Consultorio Sur, 12B, Avenida Mitre, Avellaneda').numero, '12B')
})

test('sin altura va la dirección sola (3 a 150), nunca una calle sin número', () => {
  assert.deepEqual(domicilioDe('Coronel Ramón Lorenzo Falcón, Flores, Buenos Aires'),
    { direccion: 'Coronel Ramón Lorenzo Falcón, Flores, Buenos Aires' })
  assert.deepEqual(domicilioDe('Av. 9 de Julio, CABA'), { direccion: 'Av. 9 de Julio, CABA' })
  assert.equal(domicilioDe('ab'), null)
  assert.equal(domicilioDe(''), null)
  assert.equal(domicilioDe('x'.repeat(200) + ' 12').direccion.length, 150)
  // Largos del contrato: calle 2..50, número 1..6.
  for (const d of ['3709, Arenales, Palermo', 'IFER, 2259, Marcelo T. de Alvear', 'Falcón 1500, Flores']) {
    const r = domicilioDe(d)
    assert.ok(r.calle.length >= 2 && r.calle.length <= 50 && r.numero.length >= 1 && r.numero.length <= 6, d)
  }
})

test('mismo criterio que direccionTieneNumero (geo.js / migraciones 220-221)', () => {
  const casos = [
    'Coronel Ramón Lorenzo Falcón, Flores, Buenos Aires', 'Av. 9 de Julio, CABA',
    'Calle 99 - Zárate Villa Progreso, B1502HQG Villa Lynch, Buenos Aires Province', 'San Martín s/n, Ramallo',
    'Falcón', 'Lavalleja, Villa Crespo, Buenos Aires', 'Donado y Echeverria.', '9 de Julio, Martin, Rosario, Santa Fe',
    'Calle 99 - Zárate, Villa Lynch', 'Primera Junta, Avenida Rivadavia, Caballito', 'Buenos Aires, Argentina',
    'Falcón 1500, Flores, Buenos Aires', 'Av. 9 de Julio 1000', 'Av. Santa Fe 1900 Piso 3 Dto B, Palermo',
    '3709, Arenales, Palermo, Comuna 14', 'Calle 99 - Zárate 1234, Villa Lynch', 'Ruta 8 km 50',
    'IFER, 2259, Marcelo T. de Alvear, Barrio Norte, Buenos Aires', 'Centro Médico Santa Paula, 1399, Avenida Daniel M. Cazón, Tigre',
    'Belgrano Athletic Club, 3456, Virrey Del Pino, Belgrano', 'Consultorio Sur, 12B, Avenida Mitre, Avellaneda', '1234',
  ]
  for (const d of casos) assert.equal(calleYNumero(d) !== null, direccionTieneNumero(d), d)
  const iss = leer('supabase/functions/rcta-issue/index.ts')
  assert.doesNotMatch(iss, /parseAddress/)
  assert.match(iss, /domicilioDe\(legajo\.address\)/)
})

// ── 5 · Especialidad legible + profesión ─────────────────────────────────────
test('el médico va con profesión y la especialidad legible, nunca el slug', () => {
  const m = armarMedico({ full_name: 'Ana Pérez', gender: 'femenino' },
    { license_type: 'MN', license_number: '1', specialty: 'medicina_general' }, 'Medicina General', null)
  assert.equal(m.profesion, 'Médica')
  assert.equal(m.matricula.profesion, 'Médica')
  assert.equal(m.especialidad, 'Medicina General')
  assert.equal(m.matricula.especialidad, 'Medicina General')
  assert.doesNotMatch(JSON.stringify(m), /medicina_general/)
  assert.equal(profesionDe('pediatria', 'masculino'), 'Médico')
  assert.equal(profesionDe('psicologia', 'femenino'), 'Psicóloga')
  assert.equal(profesionDe('nutricion'), 'Nutricionista')
  assert.equal(profesionDe('entrenamiento'), null)
  assert.equal(etiquetaDeSlug('medicina_general'), 'Medicina general')
  assert.match(leer('supabase/functions/rcta-issue/index.ts'), /etiquetaEspecialidad\(supabase, legajo\.specialty\)/)
})

// ── 2 · Errores parciales ────────────────────────────────────────────────────
const MEDS = [
  { id: 'a', reg_no: '59811', medication_name: 'GARDASIL 9' },
  { id: 'b', reg_no: '12345', medication_name: 'IBUPROFENO' },
]

test('un lote con errores guarda lo que salió y marca sólo lo que falló', () => {
  const e = leerEmision({
    idTransaccion: 'T1',
    recetas: [{ id: 'H1', idReceta: '100', s3Link: 'https://x/1.pdf', medicamentos: ['59811'] }],
    errores: [{ error: 'QBI26', mensaje: 'VERIFIQUE LOS NOMBRES', medicamento: '12345' }],
    response: [{ status: 'Ok' }],
  })
  const a = asignarRecetas(e, MEDS)
  assert.equal(a.recetasDe.get('a')[0].idReceta, '100')
  assert.equal(a.fallidas.get('b').error, 'QBI26')
  assert.deepEqual(a.sinUbicar, [])
})

test('varias recetas en el lote: cada medicación con la suya, todas guardadas', () => {
  const e = leerEmision({
    recetas: [
      { id: 'H1', idReceta: '100', medicamentos: [{ regNo: '59811' }] },
      { id: 'H2', idReceta: '101', medicamentos: [{ regNo: '12345' }] },
    ],
    errores: [],
    response: [{ status: 'Ok' }, { status: 'Pendiente de autorización' }],
  })
  const a = asignarRecetas(e, MEDS)
  assert.equal(a.recetasDe.get('a')[0].id, 'H1')
  assert.equal(a.recetasDe.get('b')[0].id, 'H2')
  assert.equal(a.recetasDe.get('b')[0].autorizacion, 'pendiente')
})

test('una sola receta sin lista se lleva todo; un error sin medicamento no se adivina', () => {
  const todo = asignarRecetas(leerEmision({ recetas: [{ id: 'H1', idReceta: '100' }] }), MEDS)
  assert.equal(todo.recetasDe.size, 2)
  const ambiguo = asignarRecetas(leerEmision({ recetas: [{ id: 'H1', idReceta: '100' }], errores: [{ error: 'QBI99', mensaje: 'algo' }] }), MEDS)
  assert.deepEqual(ambiguo.sinUbicar.sort(), ['a', 'b'])
  assert.equal(ambiguo.recetasDe.size, 0)
})

test('rcta-issue ya no tira el lote entero por un `errores`', () => {
  const iss = leer('supabase/functions/rcta-issue/index.ts')
  assert.doesNotMatch(iss, /if \(rctaData\.errores\?\.length\)/)
  assert.match(iss, /asignarRecetas\(/)
  assert.match(iss, /rcta_recetas:\s+recetas\.map\(resumenReceta\)/)
  assert.match(iss, /'issued_partial'/)
  // La anulación recorre todas las recetas guardadas de la fila.
  assert.match(leer('supabase/functions/rcta-anular/index.ts'), /f\.rcta_recetas\?\.length/)
})

// ── 4 · Pendiente de autorización ────────────────────────────────────────────
test('"Pendiente de autorización" se lee, se guarda y la farmacia no la vende', () => {
  assert.equal(autorizacionDe('Pendiente de autorización'), 'pendiente')
  assert.equal(autorizacionDe('PENDIENTE DE AUTORIZACION'), 'pendiente')
  assert.equal(autorizacionDe('Ok'), 'ok')
  assert.equal(autorizacionDe(''), null)
  const e = leerEmision({ recetas: [{ id: 'H', idReceta: '1' }], response: [{ status: 'Pendiente de autorización' }] })
  assert.equal(e.recetas[0].autorizacion, 'pendiente')
  const sql = leer('supabase/migrations/223_receta_segun_la_wiki.sql')
  assert.match(sql, /when b\.rcta_autorizacion = 'pendiente' and not b\.ya_usada then 'pendiente'/)
  assert.match(sql, /or new\.rcta_autorizacion\s+is distinct from old\.rcta_autorizacion/)
  assert.match(leer('src/pages/patient/Pharmacy.jsx'), /estado === 'pendiente'/)
  assert.match(leer('src/components/professional/PrescriptionCreator.jsx'), /Pendiente de autorización/)
})

test('accionPDF se lee: 0 es "No aplica", otro id trae el aviso', () => {
  assert.equal(accionPdfAviso(leerEmision({ accionPDF: { accionId: 0, descripcion: 'No aplica' } })), null)
  assert.match(accionPdfAviso(leerEmision({ accionPDF: { accionId: 3, descripcion: 'Separación de recetas por medicamentos de diabetes' } })), /diabetes/)
})

// ── 6 · Accept: application/json ─────────────────────────────────────────────
test('emisión, anulación y catálogo mandan Accept: application/json', () => {
  assert.equal(cabecerasRcta('t').Accept, 'application/json')
  assert.equal(cabecerasRcta('t', { json: false })['Content-Type'], undefined)
  assert.match(leer('supabase/functions/rcta-issue/index.ts'), /llamarRcta\('POST'/)
  assert.match(leer('supabase/functions/rcta-anular/index.ts'), /llamarRcta\('DELETE'/)
  assert.match(leer('supabase/functions/rcta-catalog/index.ts'), /cabecerasRcta\(RCTA_API_KEY/)
  for (const f of ['rcta-issue', 'rcta-anular', 'rcta-catalog']) {
    assert.doesNotMatch(leer(`supabase/functions/${f}/index.ts`), /await fetch\(`\$\{RCTA_API_URL\}\/apirecipe\/Receta/, f)
  }
})

// ── 7 · Ruta del logo ────────────────────────────────────────────────────────
test('el script del logo apunta a /admin/v1/logo', () => {
  const s = leer('scripts/registrar-logo-receta.mjs')
  assert.match(s, /const ENDPOINT = `\$\{URL_BASE\}\/admin\/v1\/logo`/)
  assert.doesNotMatch(s, /\$\{URL_BASE\}\/apirecipe\/admin\/Logo/)
})
