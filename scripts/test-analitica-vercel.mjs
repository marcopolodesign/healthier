// Control: la URL que va a Vercel Analytics no lleva ids, tokens ni mails.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { limpiarUrl } from '../src/lib/analiticaVercel.js'

test('saca uuid, query y hash', () => {
  assert.equal(
    limpiarUrl('https://www.healthier.com.ar/paciente/turno-confirmado/23ff1b47-4d0a-4ccd-a08c-075be900b05e?email=a@b.com&token=x#y'),
    'https://www.healthier.com.ar/paciente/turno-confirmado/:id',
  )
})
test('deja las rutas del embudo intactas', () => {
  assert.equal(limpiarUrl('https://www.healthier.com.ar/paciente/pago'), 'https://www.healthier.com.ar/paciente/pago')
})
test('URL rota no se manda', () => assert.equal(limpiarUrl('no-es-url'), null))
