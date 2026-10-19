// Control de "lo arreglado no vuelve" para la pantalla de Teleclínica
// (opción B, Mateo 2026-10-19): primero las preguntas, después el pago.
// Falla si vuelve a poder pedirse/pagarse sin preconsulta, si un botón de las
// preguntas dice "Pagar", o si el N de "Paso X de N" deja de contar el pago.
//   npm run test:teleclinica
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pasosTeleclinica, preguntasTeleclinica, vistaTeleclinica, puedeSolicitar, etiquetaBotonPago, ETIQUETA_PAGAR } from '../src/lib/checkoutTeleclinica.js'

const pre = { version: 2, symptom: { id: 'fiebre', label: 'Fiebre' } }

test('sin preconsulta nunca se muestra el pago', () => {
  assert.equal(vistaTeleclinica({ preconsulta: null }), 'preguntas')
  assert.equal(vistaTeleclinica({ preconsulta: null, editando: false }), 'preguntas')
  assert.equal(vistaTeleclinica({ preconsulta: pre }), 'pago')
  assert.equal(vistaTeleclinica({ preconsulta: pre, editando: true }), 'preguntas')
})

test('tarjeta rechazada después de aceptar: va directo al pago (el pedido ya salió con preconsulta)', () => {
  assert.equal(vistaTeleclinica({ preconsulta: null, rechazado: true }), 'pago')
})

test('sin preconsulta no se puede solicitar', () => {
  assert.equal(puedeSolicitar({ preconsulta: null }), false)
  assert.equal(puedeSolicitar({ preconsulta: pre }), true)
})

test('N cuenta las preguntas, "Tus datos" sólo si faltan, y el pago', () => {
  assert.equal(preguntasTeleclinica({ pideDatos: false }), 3)
  assert.equal(pasosTeleclinica({ pideDatos: false }), 4)
  assert.equal(pasosTeleclinica({ pideDatos: true }), 5)
})

test('el botón del pago dice "Pagar y solicitar"', () => {
  assert.equal(ETIQUETA_PAGAR, 'Pagar y solicitar')
  assert.equal(etiquetaBotonPago({}), 'Pagar y solicitar')
  assert.equal(etiquetaBotonPago({ exento: true }), 'Solicitar consulta')
  assert.equal(etiquetaBotonPago({ rechazado: true }), 'Pagar con esta tarjeta')
  assert.equal(etiquetaBotonPago({ errorPago: true }), 'Reintentar')
})

const pantalla = readFileSync(new URL('../src/pages/patient/OnDemand.jsx', import.meta.url), 'utf8')
const form = readFileSync(new URL('../src/components/patient/PreconsultaForm.jsx', import.meta.url), 'utf8')

test('la pantalla usa la regla y corta los dos caminos de pago sin preconsulta', () => {
  assert.match(pantalla, /vistaTeleclinica\(/)
  const cortes = pantalla.match(/if \(!puedeSolicitar\(\{ preconsulta \}\)\)/g) ?? []
  assert.ok(cortes.length >= 2, 'handlePay y handleNewCardCharge chequean la preconsulta')
  assert.match(pantalla, /vista === 'pago' && \(/, 'el pago se dibuja sólo en la vista de pago')
})

test('las preguntas no dicen "Pagar" y cuentan el pago en N', () => {
  assert.match(pantalla, /textoFinal="Continuar"/)
  assert.match(pantalla, /pasosExtra=\{1\}/)
  assert.doesNotMatch(pantalla, /textoFinal="[^"]*[Pp]ag/)
  assert.match(form, /ultimoPaso \+ 1 \+ pasosExtra/)
})

test('la tarjeta nueva también dice "Pagar y solicitar"', () => {
  assert.match(pantalla, /etiquetaPagar=\{rechazado \? 'Pagar con esta tarjeta' : ETIQUETA_PAGAR\}/)
})
