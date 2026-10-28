/**
 * Sentry con lista blanca — control automático (convenio RENAPER, 2026-10-28).
 *
 *   npm run test:sentry        (node --test scripts/test-sentry-sin-datos-personales.mjs)
 *
 * **Por qué existe.** El Manual de Seguridad declara que a Sentry no viaja ningún dato
 * personal. Decisión de Mateo: no se tapa PII en texto libre (cada ronda de revisión
 * encontraba otra forma de fuga); el evento se RECONSTRUYE con una lista blanca:
 * `user.id`, tipo/código/frames de la excepción, breadcrumbs sin texto, request sin
 * query, contexts técnicos y tags nuestros. Este test falla si algo de lo que NO está en
 * esa lista vuelve a salir, o si lo que sí tiene que salir (para poder diagnosticar) se
 * pierde.
 *
 * Tiene tres partes:
 *   1. Unitarias sobre `src/lib/sentryFilter.js`.
 *   2. Un barrido: el mismo dato personal en CADA campo posible del evento.
 *   3. De punta a punta, con el SDK REAL de Sentry y el mismo set de opciones que usa la
 *      app: todos los repro de las rondas de revisión, leídos en el transporte (no se
 *      manda nada a Sentry).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  limpiarEvento, limpiarBreadcrumb, rutaSinQuery, valorSeguro, mensajeSeguro, codigoDe, OPCIONES_PRIVADAS,
  SEGMENTOS_CONOCIDOS, BUCKETS_CONOCIDOS,
} from '../src/lib/sentryFilter.js'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const UID = '6d520ef9-2afe-459c-93a5-e0fa376e63a7'

// Cosas que NO pueden aparecer en nada que salga.
const PROHIBIDAS = [
  'juan.perez@gmail.com', 'maria@healthier.com.ar',
  '12345678', '12.345.678', '30123456', '20-12345678-9', '27123456789',
  '+54 9 11 5555-1234', '11 5555-1234', '5491155551234',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', 'sb_secret_abcdefghijklmnop',
  'Juan Pérez', 'Juan', 'Flaco', 'iPhone de Mateo', 'Av. Santa Fe 1234', 'Av Santa Fe 1234', 'Av Libertador 4500',
  'calle-secreta', 'SECRETO',
]
const sinFugas = (valor, etiqueta = '') => {
  const salida = typeof valor === 'string' ? valor : JSON.stringify(valor)
  for (const p of PROHIBIDAS) assert.ok(!salida.includes(p), `${etiqueta} se coló "${p}" en: ${salida.slice(0, 500)}`)
}

// ── 1. Piezas ───────────────────────────────────────────────────────────────
test('el value de una excepción nunca es el mensaje: literal conocido, código o clase', () => {
  // literales conocidos y patrones de identificadores: se conservan
  assert.equal(valorSeguro('TypeError', 'Failed to fetch'), 'Failed to fetch')
  assert.equal(valorSeguro('TypeError', "Cannot read properties of undefined (reading 'map')"), "Cannot read properties of undefined (reading 'map')")
  assert.equal(valorSeguro('ReferenceError', 'foo is not defined'), 'foo is not defined')
  // un "reading" con un dato no es un identificador: no se conserva
  assert.equal(valorSeguro('TypeError', "Cannot read properties of undefined (reading 'juan.perez@gmail.com')"), 'TypeError')
  // códigos
  assert.equal(valorSeguro('Error', 'Failing row contains (1, {"nombre": "Juan Pérez", "dir": "Av Santa Fe 1234"}, null).'), '23502')
  assert.equal(valorSeguro('Error', 'Key (full_name)=(Juan Pérez) already exists. duplicate key value violates unique constraint "x"'), '23505')
  assert.equal(valorSeguro('Error', 'invalid input syntax for type uuid: "juan.perez@gmail.com"'), '22P02')
  assert.equal(valorSeguro('Error', 'invalid input syntax for type integer: "30123456"'), '22P02')
  assert.equal(valorSeguro('Error', 'JSON object requested, multiple (or no) rows returned'), 'PGRST116')
  assert.equal(valorSeguro('Error', 'Request failed: HTTP 409 para Juan Pérez'), '409')
  assert.equal(valorSeguro('Error', '{"code":"PGRST116","message":"Juan Pérez"}'), 'PGRST116')
  // sin código: el nombre de la clase
  assert.equal(valorSeguro('Error', 'No se pudo guardar el perfil de Juan Pérez (DNI 12345678)'), 'Error')
  assert.equal(valorSeguro('ValidationError', undefined), 'ValidationError')
  // un código explícito (de extra.__serialized__) gana
  assert.equal(valorSeguro('Error', 'cualquier cosa de Juan', '23503'), '23503')
})

test('captureMessage: sólo un literal conocido o un código; si no, "[mensaje]"', () => {
  assert.equal(mensajeSeguro('Failed to fetch'), 'Failed to fetch')
  assert.equal(mensajeSeguro('El paciente Juan Pérez pagó 12345678'), '[mensaje]')
  assert.equal(mensajeSeguro('PGRST116 para Juan'), 'PGRST116')
  assert.equal(mensajeSeguro(undefined), '[mensaje]')
  assert.equal(codigoDe('nada que ver'), undefined)
})

test('URLs con lista blanca: sólo segmentos conocidos o UUID; el resto ":dato"; el storage se corta en el bucket', () => {
  // la query y el fragmento nunca viajan
  assert.equal(rutaSinQuery('https://x.supabase.co/rest/v1/profiles?email=eq.juan.perez@gmail.com&select=*'), 'https://x.supabase.co/rest/v1/profiles')
  assert.equal(rutaSinQuery('https://www.healthier.com.ar/auth#access_token=eyJabc&type=magiclink'), 'https://www.healthier.com.ar/auth')
  // la API y las rutas de la app se conservan
  assert.equal(rutaSinQuery('https://x.supabase.co/rest/v1/rpc/buscar_profesionales_cobrables'), 'https://x.supabase.co/rest/v1/rpc/buscar_profesionales_cobrables')
  assert.equal(rutaSinQuery('https://x.supabase.co/functions/v1/send-email'), 'https://x.supabase.co/functions/v1/send-email')
  assert.equal(rutaSinQuery(`/paciente/consulta/${UID}`), `/paciente/consulta/${UID}`)
  assert.equal(rutaSinQuery('/paciente/perfil'), '/paciente/perfil')
  // repro de la revisión: el storage lleva el nombre del archivo del usuario
  assert.equal(rutaSinQuery(`https://x.supabase.co/storage/v1/object/patient-docs/${UID}/1730000000000_Juan_Perez_VIH_positivo.pdf`),
    'https://x.supabase.co/storage/v1/object/patient-docs')
  assert.equal(rutaSinQuery(`https://x.supabase.co/storage/v1/object/sign/patient-docs/${UID}/estudio_Juan_Perez.pdf?token=eyJabc`),
    'https://x.supabase.co/storage/v1/object/sign/patient-docs')
  assert.equal(rutaSinQuery(`https://x.supabase.co/storage/v1/object/public/avatars/${UID}/foto.png`), 'https://x.supabase.co/storage/v1/object/public/avatars')
  assert.equal(rutaSinQuery(`https://x.supabase.co/storage/v1/render/image/public/avatars/${UID}/foto.png`), 'https://x.supabase.co/storage/v1/render/image/public/avatars')
  assert.equal(rutaSinQuery('https://x.supabase.co/storage/v1/object/un-bucket-que-no-existe/archivo.pdf'), 'https://x.supabase.co/storage/v1/object/:dato')
  // repro de la revisión: DNI con puntos, CUIT con guiones, teléfono con +, mail, nombre
  assert.equal(rutaSinQuery('/x/12.345.678'), '/:dato/:dato')
  assert.equal(rutaSinQuery('/x/20-12345678-9'), '/:dato/:dato')
  assert.equal(rutaSinQuery('/x/+5491155551234'), '/:dato/:dato')
  assert.equal(rutaSinQuery('/paciente/buscar/juan.perez@gmail.com'), '/paciente/buscar/:dato')
  assert.equal(rutaSinQuery('/profesional/paciente/30123456'), '/profesional/paciente/:dato')
  assert.equal(rutaSinQuery('/paciente/Juan%20P%C3%A9rez'), '/paciente/:dato')
  // un host con forma rara o con usuario no viaja
  assert.equal(rutaSinQuery('https://juan.perez@gmail.com:clave@x.supabase.co/rest/v1/profiles'), 'https://x.supabase.co/rest/v1/profiles')
  assert.equal(rutaSinQuery('https://Juan Pérez/rest/v1/profiles'), 'https://:host/rest/v1/profiles')
  assert.equal(rutaSinQuery(''), undefined)
  assert.equal(rutaSinQuery(undefined), undefined)
})

test('la lista de segmentos conocidos incluye las rutas, funciones y buckets reales del proyecto', () => {
  const app = readFileSync(join(raiz, 'src/App.jsx'), 'utf8')
  const rutas = new Set()
  for (const m of app.matchAll(/path=["']([^"']+)["']/g)) for (const seg of m[1].split('/')) if (seg && !seg.startsWith(':') && seg !== '*') rutas.add(seg)
  const faltan = [...rutas].filter((x) => !SEGMENTOS_CONOCIDOS.has(x))
  assert.deepEqual(faltan, [], `rutas de App.jsx que faltan en SEGMENTOS_CONOCIDOS (regenerá la lista, en la web y en la app): ${faltan.join(', ')}`)
  const funciones = readdirSync(join(raiz, 'supabase/functions'), { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('_')).map((d) => d.name)
  const sinFuncion = funciones.filter((x) => !SEGMENTOS_CONOCIDOS.has(x))
  assert.deepEqual(sinFuncion, [], `Edge Functions que faltan en SEGMENTOS_CONOCIDOS: ${sinFuncion.join(', ')}`)
  const migraciones = readdirSync(join(raiz, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).map((f) => readFileSync(join(raiz, 'supabase/migrations', f), 'utf8')).join('\n')
  const buckets = new Set([...migraciones.matchAll(/bucket_id\s*=\s*'([a-z0-9_-]+)'/gi)].map((m) => m[1]))
  const sinBucket = [...buckets].filter((b) => !BUCKETS_CONOCIDOS.has(b))
  assert.deepEqual(sinBucket, [], `buckets que faltan en BUCKETS_CONOCIDOS: ${sinBucket.join(', ')}`)
  const tablas = new Set([...migraciones.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z][a-z0-9_]*)"?/gi)].map((m) => m[1]).filter((n) => !n.startsWith('_')))
  const sinTabla = [...tablas].filter((x) => !SEGMENTOS_CONOCIDOS.has(x))
  assert.deepEqual(sinTabla, [], `tablas que faltan en SEGMENTOS_CONOCIDOS: ${sinTabla.join(', ')}`)
})

test('breadcrumbs: sin texto ni datos; sólo ruta sin query, método y estado en navegación y red', () => {
  const cons = limpiarBreadcrumb({ category: 'console', level: 'error', timestamp: 1, message: 'login juan.perez@gmail.com', data: { arguments: [30123456, { name: 'Juan Pérez', calle: 'Av. Santa Fe 1234' }], logger: 'console' } })
  assert.deepEqual(cons, { category: 'console', level: 'error', timestamp: 1 })
  const clic = limpiarBreadcrumb({ category: 'ui.click', level: 'info', timestamp: 2, message: 'input[value="12.345.678"] > button "Juan Pérez"' })
  assert.deepEqual(clic, { category: 'ui.click', level: 'info', timestamp: 2 })
  const fetchB = limpiarBreadcrumb({ category: 'fetch', type: 'http', level: 'info', timestamp: 3, data: { url: 'https://x.supabase.co/rest/v1/profiles?dni=eq.12345678', method: 'get', status_code: 200, body: { dni: '12345678' }, request_body_size: 10 } })
  assert.deepEqual(fetchB, { category: 'fetch', type: 'http', level: 'info', timestamp: 3, data: { url: 'https://x.supabase.co/rest/v1/profiles', method: 'GET', status_code: 200 } })
  const nav = limpiarBreadcrumb({ category: 'navigation', timestamp: 4, data: { from: '/paciente/perfil?mail=juan.perez@gmail.com', to: '/paciente/consultas/30123456?phone=%2B5491155551234#x' } })
  assert.deepEqual(nav, { category: 'navigation', timestamp: 4, data: { from: '/paciente/perfil', to: '/paciente/consultas/:dato' } })
  const storage = limpiarBreadcrumb({ category: 'xhr', type: 'http', timestamp: 5, data: { url: `https://x.supabase.co/storage/v1/object/patient-docs/${UID}/1730000000000_Juan_Perez_VIH_positivo.pdf`, method: 'POST', status_code: 200 } })
  assert.deepEqual(storage.data, { url: 'https://x.supabase.co/storage/v1/object/patient-docs', method: 'POST', status_code: 200 })
  sinFugas(storage, 'storage')
  assert.equal(limpiarBreadcrumb(undefined), undefined)
})

function eventoSucio() {
  return {
    event_id: 'a'.repeat(32), timestamp: 1793208573.5, platform: 'javascript', level: 'error', environment: 'staging', release: 'abc1234',
    sdk: { name: 'sentry.javascript.react', version: '10.72.0' },
    message: 'Falló el pago de juan.perez@gmail.com (DNI 12345678)',
    logentry: { message: 'login de Juan Pérez', params: ['juan.perez@gmail.com'] },
    server_name: 'iPhone de Mateo',
    user: { id: UID, email: 'juan.perez@gmail.com', username: 'Juan Pérez', ip_address: '190.1.2.3', segment: 'vip' },
    exception: { values: [{
      type: 'Error',
      value: 'No existe la cuenta maria@healthier.com.ar con CUIT 20-12345678-9. Failing row contains (1, Juan Pérez, Av. Santa Fe 1234)',
      mechanism: { type: 'onerror', handled: false, data: { dni: '12345678' } },
      stacktrace: { frames: [{
        filename: 'https://www.healthier.com.ar/assets/index.js?v=1&mail=juan.perez@gmail.com', function: 'guardarPerfil', lineno: 10, colno: 5, in_app: true,
        vars: { email: 'juan.perez@gmail.com' }, context_line: 'const dni = "12345678"', pre_context: ['// Juan Pérez'], post_context: ['x'],
      }] },
    }] },
    request: {
      url: 'https://www.healthier.com.ar/paciente/perfil?email=juan.perez@gmail.com#token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', method: 'post',
      data: { dni: '12345678' }, cookies: { sb: 'x' }, headers: { Authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' }, query_string: 'email=juan.perez@gmail.com',
    },
    transaction: '/paciente/perfil?dni=12345678',
    // (repro de la revisión final) un pedido al storage con el nombre del archivo en la ruta
    breadcrumbs: [{ category: 'console', level: 'error', timestamp: 1, message: 'login juan.perez@gmail.com', data: { arguments: [30123456, { name: 'Juan Pérez', calle: 'Av. Santa Fe 1234' }] } }],
    extra: { form: { email: 'juan.perez@gmail.com', dni: '12345678' }, 'juan.perez@gmail.com': 'clave que es un mail', 30123456: 'clave que es un DNI' },
    tags: { cuit: '20-12345678-9', canal: 'staging', pantalla: 'perfil', email: 'juan.perez@gmail.com' },
    contexts: {
      device: { name: 'iPhone de Mateo', model: 'iPhone15,2', device_unique_identifier: 'ABC', simulator: false, timezone: 'America/Argentina/Buenos_Aires' },
      os: { name: 'iOS', version: '26.1' }, browser: { name: 'Chrome', version: '141' },
      user: { email: 'juan.perez@gmail.com' }, paciente: { nombre: 'Juan Pérez' }, react: { componentStack: 'at Perfil\n at App' },
    },
    spans: [{ span_id: 's1', trace_id: 't1', op: 'http.client', description: 'GET https://x.supabase.co/rest/v1/profiles?email=eq.juan.perez@gmail.com', data: { 'http.query': 'email=juan.perez@gmail.com' }, start_timestamp: 1, timestamp: 2 },
      { span_id: 's2', trace_id: 't1', op: 'ui.interaction.click', description: 'button "Juan Pérez"' }],
  }
}

test('la forma del evento que sale: todo lo permitido llega, nada de lo demás', () => {
  const e = limpiarEvento(eventoSucio())
  sinFugas(e, 'evento')
  // llega
  assert.deepEqual(e.user, { id: UID })
  assert.equal(e.exception.values[0].type, 'Error')
  assert.equal(e.exception.values[0].value, '23502', 'value = el código, no el mensaje')
  assert.deepEqual(e.exception.values[0].mechanism, { type: 'onerror', handled: false })
  assert.deepEqual(e.exception.values[0].stacktrace.frames[0], { function: 'guardarPerfil', lineno: 10, colno: 5, in_app: true, filename: 'https://www.healthier.com.ar/assets/index.js' })
  assert.deepEqual(e.request, { url: 'https://www.healthier.com.ar/paciente/perfil', method: 'POST' })
  assert.equal(e.transaction, '/paciente/perfil')
  assert.equal(e.message, '[mensaje]')
  assert.deepEqual(e.logentry, { message: '[mensaje]' })
  assert.deepEqual(e.breadcrumbs, [{ category: 'console', level: 'error', timestamp: 1 }])
  assert.deepEqual(e.contexts, { device: { model: 'iPhone15,2', simulator: false }, os: { name: 'iOS', version: '26.1' }, browser: { name: 'Chrome', version: '141' } })
  assert.deepEqual(e.tags, { canal: 'staging' })
  assert.equal(e.event_id, 'a'.repeat(32))
  assert.equal(e.release, 'abc1234')
  assert.deepEqual(e.spans[0], { span_id: 's1', trace_id: 't1', op: 'http.client', start_timestamp: 1, timestamp: 2, description: 'GET https://x.supabase.co/rest/v1/profiles' })
  assert.deepEqual(e.spans[1], { span_id: 's2', trace_id: 't1', op: 'ui.interaction.click' })
  // no llega
  for (const k of ['extra', 'server_name']) assert.ok(!(k in e), k)
  for (const k of ['data', 'cookies', 'headers', 'query_string']) assert.ok(!(k in e.request), `request.${k}`)
  for (const k of ['vars', 'context_line', 'pre_context', 'post_context']) assert.ok(!(k in e.exception.values[0].stacktrace.frames[0]), k)
})

test('un user.id que no es un UUID (un mail, un DNI) no viaja', () => {
  for (const id of ['juan.perez@gmail.com', '30123456', 'Juan Pérez', '']) assert.ok(!('user' in limpiarEvento({ user: { id } })), id)
  assert.deepEqual(limpiarEvento({ user: { id: UID } }).user, { id: UID })
})

test('el código del error de la base llega aunque el mensaje no lo traiga (extra.__serialized__)', () => {
  const e = limpiarEvento({ exception: { values: [{ type: 'Error', value: 'Object captured as exception with keys: code, details, hint, message' }] }, extra: { __serialized__: { code: '23505', details: 'Failing row contains (Juan Pérez)', hint: null, message: 'Juan Pérez' } } })
  sinFugas(e, 'serializado')
  assert.equal(e.exception.values[0].value, '23505')
})

test('un evento mínimo o raro no rompe el filtro', () => {
  for (const e of [{}, { message: 'hola' }, { exception: {} }, { exception: { values: [null, {}] } }, { breadcrumbs: [null, 1, 'x'] }, { contexts: { device: 'x' } }, { spans: [null] }]) {
    assert.doesNotThrow(() => limpiarEvento(e), JSON.stringify(e))
  }
  assert.equal(limpiarEvento(null), null)
})

// ── 2. Barrido: el mismo dato personal en CADA campo posible ────────────────
test('barrido: SECRETO puesto en cualquier campo del evento (permitido o no) no sale', () => {
  const S = 'Juan SECRETO 30123456 juan.perez@gmail.com'
  const evento = {
    event_id: 'b'.repeat(32),
    message: S, logentry: { message: S, params: [S] }, server_name: S, culture: { locale: S }, modules: { [S]: S },
    user: { id: S, email: S, username: S, ip_address: S, name: S, geo: { city: S } },
    exception: { values: [{
      type: S, value: S, module: S,
      mechanism: { type: S, handled: S, data: { [S]: S }, description: S },
      stacktrace: { frames: [{ filename: S, abs_path: S, function: S, module: S, vars: { [S]: S }, context_line: S, pre_context: [S], post_context: [S], lineno: 1, colno: 2 }] },
    }] },
    threads: { values: [{ id: 1, name: S, stacktrace: { frames: [{ function: S, filename: S, vars: { a: S } }] } }] },
    request: { url: `https://x/${S}?q=${S}#${S}`, method: S, headers: { [S]: S }, cookies: { [S]: S }, data: S, query_string: S, env: { a: S } },
    transaction: S, transaction_info: { source: 'route' },
    breadcrumbs: [{ category: S, type: S, level: S, message: S, timestamp: 1, data: { url: S, from: S, to: S, method: S, [S]: S, arguments: [S, { [S]: S }] } },
      { category: 'navigation', data: { from: S, to: S } }, { category: 'fetch', data: { url: S, method: S, status_code: S } },
      { category: 'console', message: S, data: { arguments: [S] } }, { category: 'ui.click', message: S }],
    extra: { [S]: S, a: { b: [S] } },
    tags: { [S]: S, email: S, pantalla: S },
    contexts: { device: { name: S, model: S, device_unique_identifier: S, [S]: S }, os: { name: S }, app: { app_name: S, device_app_hash: S }, trace: { trace_id: S }, [S]: { [S]: S }, react: { componentStack: S }, user: { email: S }, culture: { locale: S, timezone: S } },
    spans: [{ span_id: S, op: S, description: S, data: { [S]: S } }, { op: 'http.client', description: `GET https://x/${S}?q=${S}` }],
    fingerprint: [S],
  }
  const salida = limpiarEvento(evento)
  const texto = JSON.stringify(salida)
  assert.ok(!texto.includes('SECRETO'), `se coló: ${texto.slice(0, 600)}`)
  for (const p of ['30123456', 'juan.perez@gmail.com']) assert.ok(!texto.includes(p), `se coló ${p}: ${texto.slice(0, 600)}`)
})

// ── 3. Configuración de Sentry.init ─────────────────────────────────────────
test('las opciones privadas están completas', () => {
  assert.equal(OPCIONES_PRIVADAS.sendDefaultPii, false)
  for (const hook of ['beforeSend', 'beforeSendTransaction', 'beforeBreadcrumb']) assert.equal(typeof OPCIONES_PRIVADAS[hook], 'function', hook)
})

test('src/lib/sentry.js usa las opciones privadas y no habilita replay ni feedback sin máscara', () => {
  const src = readFileSync(join(raiz, 'src/lib/sentry.js'), 'utf8')
  assert.match(src, /\.\.\.OPCIONES_PRIVADAS/, 'Sentry.init tiene que esparcir OPCIONES_PRIVADAS')
  if (/replayIntegration|feedbackIntegration/.test(src)) {
    assert.match(src, /maskAllText:\s*true/)
    assert.match(src, /maskAllInputs:\s*true/)
    assert.match(src, /blockAllMedia:\s*true/)
  }
})

// ── 5. El filtro de la web y el de la app son EL MISMO código ───────────────
// `mobile/src/lib/sentryFilter.ts` (sin tipos) tiene que ser idéntico a este archivo. Cada repo
// guarda el hash de referencia: si alguien toca el filtro en un lado y no en el otro, el test
// falla en ese repo. Para cambiar el filtro: editá el .ts de la app, generá el .js con
// `stripTypeScriptTypes(ts, { mode: 'strip' })` (node:module), copialo acá y poné el hash nuevo
// en los DOS tests.
const HASH_FILTRO = '0a3c40bb6e6a23c9e40276c084e5489c645fb2d3da779867883ee1347ca10f0e'
test('el filtro de la web coincide con la referencia compartida con la app (hash)', async () => {
  const { createHash } = await import('node:crypto')
  const actual = createHash('sha256').update(readFileSync(join(raiz, 'src/lib/sentryFilter.js'))).digest('hex')
  assert.equal(actual, HASH_FILTRO, `src/lib/sentryFilter.js cambió (sha256 ${actual}). Pasá el MISMO cambio a mobile/src/lib/sentryFilter.ts y actualizá HASH_FILTRO en los tests de los dos repos.`)
})

// ── 4. Punta a punta: SDK real, todos los repro de las rondas, transporte interceptado ──
test('SDK real: los repro de las rondas salen SIN datos personales y con id, tipo, código y frames', async () => {
  const Sentry = await import('@sentry/react')
  const enviados = []
  Sentry.init({
    dsn: 'https://publica@o0.ingest.sentry.io/1', environment: 'test', release: 'test', tracesSampleRate: 0, maxBreadcrumbs: 50,
    ...OPCIONES_PRIVADAS,
    transport: () => ({ send: async (envelope) => { enviados.push(JSON.stringify(envelope)); return { statusCode: 200 } }, flush: async () => true }),
  })
  Sentry.setUser({ id: UID, email: 'juan.perez@gmail.com', username: 'Juan Pérez', ip_address: '1.2.3.4' })
  Sentry.setTag('email', 'juan.perez@gmail.com')
  Sentry.setTag('canal', 'staging')
  Sentry.setExtra('dni', '30123456')
  Sentry.setContext('paciente', { nombre: 'Juan Pérez', calle: 'calle-secreta' })

  // Breadcrumbs: datos en argumentos de consola (número, objeto con nombre y calle), JSON truncado a 250 por Sentry, fetch con query
  console.error('falló el guardado', 30123456, { name: 'Juan Pérez', calle: 'Av. Santa Fe 1234' })
  console.error(JSON.stringify({ code: '23502', details: `Failing row contains (${'x'.repeat(40)}, Juan Pérez, Av Santa Fe 1234, ${'y'.repeat(300)})`, hint: null }))
  console.warn('PostgrestError', 'Key (full_name)=(Juan Pérez) already exists.')
  Sentry.addBreadcrumb({ category: 'fetch', type: 'http', data: { url: 'https://x.supabase.co/rest/v1/profiles?dni=eq.12345678&email=eq.juan.perez@gmail.com', method: 'GET', status_code: 400 } })
  Sentry.addBreadcrumb({ category: 'ui.click', message: 'button.guardar "Juan Pérez" [value=12.345.678]' })

  const errores = [
    // 1. Failing row con columna jsonb y comillas
    new Error('Failing row contains (1, {"nombre": "Juan Pérez", "dir": "Av Santa Fe 1234"}, null).'),
    new Error('Failing row contains (1, Juan "Flaco", Av Libertador 4500, null).'),
    // 2. Key(...) doble serializado
    new Error(JSON.stringify({ body: JSON.stringify({ message: 'Key (full_name)=(Juan Pérez)', code: '23505' }), status: 400 })),
    // 3. 22P02 que eco-a el valor, con un mail y con un DNI
    new Error('invalid input syntax for type uuid: "juan.perez@gmail.com"'),
    new Error('invalid input syntax for type integer: "30123456"'),
    // 4. mensaje libre con datos y objeto con claves de mail/DNI
    new Error('No se pudo guardar el perfil de Juan Pérez (DNI 12345678, +54 9 11 5555-1234, juan.perez@gmail.com)'),
  ]
  for (const err of errores) Sentry.captureException(err)
  Sentry.captureException({ code: '23505', details: 'Failing row contains (Juan Pérez)', hint: 'Av Santa Fe 1234', message: 'Juan Pérez', 'juan.perez@gmail.com': 1, 30123456: 2 })
  Sentry.captureMessage('El paciente Juan Pérez (DNI 12345678) pagó')
  Sentry.captureMessage('Failed to fetch')
  await Sentry.flush(3000)

  // Cada sobre es [cabecera, [[cabecera del ítem, evento], …]]
  const eventos = enviados.flatMap((e) => JSON.parse(e)[1].map((item) => item[1])).filter((x) => x && (x.exception || x.message || x.logentry))
  assert.ok(eventos.length >= 8, `llegaron ${eventos.length} eventos`)

  // Lo que sale: ninguna cadena personal en NINGÚN lugar del sobre
  sinFugas(enviados.join('\n'), 'sobre completo')

  // Y lo que tiene que llegar para diagnosticar
  const todo = JSON.stringify(eventos)
  assert.ok(todo.includes(`"user":{"id":"${UID}"}`), 'el id del usuario llega')
  const valores = eventos.flatMap((e) => (e.exception?.values ?? []).map((v) => v.value))
  for (const codigo of ['23502', '23505', '22P02']) assert.ok(valores.includes(codigo), `el código ${codigo} llega como value (${valores.join(', ')})`)
  assert.ok(eventos.some((e) => e.exception?.values?.[0]?.type === 'Error'), 'el type llega')
  const frames = eventos.find((e) => e.exception?.values?.[0]?.stacktrace)?.exception.values[0].stacktrace.frames
  assert.ok(frames?.length && frames.every((f) => 'lineno' in f || 'function' in f || 'filename' in f), 'los frames llegan')
  assert.ok(frames.every((f) => !('vars' in f) && !('context_line' in f)), 'frames sin vars ni contexto de código')
  const mensajes = eventos.map((e) => e.message).filter(Boolean)
  assert.ok(mensajes.includes('[mensaje]') && mensajes.includes('Failed to fetch'), `captureMessage: ${mensajes.join(' | ')}`)
  const bc = eventos.find((e) => e.breadcrumbs?.length)?.breadcrumbs ?? []
  assert.ok(bc.some((b) => b.category === 'console'), 'queda constancia de que hubo un log (sin texto)')
  assert.ok(bc.some((b) => b.category === 'fetch' && b.data?.status_code === 400 && b.data?.url === 'https://x.supabase.co/rest/v1/profiles'), 'el fetch llega con ruta sin query y estado')
  assert.ok(bc.every((b) => !('message' in b)), 'ningún breadcrumb lleva texto')
  assert.deepEqual(eventos.find((e) => e.tags)?.tags, { canal: 'staging' }, 'sólo los tags nuestros')
  console.log(`  ${eventos.length} eventos revisados en el transporte; values: ${[...new Set(valores)].join(', ')}`)
})
