// Control de la pantalla de pago del paciente (2026-11-25).
//
// 1. "Avanzar (demo)" se le mostraba a todo paciente real en producción. Al
//    apretarlo daba error (la base no acepta payment_status 'demo'), pero se
//    veía al lado de "Confirmar y Pagar".
// 2. `payment_error` sólo salía cuando MP rechazaba la tarjeta: si el pago
//    fallaba por un error, en Customer.io no quedaba nada y no se distinguía
//    de alguien que abandonó.
//
// Correr: node --test scripts/test-pantalla-de-pago.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const src = fs.readFileSync(new URL('../src/pages/patient/PaymentPage.jsx', import.meta.url), 'utf8')

test('la pantalla de pago no muestra el botón de demo', () => {
  assert.ok(!/Avanzar \(demo\)/.test(src), 'volvió el botón "Avanzar (demo)"')
})

test('todo catch del cobro avisa payment_error, sólo si el cobro arrancó', () => {
  const catches = [...src.matchAll(/catch \(err\) \{([\s\S]*?)\n {4}\}/g)]
    .map((m) => m[1])
    .filter((cuerpo) => cuerpo.includes('Error al procesar el pago'))
  assert.ok(catches.length >= 2, `se esperaban los 2 catch del cobro, hay ${catches.length}`)
  for (const cuerpo of catches) {
    assert.ok(cuerpo.includes('if (cobrando) avisarErrorDePago('), 'un catch del cobro no avisa payment_error (o lo avisa también antes de cobrar)')
  }
})

test('el rechazo de MP también avisa payment_error', () => {
  assert.match(src, /avisarErrorDePago\(\{ errorType: 'declined'/)
  assert.match(src, /track\(\s*'payment_error'/)
})

test('cobrando se prende justo antes de cada createPayment', () => {
  const llamadas = src.split('mpService.createPayment(').length - 1
  const prendidos = (src.match(/cobrando = true/g) || []).length
  assert.equal(prendidos, llamadas, `createPayment: ${llamadas}, cobrando = true: ${prendidos}`)
})
