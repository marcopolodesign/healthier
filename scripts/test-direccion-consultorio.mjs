import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { direccionTieneNumero, validarDireccionConsultorio, armarDireccion } from '../src/lib/geo.js'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')
//   npm run test:direccion

// Control de "lo arreglado no vuelve": consultorio sin número de calle (Ani
// Correa da Silva, 2026-11-02: la paciente pagó, no vio adónde ir y canceló).
test('una dirección de consultorio sin número de calle NO es válida', () => {
  for (const d of [
    'Coronel Ramón Lorenzo Falcón, Flores, Buenos Aires',
    'Av. 9 de Julio, CABA',
    'Calle 99 - Zárate Villa Progreso, B1502HQG Villa Lynch, Buenos Aires Province',
    'San Martín s/n, Ramallo',
    'Falcón',
  ]) {
    assert.equal(direccionTieneNumero(d), false, d)
    assert.equal(validarDireccionConsultorio(d), 'Agregá el número de la calle', d)
  }
  assert.equal(validarDireccionConsultorio('1234'), 'Agregá la calle y el número')
})

test('con calle y número es válida, en el orden de Google y en el de Nominatim', () => {
  for (const d of [
    'Falcón 1500, Flores, Buenos Aires',
    'Av. 9 de Julio 1000',
    'Av. Santa Fe 1900 Piso 3 Dto B, Palermo',
    '3709, Arenales, Palermo, Comuna 14',
    'Calle 99 - Zárate 1234, Villa Lynch',
    'Ruta 8 km 50',
  ]) assert.equal(validarDireccionConsultorio(d), null, d)
  assert.equal(validarDireccionConsultorio(''), null, 'vacía no bloquea: la cubre el aviso del panel')
})

test('armarDireccion deja calle + número + barrio, sin CP ni país', () => {
  assert.equal(armarDireccion({ calle: 'Falcón', numero: '1500', barrio: 'Flores', ciudad: 'Buenos Aires', provincia: 'Buenos Aires' }),
    'Falcón 1500, Flores, Buenos Aires')
})

test('los formularios del consultorio exigen el número y el panel avisa si falta', () => {
  const perfil = readFileSync(join(SRC, 'pages/professional/Profile.jsx'), 'utf8')
  assert.match(perfil, /validarDireccionConsultorio\(form\.address\)/)
  assert.match(perfil, /<AddressAutocomplete[\s\S]{0,200}exigirNumero/)
  const admin = readFileSync(join(SRC, 'pages/super-admin/Profesionales.jsx'), 'utf8')
  assert.match(admin, /validarDireccionConsultorio\(direccion\.address\)/)
  const dash = readFileSync(join(SRC, 'pages/professional/Dashboard.jsx'), 'utf8')
  assert.match(dash, /direccionTieneNumero\(profProfile\.address\)\s*\?\s*'sin_numero'/)
})

