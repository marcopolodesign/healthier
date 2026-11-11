// Customer.io: sólo producción manda (pedido de Hyppo, 2026-11-11).
// Falla si staging/preview/local vuelven a mandar, o si la lista de hosts de
// index.html y la de customerio.js se despegan.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { CIO_PROD_HOSTS, isCioEnabled } from '../src/utils/customerio.js'

const NO_PROD = [
  'staging.healthier.com.ar',
  'gethealthier-staging.vercel.app',
  'gethealthier-git-feat-algo-healthier-app.vercel.app',
  'localhost', '127.0.0.1', '',
  'www.healthier.com.ar.evil.com', 'xwww.healthier.com.ar',
]

test('customerio.js: sólo los hosts de producción', () => {
  for (const h of CIO_PROD_HOSTS) assert.equal(isCioEnabled(h), true, h)
  for (const h of NO_PROD) assert.equal(isCioEnabled(h), false, h)
})

test('index.html: el snippet usa la misma lista y corta antes de crear cioanalytics', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  const m = html.match(/!function\(\)\{if\(!\/(.+?)\/\.test\(location\.hostname\)\)return;var i="cioanalytics"/)
  assert.ok(m, 'el snippet de Customer.io no tiene la guarda de host al principio')
  const re = new RegExp(m[1])
  for (const h of CIO_PROD_HOSTS) assert.ok(re.test(h), `index.html no deja pasar ${h}`)
  for (const h of NO_PROD) assert.ok(!re.test(h), `index.html deja pasar ${h}`)
  assert.equal((html.match(/cdp\.customer\.io/g) || []).length, 1, 'hay más de una carga de Customer.io')
})
