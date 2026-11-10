// Control: el link de referidos que se comparte nunca sale con el dominio viejo de Vercel
// (2026-10-29). Correr: npm run test:referidos
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../src/services/referralService.js', import.meta.url), 'utf8')
const helper = src.match(/export const SITIO_PUBLICO = '([^']+)'[\s\S]*?export function origenPublico\(\{ hostname, origin \}\) \{\n  return (.+)\n\}/)
assert.ok(helper, 'referralService.js tiene que exportar SITIO_PUBLICO y origenPublico')
const SITIO_PUBLICO = helper[1]
const origenPublico = new Function('SITIO_PUBLICO', `return ({ hostname, origin }) => ${helper[2]}`)(SITIO_PUBLICO)

test('desde el dominio viejo, el link sale con www.healthier.com.ar', () => {
  assert.equal(origenPublico({ hostname: 'gethealthier.vercel.app', origin: 'https://gethealthier.vercel.app' }), 'https://www.healthier.com.ar')
})
test('producción, staging y localhost conservan su origen', () => {
  for (const origin of ['https://www.healthier.com.ar', 'https://staging.healthier.com.ar', 'http://localhost:5199']) {
    assert.equal(origenPublico({ hostname: new URL(origin).hostname, origin }), origin)
  }
})
test('buildUrl usa origenPublico, no window.location.origin directo', () => {
  assert.match(src, /buildUrl\(codigo\) \{\n\s*return `\$\{origenPublico\(window\.location\)\}\/r\/\$\{codigo\}`/)
})

// ── Canje que no llegó a hacerse (2026-11-10) ─────────────────────────────
// Un fallo de red/servidor (`motivo: 'error'`) se reintenta una vez y, si
// sigue, el código se guarda para el próximo arranque: nunca se pierde en silencio.
const { canjearConReintento } = await import('../src/lib/referral.js')
test('canje: un error de red se reintenta una vez', async () => {
  let llamadas = 0
  const r = await canjearConReintento(async () => (++llamadas === 1 ? { ok: false, motivo: 'error' } : { ok: true }))
  assert.equal(llamadas, 2)
  assert.equal(r.ok, true)
})
test('canje: dos errores seguidos devuelven error (para guardarlo como pendiente)', async () => {
  let llamadas = 0
  const r = await canjearConReintento(async () => { llamadas++; return { ok: false, motivo: 'error' } })
  assert.equal(llamadas, 2)
  assert.equal(r.motivo, 'error')
})
test('canje: un rechazo del servidor NO se reintenta', async () => {
  let llamadas = 0
  const r = await canjearConReintento(async () => { llamadas++; return { ok: false, motivo: 'ya_consulto' } })
  assert.equal(llamadas, 1)
  assert.equal(r.motivo, 'ya_consulto')
})
test('el alta usa canjearSeguro y la app reintenta el pendiente', () => {
  const auth = readFileSync(new URL('../src/services/authService.js', import.meta.url), 'utf8')
  assert.ok((auth.match(/canjearSeguro/g) ?? []).length >= 2, 'register y completeGoogleProfile tienen que usar canjearSeguro')
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
  assert.match(app, /reintentarCanjePendiente/)
})
