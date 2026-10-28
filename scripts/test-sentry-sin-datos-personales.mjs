/**
 * Sentry sin datos personales — control automático (convenio RENAPER, 2026-10-28).
 *
 *   npm run test:sentry        (node --test scripts/test-sentry-sin-datos-personales.mjs)
 *
 * **Por qué existe.** El Manual de Seguridad declara que a Sentry no viaja ningún
 * dato personal. Este test falla si un evento con mail, DNI, CUIT, teléfono, token
 * o datos del usuario sale sin enmascarar, o si alguien saca los filtros de
 * `Sentry.init`.
 *
 * Tiene dos mitades:
 *   1. Unitarias sobre `src/lib/sentryFilter.js` (cada tipo de dato, cada lugar del
 *      evento donde puede aparecer).
 *   2. De punta a punta: un SDK real de Sentry, con el MISMO set de opciones que
 *      usa la app, captura un error forzado con un mail y un DNI en el mensaje y la
 *      salida se lee en el transporte (no se manda nada a Sentry).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  limpiarTexto, limpiarUrl, limpiarEvento, limpiarBreadcrumb, OPCIONES_PRIVADAS,
} from '../src/lib/sentryFilter.js'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')

// Cosas que NO pueden aparecer en nada que salga.
const PROHIBIDAS = [
  'juan.perez@gmail.com', 'maria@healthier.com.ar',
  '12345678', '12.345.678', '30123456',
  '20-12345678-9', '27123456789',
  '+54 9 11 5555-1234', '11 5555-1234', '5491155551234',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
  'sb_secret_abcdefghijklmnop',
  'Juan Pérez', 'iPhone de Mateo', 'Av. Santa Fe 1234',
]

const sinFugas = (valor, etiqueta = '') => {
  const salida = JSON.stringify(valor)
  for (const p of PROHIBIDAS) {
    assert.ok(!salida.includes(p), `${etiqueta} se coló "${p}" en: ${salida.slice(0, 400)}`)
  }
}

// ── 1. Texto ────────────────────────────────────────────────────────────────
test('mails, DNI, CUIT, teléfonos y tokens se enmascaran en un texto', () => {
  const casos = [
    ['falló el login de juan.perez@gmail.com', '[email]'],
    ['paciente DNI 12345678 no encontrado', '[dni]'],
    ['paciente 12.345.678', '[dni]'],
    ['cuit 20-12345678-9 inválido', '[cuit]'],
    ['cuil 27123456789', '[cuit]'],
    ['llamar a +54 9 11 5555-1234', '[teléfono]'],
    ['tel 11 5555-1234', '[teléfono]'],
    ['whatsapp 5491155551234', '[número]'],
    ['token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U', '[token]'],
    ['Authorization: Bearer abc.def-ghi_123', 'Bearer [token]'],
    ['apikey=sb_secret_abcdefghijklmnop&x=1', '[token]'],
    ['password: "hunter22"', '[token]'],
  ]
  for (const [entrada, esperado] of casos) {
    const salida = limpiarTexto(entrada)
    assert.ok(salida.includes(esperado), `"${entrada}" → "${salida}" (esperaba ${esperado})`)
    sinFugas(salida, entrada)
  }
})

test('lo que NO es un dato personal se conserva', () => {
  const intactos = [
    'Cannot read properties of undefined (reading \'map\')',
    'GET /rest/v1/consultations 400',
    'consulta 6d520ef9-2afe-459c-93a5-e0fa376e63a7 sin pago',
    'usuario 12345678-1234-4234-8234-123456789012 no encontrado',  // grupo de 8 dígitos dentro de un uuid
    'ts 1793208573515',
    'creado 2026-10-28T17:29:41.651Z',
    'versión 1.1.3 build 214',
    'línea 482 columna 17',
  ]
  for (const t of intactos) assert.equal(limpiarTexto(t), t)
})

test('las URLs pierden query string y fragmento', () => {
  assert.equal(limpiarUrl('https://x.supabase.co/rest/v1/profiles?email=eq.juan.perez@gmail.com&select=*'),
    'https://x.supabase.co/rest/v1/profiles')
  assert.equal(limpiarUrl('https://www.healthier.com.ar/auth#access_token=eyJabcde.fghij.klmno&type=magiclink'),
    'https://www.healthier.com.ar/auth')
})

// ── 2. Eventos ──────────────────────────────────────────────────────────────
function eventoSucio() {
  return {
    event_id: 'a'.repeat(32),
    message: 'Falló el pago de juan.perez@gmail.com (DNI 12345678)',
    server_name: 'iPhone de Mateo',
    user: {
      id: '6d520ef9-2afe-459c-93a5-e0fa376e63a7', email: 'juan.perez@gmail.com',
      username: 'Juan Pérez', ip_address: '190.1.2.3', segment: 'vip',
    },
    exception: { values: [{
      type: 'Error',
      value: 'No existe la cuenta maria@healthier.com.ar con CUIT 20-12345678-9',
      stacktrace: { frames: [{ filename: 'https://www.healthier.com.ar/assets/index.js?v=1', function: 'f', lineno: 10, vars: { email: 'juan.perez@gmail.com' } }] },
    }] },
    request: {
      url: 'https://www.healthier.com.ar/paciente/perfil?email=juan.perez@gmail.com#token=eyJabcde.fghij.klmno',
      method: 'POST',
      data: { dni: '12345678', nombre: 'Juan Pérez' },
      cookies: { sb: 'x' },
      headers: { Authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U' },
      query_string: 'email=juan.perez@gmail.com',
    },
    transaction: '/paciente/perfil?dni=12345678',
    breadcrumbs: [
      { category: 'console', message: 'login juan.perez@gmail.com' },
      { category: 'fetch', data: { url: 'https://x.supabase.co/rest/v1/profiles?dni=eq.12345678', method: 'GET', status_code: 200, body: { dni: '12345678' } } },
      { category: 'navigation', data: { from: '/a?mail=juan.perez@gmail.com', to: '/b?phone=%2B5491155551234' } },
      { category: 'ui.click', message: 'input[value="12.345.678"]' },
    ],
    extra: { form: { email: 'juan.perez@gmail.com', dni: '12345678', phone: '+54 9 11 5555-1234', detalle: 'DNI 30123456' }, token: 'sb_secret_abcdefghijklmnop' },
    tags: { cuit: '20-12345678-9', pantalla: 'perfil' },
    contexts: {
      device: { name: 'iPhone de Mateo', model: 'iPhone15,2', device_unique_identifier: 'ABC' },
      os: { name: 'iOS', version: '26.1' },
      user: { email: 'juan.perez@gmail.com' },
    },
    spans: [{ description: 'GET https://x.supabase.co/rest/v1/profiles?email=eq.juan.perez@gmail.com', data: { 'http.query': 'email=juan.perez@gmail.com' } }],
  }
}

test('un evento con datos personales en cualquier lugar sale enmascarado', () => {
  const e = limpiarEvento(eventoSucio())
  sinFugas(e, 'evento')

  // Usuario: sólo el id
  assert.deepEqual(e.user, { id: '6d520ef9-2afe-459c-93a5-e0fa376e63a7' })
  // Request: sin cuerpo, cookies, headers ni query string; URL sin query ni fragmento
  assert.equal(e.request.url, 'https://www.healthier.com.ar/paciente/perfil')
  for (const k of ['data', 'cookies', 'headers', 'query_string']) assert.ok(!(k in e.request), `request.${k}`)
  // Breadcrumbs
  assert.equal(e.breadcrumbs[1].data.url, 'https://x.supabase.co/rest/v1/profiles')
  assert.ok(!('body' in e.breadcrumbs[1].data), 'cuerpo del fetch')
  assert.equal(e.breadcrumbs[2].data.from, '/a')
  assert.equal(e.breadcrumbs[2].data.to, '/b')
  // Contexto del dispositivo: el modelo se conserva, el nombre no
  assert.equal(e.contexts.device.model, 'iPhone15,2')
  assert.ok(!('name' in e.contexts.device))
  assert.equal(e.contexts.os.name, 'iOS')
  // Valores locales de las frames
  assert.ok(!('vars' in e.exception.values[0].stacktrace.frames[0]))
  // Lo que no es personal queda
  assert.equal(e.tags.pantalla, 'perfil')
  assert.equal(e.exception.values[0].type, 'Error')
  assert.equal(e.event_id, 'a'.repeat(32))
})

test('un user.id que es un mail también se enmascara', () => {
  const e = limpiarEvento({ user: { id: 'juan.perez@gmail.com' } })
  assert.deepEqual(e.user, { id: '[email]' })
})

test('un evento sin user, request ni breadcrumbs no se rompe', () => {
  assert.doesNotThrow(() => limpiarEvento({ message: 'hola' }))
  assert.doesNotThrow(() => limpiarEvento({}))
  assert.equal(limpiarEvento(null), null)
  assert.doesNotThrow(() => limpiarBreadcrumb(undefined))
})

test('objetos circulares y muy profundos no cuelgan el filtro', () => {
  const a = { email: 'juan.perez@gmail.com' }
  a.yo = a
  let hondo = {}
  const raizHonda = hondo
  for (let i = 0; i < 30; i++) { hondo.n = {}; hondo = hondo.n }
  hondo.dato = 'maria@healthier.com.ar'
  const e = limpiarEvento({ extra: { a, hondo: raizHonda } })
  sinFugas(e, 'circular/profundo')
})

// ── 2b. Errores de la base: la FILA que falló es un dato personal ───────────
test('los details/hint de Postgres y "Failing row contains" se esconden enteros', () => {
  const fila = 'Failing row contains (6d520ef9-2afe-459c-93a5-e0fa376e63a7, Juan Pérez, Av. Santa Fe 1234, null, t)'
  // 1. texto suelto (breadcrumb de consola)
  const texto = limpiarTexto(`falló el alta: null value in column "x" violates not-null constraint. ${fila}.`)
  sinFugas(texto, 'texto suelto')
  assert.match(texto, /violates not-null constraint/, 'el mensaje del error se conserva')
  // 2. rejection serializada como JSON
  const json = JSON.stringify({ code: '23502', details: fila, hint: 'Revisá a Juan Pérez', message: 'null value in column "x"' })
  const limpio = limpiarTexto(json)
  sinFugas(limpio, 'JSON serializado')
  assert.match(limpio, /"code":"23502"/)
  assert.match(limpio, /null value in column/)
  assert.doesNotThrow(() => JSON.parse(limpio), 'el JSON sigue siendo JSON')
  // 3. objeto con details/hint como claves (extra, data de breadcrumb, contextos)
  const evento = limpiarEvento({
    extra: { error: { code: '23505', details: fila, hint: 'Av. Santa Fe 1234', message: 'duplicate key' } },
    breadcrumbs: [{ category: 'console', message: `PostgrestError ${fila}`, data: { arguments: [{ details: fila }] } }],
  })
  sinFugas(evento, 'objeto')
  assert.equal(evento.extra.error.code, '23505')
  assert.equal(evento.extra.error.message, 'duplicate key')
  // 4. clave duplicada: el valor se esconde, la columna se conserva
  assert.equal(limpiarTexto('Key (dni)=(30123456) already exists.'), 'Key (dni)=([filtrado]) already exists.')
  assert.equal(limpiarTexto('Key (full_name)=(Juan Pérez) already exists.'), 'Key (full_name)=([filtrado]) already exists.')
  // 5. details: '…' en un log de objeto
  sinFugas(limpiarTexto(`error { details: 'Av. Santa Fe 1234, Juan Pérez', code: '23505' }`), 'details literal')
})

test('Key (…)=(…) con índice de expresión y con paréntesis en el valor', () => {
  // índice de expresión en la columna
  const a = limpiarTexto('duplicate key value violates unique constraint "x". Key (lower(full_name::text))=(Juan Pérez) already exists.')
  sinFugas(a, 'índice de expresión')
  assert.match(a, /already exists/)
  assert.match(a, /Key \(lower\(full_name::text\)\)=\(\[filtrado\]\)/)
  // paréntesis dentro del valor
  const b = limpiarTexto('Key (full_name)=(Juan (el flaco) Pérez) already exists.')
  sinFugas(b, 'paréntesis en el valor')
  assert.equal(b, 'Key (full_name)=([filtrado]) already exists.')
  // sin terminador conocido: se esconde el resto de la línea
  sinFugas(limpiarTexto('Key (full_name)=(Juan Pérez, Av. Santa Fe 1234 y algo más sin cierre'), 'sin terminador')
  // clave compuesta, referenciada, y al final del string de un JSON
  sinFugas(limpiarTexto('Key (dni, full_name)=(12345678, Juan Pérez) is not present in table "profiles".'), 'compuesta')
  const j = limpiarTexto('{"message":"Key (full_name)=(Juan Pérez)","code":"23503"}')
  sinFugas(j, 'dentro de un JSON')
  assert.equal(JSON.parse(j).code, '23503')
})

test('"Failing row contains" dentro de un string JSON no se lleva el resto del JSON', () => {
  const j = JSON.stringify({ message: 'null value. Failing row contains (1, Juan Pérez, Av. Santa Fe 1234, null).', code: '23502', hint: null })
  const l = limpiarTexto(j)
  sinFugas(l, 'string JSON')
  const o = JSON.parse(l)   // sigue siendo JSON válido
  assert.equal(o.code, '23502', 'el code sobrevive')
  assert.equal(o.hint, null)
  assert.match(o.message, /^null value\. Failing row contains \[filtrado\]/)
  // en texto plano se esconde hasta el final (una fila puede tener saltos de línea)
  const t = limpiarTexto('error\nFailing row contains (Juan Pérez, Av. Santa Fe 1234)\nsiguiente línea')
  sinFugas(t, 'texto plano')
  assert.match(t, /^error\nFailing row contains \[filtrado\]$/)
})

test('details/hint doble-serializados (\\"details\\":\\"…\\") y con comillas escapadas adentro', () => {
  const fila = 'Failing row contains (Juan Pérez, Av. Santa Fe 1234)'
  const interno = JSON.stringify({ code: '23502', details: fila, hint: 'Revisá a Juan Pérez', extra: null, hint2: 'x' })
  const doble = JSON.stringify({ body: interno, status: 400 })     // "{\"code\":…,\"details\":\"…\"}"
  const l = limpiarTexto(doble)
  sinFugas(l, 'doble serialización')
  const externo = JSON.parse(l)                                   // el JSON externo sigue válido
  assert.equal(externo.status, 400)
  const internoLimpio = JSON.parse(externo.body)                  // y el interno también
  assert.equal(internoLimpio.code, '23502')
  assert.equal(internoLimpio.details, '[filtrado]')
  assert.equal(internoLimpio.hint, '[filtrado]')
  assert.equal(internoLimpio.hint2, 'x', 'otras claves no se tocan')
  // nivel simple, con comillas escapadas dentro del valor y `null` intacto
  const simple = JSON.stringify({ details: 'fila "Juan Pérez", Av. Santa Fe 1234', code: '1', hint: null })
  const s = limpiarTexto(simple)
  sinFugas(s, 'nivel simple con comillas')
  assert.deepEqual(JSON.parse(s), { details: '[filtrado]', code: '1', hint: null })
})

test('filas con columnas jsonb o valores con comillas: se tapa TODO y el JSON sigue entero', () => {
  const casos = [
    'Failing row contains (1, {"nombre": "Juan Pérez", "dir": "Av Santa Fe 1234"}, null).',
    'Failing row contains (1, Juan "Flaco", Av Libertador 4500, null).',
    'Failing row contains (1, {"a": "x", "b": ["Juan Pérez", {"c": "Av Santa Fe 1234"}]}, "Juan \\"Flaco\\"", null).',
  ]
  for (const fila of casos) {
    // un nivel
    const uno = limpiarTexto(JSON.stringify({ error: fila, code: '23502', status: 400 }))
    sinFugas(uno, `un nivel: ${fila}`)
    for (const p of ['Av Santa Fe 1234', 'Av Libertador 4500', 'Flaco']) assert.ok(!uno.includes(p), `se coló ${p}`)
    const o1 = JSON.parse(uno)
    assert.equal(o1.code, '23502')
    assert.equal(o1.status, 400)
    assert.match(o1.error, /^Failing row contains/)
    // doble serialización
    const dos = limpiarTexto(JSON.stringify({ body: JSON.stringify({ error: fila, code: '23502' }), status: 400 }))
    sinFugas(dos, `doble: ${fila}`)
    for (const p of ['Av Santa Fe 1234', 'Av Libertador 4500', 'Flaco']) assert.ok(!dos.includes(p), `se coló ${p}`)
    const o2 = JSON.parse(dos)
    assert.equal(o2.status, 400)
    assert.equal(JSON.parse(o2.body).code, '23502')
    // dentro de texto suelto (consola): "PostgrestError {…}"
    const consola = limpiarTexto(`PostgrestError ${JSON.stringify({ error: fila, code: '23502' })}`)
    sinFugas(consola, `consola: ${fila}`)
    assert.equal(JSON.parse(consola.replace(/^PostgrestError /, '')).code, '23502')
  }
})

test('Key (…)=(…) en JSON doble-serializado conserva code y status', () => {
  const dos = limpiarTexto(JSON.stringify({ body: JSON.stringify({ message: 'Key (full_name)=(Juan Pérez)', code: '23505' }), status: 400 }))
  sinFugas(dos, 'Key doble')
  const o = JSON.parse(dos)
  assert.equal(o.status, 400)
  const interno = JSON.parse(o.body)
  assert.equal(interno.code, '23505')
  assert.equal(interno.message, 'Key (full_name)=([filtrado])')
  // un nivel, con índice de expresión y valor con paréntesis
  const uno = limpiarTexto(JSON.stringify({ message: 'Key (lower(full_name::text))=(Juan (el flaco) Pérez) already exists.', code: '23505' }))
  sinFugas(uno, 'Key un nivel')
  assert.equal(JSON.parse(uno).code, '23505')
  assert.match(JSON.parse(uno).message, /already exists/)
})

test('JSON ilegible (truncado) y texto suelto: ante la duda se tapa de más, nunca se filtra', () => {
  // truncado: no se puede parsear, se tapa el resto de la línea desde details
  const truncado = limpiarTexto('{"code":"23502","details":"Failing row contains (Juan Pérez, Av. Santa Fe 1234, ')
  sinFugas(truncado, 'truncado')
  // varios JSON en una misma línea de consola
  const varios = limpiarTexto(`falló ${JSON.stringify({ nombre: 'Juan Pérez', code: 1 })} y ${JSON.stringify({ mail: 'juan.perez@gmail.com', ok: true })}`)
  sinFugas(varios, 'varios JSON')
  assert.match(varios, /"code":1/)
  assert.match(varios, /"ok":true/)
  // un número sin comillas dentro del JSON (un DNI) también se enmascara
  const num = limpiarTexto('{"valor": 30123456, "ts": 1793208573515}')
  assert.ok(!num.includes('30123456'))
  assert.ok(num.includes('1793208573515'), 'una marca de tiempo no se toca')
  // string JSON entero
  const s = limpiarTexto(JSON.stringify('Failing row contains (Juan Pérez, Av. Santa Fe 1234)'))
  sinFugas(s, 'string JSON')
  assert.equal(JSON.parse(s).startsWith('Failing row contains'), true)
  // la fila tapa hasta el final del texto suelto, aunque tenga saltos de línea
  sinFugas(limpiarTexto('error\nFailing row contains (Juan Pérez,\nAv. Santa Fe 1234)\nsiguiente'), 'multilínea')
})

test('fuzz: ninguna fila con comillas, llaves, paréntesis o barras se filtra, a ningún nivel de serialización', () => {
  // generador determinístico
  let semilla = 20261028
  const azar = (n) => { semilla = (semilla * 1664525 + 1013904223) % 4294967296; return semilla % n }
  const piezas = ['"', '\\', '{', '}', '[', ']', '(', ')', ',', ':', ' ', '\n', "'", '`', '"nombre": "', 'SECRETO', '\\"', '}"', ')=(']
  const valorRaro = () => Array.from({ length: 3 + azar(10) }, () => piezas[azar(piezas.length)]).join('') + 'SECRETO'
  const encabezados = ['Failing row contains (', 'Key (full_name)=(', 'Key (lower(x::text))=(']
  for (let n = 0; n < Number(process.env.FUZZ_N ?? 400); n++) {
    const cuerpo = encabezados[azar(encabezados.length)] + valorRaro() + valorRaro() + (azar(2) ? ')' : '')
    const forma = azar(5)
    let entrada
    if (forma === 0) entrada = cuerpo
    else if (forma === 1) entrada = `PostgrestError ${JSON.stringify({ code: '23502', details: cuerpo, message: 'm' })}`
    else if (forma === 2) entrada = JSON.stringify({ error: cuerpo, code: '23502', status: 400 })
    else if (forma === 3) entrada = JSON.stringify({ body: JSON.stringify({ message: cuerpo, code: '23505' }), status: 400 })
    else entrada = JSON.stringify({ body: JSON.stringify({ body: JSON.stringify({ message: cuerpo }) }) })
    const salida = limpiarTexto(entrada)
    assert.ok(!salida.includes('SECRETO'), `forma ${forma}: se coló en ${JSON.stringify(salida).slice(0, 300)} (entrada ${JSON.stringify(entrada).slice(0, 300)})`)
    if (forma >= 2 && forma <= 3) JSON.parse(salida)   // lo que era JSON sigue siendo JSON
  }
})

// ── 3. Configuración de Sentry.init ─────────────────────────────────────────
test('las opciones privadas están completas', () => {
  assert.equal(OPCIONES_PRIVADAS.sendDefaultPii, false)
  for (const hook of ['beforeSend', 'beforeSendTransaction', 'beforeBreadcrumb']) {
    assert.equal(typeof OPCIONES_PRIVADAS[hook], 'function', hook)
  }
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

// ── 4. Punta a punta: SDK real, error forzado, transporte interceptado ─────
test('un error forzado con un mail y un DNI en el mensaje sale enmascarado del SDK real', async () => {
  const Sentry = await import('@sentry/react')
  const enviados = []
  Sentry.init({
    dsn: 'https://publica@o0.ingest.sentry.io/1',
    environment: 'test',
    release: 'test',
    tracesSampleRate: 0,
    ...OPCIONES_PRIVADAS,
    transport: () => ({
      send: async (envelope) => { enviados.push(JSON.stringify(envelope)); return { statusCode: 200 } },
      flush: async () => true,
    }),
  })
  Sentry.setUser({ id: 'u-1', email: 'juan.perez@gmail.com', username: 'Juan Pérez', ip_address: '1.2.3.4' })
  Sentry.addBreadcrumb({ category: 'fetch', data: { url: 'https://x.supabase.co/rest/v1/profiles?dni=eq.12345678' } })
  Sentry.addBreadcrumb({ category: 'console', message: 'form de juan.perez@gmail.com' })
  // Un error de PostgREST tal como llega a la consola: la fila va en `details`.
  console.error('PostgrestError', JSON.stringify({ code: '23502', details: 'Failing row contains (6d520ef9-2afe-459c-93a5-e0fa376e63a7, Juan Pérez, Av. Santa Fe 1234, null)', hint: null, message: 'null value in column "x"' }))
  Sentry.captureException(Object.assign(new Error('Falló el pago de juan.perez@gmail.com, DNI 12345678, cel +54 9 11 5555-1234'), { details: 'Failing row contains (Juan Pérez, Av. Santa Fe 1234)' }))
  await Sentry.flush(2000)

  assert.ok(enviados.length >= 1, 'el evento tendría que haber llegado al transporte')
  const salida = enviados.join('\n')
  sinFugas(salida, 'envelope')
  assert.match(salida, /\[email\]/)
  assert.match(salida, /\[dni\]/)
  assert.match(salida, /"id":"u-1"/, 'el id del usuario sí viaja')
  console.log('  evento que saldría hacia Sentry:\n  ' + salida.split('\n').find(l => l.includes('"exception"'))?.slice(0, 600))
})
