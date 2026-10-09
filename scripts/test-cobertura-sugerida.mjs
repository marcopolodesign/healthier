// Control de "lo arreglado no vuelve" para la cobertura sugerida por DNI.
// Falla si la precarga pisa una cobertura que el paciente ya cargó.
//   npm run test:cobertura
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { precargarCobertura, avisoSinMatch, origenDeCobertura, tieneCobertura } from '../src/lib/coberturaSugerida.js'

const OSDE = { estado: 'encontrada', sugerencia: { rnos: '614081', coberturaNombre: 'OBRA SOCIAL DE EJECUTIVOS…', financiadorId: 28, financiadorNombre: 'OSDE' } }
const vacio = { coverageType: null, financiadorId: null, insuranceName: '' }

test('sin nada cargado, precarga la sugerida', () => {
  assert.deepEqual(precargarCobertura(vacio, OSDE), { coverageType: 'financiador', financiadorId: 28, insuranceName: 'OSDE' })
})

test('NO pisa una obra social ya elegida', () => {
  assert.equal(precargarCobertura({ coverageType: 'financiador', financiadorId: 96, insuranceName: 'ACCORDSALUD' }, OSDE), null)
})

test('NO pisa "particular"', () => {
  assert.equal(precargarCobertura({ coverageType: 'particular', financiadorId: null, insuranceName: '' }, OSDE), null)
})

test('NO pisa una obra social escrita a mano (perfiles viejos / familiares)', () => {
  assert.equal(precargarCobertura({ coverageType: null, financiadorId: null, insuranceName: 'Swiss Medical' }, OSDE), null)
  assert.equal(tieneCobertura({ insuranceName: '   ' }), false)
})

test('sin match con el catálogo no precarga: sólo avisa el nombre', () => {
  const r = { estado: 'sin_match', sugerencia: { rnos: '1', coberturaNombre: 'O.S. RARA', financiadorId: null } }
  assert.equal(precargarCobertura(vacio, r), null)
  assert.equal(avisoSinMatch(vacio, r), 'O.S. RARA')
  assert.equal(avisoSinMatch({ coverageType: 'particular' }, r), null)
})

test('padrón caído o sin datos: no toca nada', () => {
  for (const estado of ['no_disponible', 'sin_datos']) {
    assert.equal(precargarCobertura(vacio, { estado }), null)
    assert.equal(avisoSinMatch(vacio, { estado }), null)
  }
  assert.equal(precargarCobertura(vacio, null), null)
})

test('origen: listado si confirmó la sugerida, manual si la cambió', () => {
  assert.equal(origenDeCobertura({ coverageType: 'financiador', financiadorId: 28 }, 28), 'listado')
  assert.equal(origenDeCobertura({ coverageType: 'financiador', financiadorId: 96 }, 28), 'manual')
  assert.equal(origenDeCobertura({ coverageType: 'particular' }, 28), 'manual')
  assert.equal(origenDeCobertura({ coverageType: null }, 28), null)
})
