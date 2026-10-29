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
