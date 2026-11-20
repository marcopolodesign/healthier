// En modo operador (una cuenta operadorN actuando como un profesional de Medizin) NO se
// mide ni se identifica a nombre del profesional: ni GTM (dataLayer), ni Customer.io.
//   node --import tsx --test scripts/test-modo-operador-analitica.mjs
import test from 'node:test'
import assert from 'node:assert/strict'

const almacen = new Map()
const llamadas = []
globalThis.window = {
  localStorage: { getItem: k => (almacen.has(k) ? almacen.get(k) : null), setItem: (k, v) => almacen.set(k, String(v)), removeItem: k => almacen.delete(k) },
  location: { hostname: 'www.healthier.com.ar', pathname: '/' },
  dispatchEvent: () => true,
  dataLayer: [],
  // Customer.io "encendido" (host de producción): cualquier llamada queda registrada.
  cioanalytics: { identify: (...a) => llamadas.push(['identify', ...a]), track: (...a) => llamadas.push(['track', ...a]), page: (...a) => llamadas.push(['page', ...a]), reset: () => llamadas.push(['reset']) },
}
globalThis.Event = class { constructor(t) { this.type = t } }

const { marcarModoOperador } = await import('../src/lib/modoOperadorMarca.js')
const analytics = await import('../src/utils/analytics.js')
const cio = await import('../src/utils/customerio.js')
const PERFIL = { id: '11111111-1111-1111-1111-111111111111', role: 'professional', email: 'pro@example.com', fullName: 'Pro Ejemplo' }

test('sin modo operador, el profesional se identifica y se mide como siempre (control)', async () => {
  marcarModoOperador(false)
  llamadas.length = 0; window.dataLayer.length = 0
  await analytics.setAnalyticsUser(PERFIL)
  analytics.track('evento_control', { a: 1 })
  cio.cioIdentify(PERFIL)
  assert.ok(window.dataLayer.length >= 1 && window.dataLayer[0].user_id, 'el evento sale con el id hasheado')
  assert.ok(llamadas.some(l => l[0] === 'identify'), 'Customer.io identifica')
})

test('en modo operador no sale ningún evento a GTM ni a Customer.io, ni se identifica al profesional', async () => {
  marcarModoOperador(true)
  llamadas.length = 0; window.dataLayer.length = 0
  await analytics.setAnalyticsUser(PERFIL)
  analytics.track('evento_prueba', { a: 1 })
  cio.cioIdentify(PERFIL)
  cio.cioIdentifyProfessional(PERFIL, { specialty: 'medicina_general' })
  cio.cioTrack('evento_cio', { a: 1 })
  cio.cioPage('/profesional/dashboard')
  assert.equal(window.dataLayer.length, 0, 'GTM: nada en el dataLayer')
  assert.deepEqual(llamadas, [], 'Customer.io: ni identify, ni track, ni page')
})

test('al terminar el turno vuelve a medirse normal', async () => {
  marcarModoOperador(false)
  llamadas.length = 0; window.dataLayer.length = 0
  analytics.track('evento_despues', {})
  assert.equal(window.dataLayer.length, 1)
})
