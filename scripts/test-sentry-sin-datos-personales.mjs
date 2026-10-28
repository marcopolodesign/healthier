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
  'Juan Pérez', 'iPhone de Mateo',
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
  Sentry.captureException(new Error('Falló el pago de juan.perez@gmail.com, DNI 12345678, cel +54 9 11 5555-1234'))
  await Sentry.flush(2000)

  assert.ok(enviados.length >= 1, 'el evento tendría que haber llegado al transporte')
  const salida = enviados.join('\n')
  sinFugas(salida, 'envelope')
  assert.match(salida, /\[email\]/)
  assert.match(salida, /\[dni\]/)
  assert.match(salida, /"id":"u-1"/, 'el id del usuario sí viaja')
  console.log('  evento que saldría hacia Sentry:\n  ' + salida.split('\n').find(l => l.includes('"exception"'))?.slice(0, 600))
})
