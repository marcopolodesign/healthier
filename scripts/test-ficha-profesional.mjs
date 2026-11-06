// Control: guardar la ficha de un profesional NUNCA manda la presencia on-demand
// (switch + latido) salvo que se declare a propósito, y nada que no sea el
// switch/Agenda llama a `goOffline()` desde un estado que puede estar rancio.
// Caso real: una profesional en producción quedó con is_on_demand = true y
// on_demand_last_seen_at = NULL (2026-11-05). Ver catchup [website] 2026-11-06.
//
//   node --test scripts/test-ficha-profesional.mjs      (npm run test:latido)
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { armarFichaParaGuardar, COLUMNAS_DEL_SERVIDOR } from '../src/lib/fichaProfesional.js'

const fichaRancia = {
  id: 'x', userId: 'u', cbu: '123', isOnDemand: true,
  onDemandSince: '2026-11-04T10:00:00Z', onDemandLastSeenAt: '2026-11-04T10:00:00Z',
  mpConnected: true, averageRating: 4.5, profiles: { fullName: 'A' },
}

test('guardar la ficha entera no manda presencia', () => {
  const p = armarFichaParaGuardar({ ...fichaRancia, cbu: '999' })
  for (const k of ['isOnDemand', 'onDemandSince', 'onDemandLastSeenAt', 'profiles', 'mpConnected', 'averageRating'])
    assert.equal(k in p, false, `${k} no debería viajar`)
  assert.equal(p.cbu, '999')
  assert.equal(p.userId, 'u')
})

test('el switch declara la presencia a propósito: isOnDemand pasa, el latido nunca', () => {
  const p = armarFichaParaGuardar({ isOnDemand: false, onDemandLastSeenAt: 'x' }, { presencia: true })
  assert.equal(p.isOnDemand, false)
  assert.equal('onDemandLastSeenAt' in p, false)
})

test('la lista de columnas del servidor incluye la presencia', () => {
  assert.ok(COLUMNAS_DEL_SERVIDOR.includes('onDemandSince'))
  assert.ok(COLUMNAS_DEL_SERVIDOR.includes('onDemandLastSeenAt'))
})

const src = f => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8')
const sinComentarios = t => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

test('el latido del layout nunca baja la presencia (un false rancio la borraba)', () => {
  assert.doesNotMatch(sinComentarios(src('hooks/useOnDemandPresence.js')), /goOffline/)
})

test('las lecturas de disponibilidad no tratan un error de red como "apagado"', () => {
  assert.match(src('layouts/AppLayout.jsx'), /getByUserId\(profile\.id, \{ tirarError: true \}\)/)
  const sw = src('components/professional/OnDemandSwitch.jsx')
  assert.match(sw, /getByUserId\(profileIdRef\.current, \{ tirarError: true \}\)/)
  assert.doesNotMatch(sinComentarios(sw), /catch\(\(\) => \{ onChange\?\.\(false\)/)
})

test('sólo el switch y Agenda escriben is_on_demand', () => {
  assert.match(src('services/professionalService.js'), /upsert\(userId, \{ isOnDemand: activo \}, \{ presencia: true \}\)/)
  assert.match(src('pages/professional/Agenda.jsx'), /upsert\(profile\.id, form, \{ presencia: true \}\)/)
})
