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

test('una MP manda la provincia si está; sin provincia se emite igual, sin la clave', () => {
  const legajo = { license_type: 'MP', license_number: 'MP 43.243', license_province: 'Cordoba', specialty: 'medicina_general' }
  const m = armarMedico({ first_name: 'Juan', last_name: 'Castro', dni: '25.123.456', gender: 'masculino' }, legajo, 'Medicina General', 'AAAA')
  assert.equal(m.matricula.tipo, 'MP')
  assert.equal(m.matricula.provincia, 'Cordoba')
  assert.equal(m.nroDoc, '25123456')
  assert.equal(problemaDeMatricula(matriculaDe(legajo)), null)

  // MP sin provincia → se emite sin provincia (Mateo, 2026-11-02: se pide sin bloquear).
  const sinProvincia = matriculaDe({ ...legajo, license_province: null })
  assert.equal(problemaDeMatricula(sinProvincia), null)
  const mpSin = armarMedico({ full_name: 'Juan Castro' }, { ...legajo, license_province: null }, 'Medicina General', null)
  assert.equal(mpSin.matricula.tipo, 'MP')
  assert.equal('provincia' in mpSin.matricula, false, 'sin provincia no se manda la clave (ni vacía)')
  // Un valor que no es de la lista es como no tenerla: tampoco bloquea ni viaja.
  assert.equal(problemaDeMatricula(matriculaDe({ ...legajo, license_province: 'Córdoba' })), null)
  assert.equal('provincia' in armarMedico({}, { ...legajo, license_province: 'Córdoba' }, '', null).matricula, false)
  // Sin número sí bloquea, como siempre.
  assert.equal(problemaDeMatricula(matriculaDe({ license_type: 'MP', license_number: '' }))?.code, 'RCTA_MATRICULA_FALTANTE')
  // Una MN no lleva provincia ni la necesita.
  const mn = armarMedico({ full_name: 'Ana Pérez' }, { license_type: 'MN', license_number: '123', license_province: 'Cordoba' }, '', null)
  assert.equal('provincia' in mn.matricula, false)
  assert.equal(problemaDeMatricula(matriculaDe({ license_type: 'MN', license_number: '123' })), null)
  // La foto de la medicación manda sobre el legajo para tipo y número.
  assert.equal(matriculaDe(legajo, { tipo: 'MN', numero: '999' }).tipo, 'MN')
})

test('la provincia se pide sin bloquear: nada la exige para emitir ni para avanzar', () => {
  const iss = leer('supabase/functions/rcta-issue/index.ts')
  assert.match(iss, /problemaDeMatricula\(matricula\)/)
  assert.match(iss, /license_province, address\)/)
  // No se corta ANTES de llamar: sólo se traduce el rechazo del servicio (QBI62/QBI65).
  assert.doesNotMatch(iss, /'la provincia de tu matrícula'/)
  assert.doesNotMatch(leer('supabase/functions/_shared/rcta/medico.ts'), /RCTA_MATRICULA_SIN_PROVINCIA/)
  // El onboarding la ofrece pero no frena el paso; el perfil no frena el guardado.
  const onb = leer('src/pages/professional/Onboarding.jsx')
  assert.match(onb, /onboarding-provincia-matricula/)
  assert.doesNotMatch(onb, /falta\.push\('la provincia/)
  const perfil = leer('src/pages/professional/Profile.jsx')
  assert.match(perfil, /perfil-provincia-matricula/)
  assert.match(perfil, /perfil-aviso-provincia/)
  assert.doesNotMatch(perfil, /Elegí la provincia de tu matrícula/)
  assert.match(leer('src/pages/super-admin/Profesionales.jsx'), /license_province: provincia/)
  assert.match(leer('src/pages/professional/Dashboard.jsx'), /aviso-provincia-matricula/)
  assert.equal(faltaProvinciaMatricula('MP', ''), true)
  assert.equal(faltaProvinciaMatricula('MN', ''), false)
  // El super admin no la cuenta como "no puede recetar".
  assert.deepEqual(faltanParaRecetar({ dni: '1', gender: 'f', licenseNumber: '1', licenseType: 'MP', address: 'x', hasSignature: true }), [])
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

// ── Revisión pre-prod (2026-11-02): lo que dejaba re-emitir una receta que ya salió ──
test('un error que nombra un medicamento no cae sobre otro parecido', () => {
  const meds = [
    { id: 'a', reg_no: '1', medication_name: 'Ibuprofeno 400 comprimidos' },
    { id: 'b', reg_no: '2', medication_name: 'Ibuprofeno 600 comprimidos' },
  ]
  const e = leerEmision({
    recetas: [{ id: 'H', idReceta: '9', medicamentos: ['2'] }],
    errores: [{ error: 'QBI26', medicamento: 'IBUPROFENO 400 MG, COMPRIMIDOS' }],
  })
  const a = asignarRecetas(e, meds)
  assert.equal(a.fallidas.has('b'), false, 'la de 600 salió y no puede quedar fallida')
  assert.equal(a.recetasDe.get('b')[0].idReceta, '9')
  assert.deepEqual(a.sinUbicar, ['a'])
})

test('una sola medicación y una receta emitida: es suya aunque haya un error sin atribuir', () => {
  const a = asignarRecetas(leerEmision({ recetas: [{ id: 'H', idReceta: '9' }], errores: [{ error: 'QBIxx', medicamento: 'otro' }] }),
    [{ id: 'a', reg_no: '1', medication_name: 'Actron' }])
  assert.equal(a.recetasDe.get('a')[0].id, 'H')
  assert.deepEqual(a.sinUbicar, [])
})

test('"p. 3" es el piso, no la altura', () => {
  assert.deepEqual(domicilioDe('Av. Santa Fe 1900 p. 3'), { calle: 'Av. Santa Fe', numero: '1900' })
})

test('rcta-issue: provincia faltante, lote a revisar y posdatadas no ubicadas', () => {
  const iss = leer('supabase/functions/rcta-issue/index.ts')
  // QBI62/QBI65 no dispara el reintento sin firma y dice qué cargar.
  assert.match(iss, /\['QBI62', 'QBI65'\]\.includes\(result\.json\?\.error\)/)
  assert.ok(iss.indexOf("['QBI62', 'QBI65']") < iss.indexOf('if (firmabase64 && esRechazoDe4xx && !escenario)'))
  // Lo que salió pero no se pudo atribuir queda guardado y bloquea la re-emisión.
  assert.match(iss, /code: 'RCTA_LOTE_A_REVISAR'/)
  assert.match(iss, /rcta_recetas: principales\.map\(resumenReceta\)/)
  assert.match(iss, /rcta_recetas: emision\.recetas\.map\(resumenReceta\)/)
  // La receta de hoy con posdatadas no puede ser una posdatada sin ubicar.
  assert.match(iss, /!fechasPosdatadas\.includes\(fechaArgentina\(r\.fecha\)\)/)
  // Una escritura por grupo de recetas.
  assert.match(iss, /update\(datos\)\.in\('id', medIds\)/)
})

test('rcta-anular: arrastra a las medicaciones que comparten receta y busca el hash en lotes parciales', () => {
  const an = leer('supabase/functions/rcta-anular/index.ts')
  assert.match(an, /idRecetasDe\(c\)\.some\(id => recetasDelGrupo\.has\(id\)\)/)
  assert.match(an, /\.in\('outcome', \['issued', 'issued_partial'\]\)/)
})

// ── La farmacia autoriza la pendiente (Mateo, 2026-11-02) ────────────────────
test('sólo la farmacia (o el super admin) autoriza una pendiente, y queda quién y cuándo', () => {
  const sql = leer('supabase/migrations/223_receta_segun_la_wiki.sql')
  const fn = sql.slice(sql.indexOf('create or replace function public.farmacia_autorizar_receta'))
  assert.match(fn, /v_rol not in \('pharmacy_admin', 'pharmacy_operator', 'super_admin'\)/)
  assert.match(fn, /rcta_autorizada_por = case when f\.queda_ok then auth\.uid\(\)/)
  assert.match(fn, /_aal_escribir\(\s*null, 'autorizacion_de_receta'/)
  assert.match(fn, /revoke all on function public\.farmacia_autorizar_receta\(uuid\) from public, anon/)
  // El trigger sólo deja pasar ese cambio puntual, marcado por la función.
  assert.match(sql, /current_setting\('healthier\.autorizar_receta', true\) = '1'/)
  assert.match(sql, /old\.rcta_autorizacion = 'pendiente' and new\.rcta_autorizacion in \('ok', 'pendiente'\)/)
  assert.match(sql, /or new\.rcta_autorizada_por\s+is distinct from old\.rcta_autorizada_por/)
  // El panel de la farmacia y el del super admin la muestran.
  assert.match(leer('src/pages/pharmacy/Pedidos.jsx'), /<RecetasPorAutorizar puedeAutorizar=\{canEdit\} \/>/)
  assert.match(leer('src/pages/super-admin/Farmacia.jsx'), /<RecetasPorAutorizar puedeAutorizar conHistorial \/>/)
  assert.match(leer('src/components/pharmacy/RecetasPorAutorizar.jsx'), /Pendiente de autorización de la obra social/)
})

// ── Revisión pre-prod, ronda 2 ───────────────────────────────────────────────
test('no se adivina: varias recetas que listan otra cosa quedan "a revisar"', () => {
  const meds = [{ id: 'a', reg_no: '1', medication_name: 'Ibuprofeno 400' }, { id: 'b', reg_no: '2', medication_name: 'Amoxicilina 500' }]
  const e = leerEmision({ recetas: [{ id: 'H1', idReceta: '7', medicamentos: ['IBUPROFENO 400 MG COMP X 20'] }, { id: 'H2', idReceta: '8', medicamentos: ['AMOXICILINA 500 MG X 21'] }] })
  const a = asignarRecetas(e, meds)
  assert.equal(a.recetasDe.size, 0)
  assert.deepEqual(a.sinUbicar.sort(), ['a', 'b'])
  // Con una sola receta, sin errores, es de todas.
  assert.equal(asignarRecetas(leerEmision({ recetas: [{ id: 'H', idReceta: '9', medicamentos: ['OTRA COSA'] }] }), meds).recetasDe.size, 2)
})

test('con un error sin atribuir y dos medicaciones, la receta sin lista no se le da a la que queda', () => {
  const meds = [{ id: 'a', reg_no: '1', medication_name: 'A' }, { id: 'b', reg_no: '2', medication_name: 'B' }]
  const e = leerEmision({ recetas: [{ id: 'H1', idReceta: '1', medicamentos: ['1'] }, { id: 'H2', idReceta: '2' }], errores: [{ error: 'X', medicamento: 'b con otro nombre' }] })
  const a = asignarRecetas(e, meds)
  assert.equal(a.recetasDe.get('a')[0].id, 'H1')
  assert.deepEqual(a.sinUbicar, ['b'])
})

test('"Av. P. Goyena 1234" es una calle; "p. 3" es un piso', () => {
  assert.deepEqual(domicilioDe('Av. P. Goyena 1234'), { calle: 'Av. P. Goyena', numero: '1234' })
  assert.deepEqual(domicilioDe('Arenales 3709 p.4 B'), { calle: 'Arenales', numero: '3709' })
  assert.equal(calleYNumero('Av. P. Goyena 1234') !== null, direccionTieneNumero('Av. P. Goyena 1234'))
})

test('rcta-issue toma las filas de forma atómica y no depende del reloj', () => {
  const iss = leer('supabase/functions/rcta-issue/index.ts')
  assert.match(iss, /code: 'RCTA_EMISION_EN_CURSO'/)
  assert.doesNotMatch(iss, /fechaArgentina\(new Date\(\)/)
})

test('rcta-anular: hermanas siempre, sólo vigentes, y las "a revisar" se anulan', () => {
  const an = leer('supabase/functions/rcta-anular/index.ts')
  assert.match(an, /const vigente = \(f: Fila\) => f\.status === 'active' && \(f\.rcta_status === 'issued' \|\| f\.rcta_a_revisar === true\)/)
  assert.match(an, /\.in\('rcta_status', \['issued', 'error'\]\)/)
  assert.match(leer('src/components/professional/PrescriptionCreator.jsx'), /\(rx\.rcta_status === 'issued' \|\| aRevisar\(rx\)\) && rx\.status === 'active'/)
})

test('la farmacia autoriza recetas (no filas) y el paciente recibe el aviso', () => {
  const sql = leer('supabase/migrations/223_receta_segun_la_wiki.sql')
  const fn = sql.slice(sql.indexOf('create or replace function public.farmacia_autorizar_receta'))
  assert.match(fn, /e->>'idReceta' = any \(v_recetas\)/)
  assert.match(fn, /case when f\.queda_ok then 'ok' else 'pendiente' end/)
  assert.match(fn, /enviar_push_tipo\(v_fila\.patient_id, 'receta-autorizada'/)
  assert.match(leer('supabase/functions/_shared/push/textos.ts'), /'receta-autorizada': \{/)
})

// ── Revisión pre-prod, ronda 3 ───────────────────────────────────────────────
test('dos recetas sin lista y tres medicaciones: no se reparte', () => {
  const meds = [{ id: 'a', reg_no: '1', medication_name: 'A' }, { id: 'b', reg_no: '2', medication_name: 'B' }, { id: 'c', reg_no: '3', medication_name: 'C' }]
  const a = asignarRecetas(leerEmision({ recetas: [{ id: 'H1', idReceta: '1' }, { id: 'H2', idReceta: '2' }] }), meds)
  assert.equal(a.recetasDe.size, 0)
  assert.deepEqual(a.sinUbicar.sort(), ['a', 'b', 'c'])
})

test('rcta-issue no deja filas trabadas en pending ni toma una "a revisar"', () => {
  const iss = leer('supabase/functions/rcta-issue/index.ts')
  assert.match(iss, /\.or\('rcta_status\.is\.null,and\(rcta_status\.eq\.error,rcta_a_revisar\.is\.false\)'\)/)
  // Toma parcial → se devuelven las tomadas; corte antes de llamar → también.
  assert.match(iss, /if \(tomadasIds\.length !== ids\.length\) \{[\s\S]{0,200}await devolverTomadas\(\)/)
  assert.match(iss, /if \(devolverTomadas && !llamoAlServicio\) await devolverTomadas\(\)/)
  assert.ok(iss.indexOf('llamoAlServicio = true') < iss.indexOf('let result = escenario'))
})

// ── Simulación de lotes (sólo staging) y los 5 de la ronda 3 ─────────────────
import { simulacionPermitida, escenarioPedido, simularEmision } from '../supabase/functions/_shared/rcta/mod.ts'
const envDe = o => ({ get: k => o[k] })

test('la simulación es imposible con las claves de producción', () => {
  const prod = { RCTA_API_URL: 'https://apirecipe.qbitos.com', RCTA_SIMULAR_LOTE: 'permitido' }
  assert.equal(simulacionPermitida(envDe(prod)), false, 'ni con el secret cargado')
  assert.throws(() => escenarioPedido({ simularLote: 'pendiente' }, envDe(prod)), /RCTA_SIMULACION_NO_DISPONIBLE/)
  assert.throws(() => escenarioPedido({ simularLote: 'pendiente' }, envDe({ RCTA_API_URL: 'https://apirecipe.hml.qbitos.com' })), /RCTA_SIMULACION_NO_DISPONIBLE/)
  assert.equal(escenarioPedido({}, envDe(prod)), null, 'sin pedirla, nada cambia')
  const stg = { RCTA_API_URL: 'https://apirecipe.hml.qbitos.com', RCTA_SIMULAR_LOTE: 'permitido' }
  assert.equal(escenarioPedido({ simularLote: 'lote_partido' }, envDe(stg)), 'lote_partido')
  assert.throws(() => escenarioPedido({ simularLote: 'otra' }, envDe(stg)), /RCTA_SIMULACION_DESCONOCIDA/)
  // rcta-issue la decide antes de tocar nada y corta con 403.
  const iss = leer('supabase/functions/rcta-issue/index.ts')
  assert.ok(iss.indexOf('escenarioPedido(body, Deno.env)') < iss.indexOf("update({ rcta_status: 'pending' })"))
  assert.match(iss, /'La simulación de lotes no está disponible en este entorno\.'[\s\S]{0,120}403\)/)
  // El front ni la manda fuera de staging/local.
  assert.match(leer('src/components/professional/PrescriptionCreator.jsx'), /\/staging\|\^localhost\$/)
})

test('los escenarios arman la forma del lote con emisiones reales', async () => {
  const llamadas = []
  let n = 0
  const llamar = async p => { llamadas.push(p.medicamentos.map(m => m.regNo)); n++; return { kind: 'ok', status: 200, data: { idTransaccion: `T${n}`, recetas: [{ id: `H${n}`, idReceta: `${n}` }] } } }
  const payload = { medicamentos: [{ regNo: 'A' }, { regNo: 'B' }] }
  const comp = await simularEmision('lote_compartido', payload, llamar)
  assert.deepEqual(llamadas, [['A', 'B'], ['B']])
  const asig = asignarRecetas(leerEmision(comp.data), [{ id: 'a', reg_no: 'A' }, { id: 'b', reg_no: 'B' }])
  assert.deepEqual(asig.recetasDe.get('a').map(r => r.idReceta), ['1'])
  assert.deepEqual(asig.recetasDe.get('b').map(r => r.idReceta), ['1', '2'])
  const pend = await simularEmision('compartido_pendiente', payload, llamar)
  assert.ok(leerEmision(pend.data).recetas.every(r => r.autorizacion === 'pendiente'))
  const parcial = leerEmision((await simularEmision('parcial', payload, llamar)).data)
  assert.equal(asignarRecetas(parcial, [{ id: 'a', reg_no: 'A' }, { id: 'b', reg_no: 'B' }]).fallidas.has('b'), true)
  const rev = leerEmision((await simularEmision('a_revisar', payload, llamar)).data)
  assert.deepEqual(asignarRecetas(rev, [{ id: 'a', reg_no: 'A' }, { id: 'b', reg_no: 'B' }]).sinUbicar.sort(), ['a', 'b'])
})

test('1-3 · anular: cierre completo de recetas compartidas, reintento de "a revisar" y aviso en el modal', () => {
  const an = leer('supabase/functions/rcta-anular/index.ts')
  assert.match(an, /for \(let cambio = true; cambio;\)/, 'cierre transitivo')
  assert.match(an, /const anulable = \(f: Fila\) => vigente\(f\) \|\| \(reintento && sinConfirmar\(f\)\)/)
  assert.match(an, /if \(body\.previsualizar === true\)/)
  // El reintento ya no exige idReceta principal: una "a revisar" no lo tiene.
  assert.doesNotMatch(an, /!fila\.rcta_prescription_id \|\| \(fila\.rcta_status/)
  const pc = leer('src/components/professional/PrescriptionCreator.jsx')
  assert.match(pc, /clinicalService\.previsualizarAnulacion\(objetivo\.medicationId\)/)
  assert.match(pc, /data-testid="anular-tambien"/)
})

test('4 · "Ya podés comprar" sólo cuando quedó comprable', () => {
  const sql = leer('supabase/migrations/223_receta_segun_la_wiki.sql')
  const fn = sql.slice(sql.indexOf('create or replace function public.farmacia_autorizar_receta'))
  assert.match(fn, /from public\.farmacia_recetas_de\(v_fila\.patient_id\) r\s+where r\.clinical_medication_id = any \(v_ok\)\s+and r\.estado = 'vigente'/)
  assert.match(fn, /group by cm\.rcta_prescription_id/, 'un aviso por receta')
  assert.match(fn, /'medicamento', v_aviso\.medicamento/)
  assert.match(leer('supabase/functions/send-push-notification/index.ts'), /if \(medicamentoDado\) datos\.medicamentos = \[medicamentoDado\]/)
})

test('5 · "a revisar" tiene una sola definición (columna generada)', () => {
  const sql = leer('supabase/migrations/223_receta_segun_la_wiki.sql')
  assert.match(sql, /add column if not exists rcta_a_revisar boolean\s+generated always as/)
  for (const f of ['supabase/functions/rcta-issue/index.ts', 'supabase/functions/rcta-anular/index.ts', 'src/components/professional/PrescriptionCreator.jsx']) {
    const t = leer(f)
    assert.match(t, /rcta_a_revisar/, f)
    assert.doesNotMatch(t, /rcta_status === 'error' && (Array\.isArray\()?\(?\w+\.rcta_recetas/, `${f} no redefine "a revisar"`)
  }
  // La columna generada no se copia en los inserts de posdatadas.
  assert.match(leer('supabase/functions/rcta-issue/index.ts'), /rcta_a_revisar: _rar/)
})

// ── Revisión de lo nuevo (ronda 4) ───────────────────────────────────────────
test('la simulación nunca emite de más', async () => {
  const iss = leer('supabase/functions/rcta-issue/index.ts')
  assert.match(iss, /if \(firmabase64 && esRechazoDe4xx && !escenario\)/, 'sin reintento sin firma')
  assert.ok(iss.indexOf("code: 'RCTA_SIMULACION_DOS_MEDICAMENTOS'") < iss.indexOf("update({ rcta_status: 'pending' })"))
  // Falla la 2ª sub-emisión: lo que salió vuelve como lote "a revisar".
  let n = 0
  const llamar = async () => (++n === 1
    ? { kind: 'ok', status: 200, data: { idTransaccion: 'T', recetas: [{ id: 'H1', idReceta: '1' }] } }
    : { kind: 'rejected', status: 400, body: 'x', json: { error: 'QBI' } })
  const r = await simularEmision('lote_compartido', { medicamentos: [{ regNo: 'A' }, { regNo: 'B' }] }, llamar)
  assert.equal(r.kind, 'ok')
  const a = asignarRecetas(leerEmision(r.data), [{ id: 'a', reg_no: 'A' }, { id: 'b', reg_no: 'B' }])
  assert.deepEqual(a.sinUbicar.sort(), ['a', 'b'])
  assert.equal(leerEmision(r.data).recetas[0].idReceta, '1', 'la receta real queda guardada')
})

test('anular: candidatas por receta compartida (sin depender de la transacción), sin lo dispensado, y el reintento baja las vigentes', () => {
  const an = leer('supabase/functions/rcta-anular/index.ts')
  assert.doesNotMatch(an, /eq\('rcta_transaction_id', fila\.rcta_transaction_id\)/)
  assert.match(an, /\.in\('rcta_status', \['issued', 'error', 'anulada'\]\)/)
  assert.match(an, /const candidatas = otras\.filter\(c => !compradas\.has\(c\.id\)\)/)
  assert.match(an, /const anulable = \(f: Fila\) => vigente\(f\) \|\| \(reintento && sinConfirmar\(f\)\)/)
  assert.match(an, /const vigentesDelGrupo = grupo\.filter\(vigente\)/)
  assert.match(leer('src/components/professional/PrescriptionCreator.jsx'), /if \(vigente\) setAlcance\(a\)/)
  assert.match(leer('supabase/migrations/223_receta_segun_la_wiki.sql'), /jsonb_typeof\(rcta_recetas\) = 'array'/)
})
