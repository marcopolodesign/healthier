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

// Revisión previa a producción (2026-11-25, ronda 2).
import { tipoDeErrorDePago } from '../src/lib/analiticaOndemand.js'
const servicio = fs.readFileSync(new URL('../src/services/paymentsService.js', import.meta.url), 'utf8')

test('en un turno, un error con débito no se clasifica como debit_not_allowed', () => {
  assert.equal(tipoDeErrorDePago({ mensaje: 'timeout', paymentMethodId: 'debvisa', aceptaDebito: true }), 'server_error')
  assert.equal(tipoDeErrorDePago({ mensaje: 'x', paymentMethodId: 'account_money', aceptaDebito: true }), 'card_error')
  // la consulta inmediata mantiene la regla
  assert.equal(tipoDeErrorDePago({ mensaje: 'x', paymentMethodId: 'debvisa' }), 'debit_not_allowed')
  const llamadas = src.match(/tipoDeErrorDePago\(\{[^}]*\}\)/g) || []
  for (const l of llamadas) assert.ok(l.includes('aceptaDebito: true'), `tipoDeErrorDePago sin aceptaDebito en el turno: ${l}`)
})

test('payment_error nunca manda el texto libre del error', () => {
  assert.ok(!/error_message/.test(src), 'volvió error_message (texto libre) en payment_error')
})

test('el pago en proceso y el bonificado anotan el hito pago (no quedan como "no pagó")', () => {
  assert.ok((src.match(/anotarHito\('pago'\)/g) || []).length >= 2, 'falta anotarHito(\'pago\') en in_process o en bonificado')
})

test('"Llegaron al pago y no pagaron" pagina los hitos (PostgREST corta en 1000)', () => {
  assert.match(servicio, /\.range\(desdeFila/)
  assert.ok(!/\.limit\(5000\)/.test(servicio), 'volvió .limit(5000) sin paginar')
})
