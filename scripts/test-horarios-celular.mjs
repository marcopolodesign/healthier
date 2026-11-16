// Control: en celular (360 px) el botón para agregar un horario tiene que
// quedar a la vista. En una sola fila sin wrap, los dos inputs de hora lo
// empujaban afuera de la pantalla y no se podía cargar la agenda
// (Mónica Melo, 2026-11-16). Corre con `npm run test:horarios`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const leer = (f) => readFileSync(new URL(`../src/pages/professional/${f}`, import.meta.url), 'utf8')

test('Agenda: la fila de "Agregar franja" hace wrap y el botón ocupa el ancho en celular', () => {
  const s = leer('Agenda.jsx')
  const fila = s.slice(s.indexOf('Agregar franja'), s.indexOf("{addingFranja ? '...' : 'Agregar'}"))
  assert.match(fila, /flex flex-wrap/)
  assert.match(fila, /w-full sm:w-auto/)
})

test('Configuración: la fila de agregar horario hace wrap', () => {
  const s = leer('Configuracion.jsx')
  const fila = s.slice(s.indexOf('addingDay === dayKey &&'), s.indexOf("{savingSchedule ? '...' : 'Guardar'}"))
  assert.match(fila, /flex flex-wrap/)
})
