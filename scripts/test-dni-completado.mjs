// Control de la migración 225 del lado del front: completar un DNI vacío no se
// anuncia como "vuelve a revisión"; cambiar uno existente, sí.
//   npm run test:dni-completado   (corre también el veredicto de la función)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { camposSensiblesQueCambian } from '../src/lib/reverificacion.js'

test('DNI vacío que se completa: no es cambio sensible', () => {
  assert.deepEqual(camposSensiblesQueCambian({ dni: null }, { dni: '30123456' }), [])
  assert.deepEqual(camposSensiblesQueCambian({ dni: '' }, { dni: '30123456' }), [])
})

test('DNI existente que cambia, o que se borra: sigue yendo a revisión', () => {
  assert.deepEqual(camposSensiblesQueCambian({ dni: '30123456' }, { dni: '30123457' }), ['DNI'])
  assert.deepEqual(camposSensiblesQueCambian({ dni: '30123456' }, { dni: '' }), ['DNI'])
})

test('el resto de los campos sensibles no cambia', () => {
  assert.deepEqual(camposSensiblesQueCambian({ dni: null, fullName: 'A B' }, { dni: '30123456', fullName: 'A C' }), ['Nombre completo'])
})
