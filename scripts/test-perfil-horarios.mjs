// Control: el perfil del profesional muestra horarios al tocar una modalidad
// (Mateo, 2026-11-25). Corre con `npm run test:perfil-horarios`.
//
// Dos partes:
//  1. La grilla del perfil (`proximosDiasConTurnos`) sale de la agenda semanal,
//     saca lo ya tomado y lo que ya pasó hoy, y devuelve los días con turnos.
//  2. El cableado: tocar una modalidad la elige y pide la agenda; tocar un
//     horario arma "Agendar · …" y el wizard recibe `fecha` + `hora` y va al
//     resumen. Si alguien lo desarma, esto falla.
// La prueba de punta a punta, con clics y contra staging, es
// `scripts/verificar-perfil-profesional-front.mjs`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  proximosDiasConTurnos, etiquetaTurno, horaCorta, buildDateOptions, fechaISOBuenosAires, relojBuenosAires,
} from '../src/lib/agendaTurnos.js'

const todaLaSemana = [0, 1, 2, 3, 4, 5, 6].map(d => ({ id: `f${d}`, dayOfWeek: d, startTime: '09:00:00', endTime: '10:00:00' }))

test('con agenda, devuelve tres días con horarios', () => {
  const dias = proximosDiasConTurnos({ schedule: todaLaSemana, slotMinutes: 15 })
  assert.equal(dias.length, 3)
  for (const d of dias) {
    assert.ok(d.slots.length > 0)
    assert.match(d.value, /^\d{4}-\d{2}-\d{2}$/)
    assert.ok(d.titulo && d.sub)
  }
})

test('sin agenda, no hay horarios (el perfil lo dice en una línea)', () => {
  assert.deepEqual(proximosDiasConTurnos({ schedule: [] }), [])
})

test('saca los horarios ya tomados', () => {
  const opciones = buildDateOptions(14)
  const manana = opciones[1]
  const schedule = [{ id: 'x', dayOfWeek: manana.dayOfWeek, startTime: '09:00:00', endTime: '09:30:00' }]
  const tomado = new Date(`${manana.value}T09:00:00-03:00`).toISOString()
  const dias = proximosDiasConTurnos({ schedule, consultations: [{ status: 'confirmed', scheduledAt: tomado }], slotMinutes: 15 })
  const delDia = dias.find(d => d.value === manana.value)
  assert.ok(delDia)
  assert.deepEqual(delDia.slots.map(s => s.startTime), ['09:15:00'])
})

test('hoy no ofrece horarios que ya pasaron', () => {
  const hoy = fechaISOBuenosAires(relojBuenosAires())
  const dow = new Date(hoy + 'T12:00:00Z').getUTCDay()
  const dias = proximosDiasConTurnos({ schedule: [{ id: 'h', dayOfWeek: dow, startTime: '00:00:00', endTime: '00:30:00' }], slotMinutes: 15 })
  assert.ok(!dias.some(d => d.value === hoy), 'las 00:00 de hoy ya pasaron')
})

test('el botón dice "Agendar · hoy 9:00"', () => {
  assert.equal(horaCorta('09:00:00'), '9:00')
  assert.equal(horaCorta('15:30:00'), '15:30')
  assert.equal(etiquetaTurno({ titulo: 'Hoy' }, { startTime: '15:30:00' }), 'hoy 15:30')
  assert.equal(etiquetaTurno({ titulo: 'Lunes' }, { startTime: '09:00:00' }), 'lunes 9:00')
})

const perfil = readFileSync(new URL('../src/pages/patient/ProfessionalProfile.jsx', import.meta.url), 'utf8')
const wizard = readFileSync(new URL('../src/pages/patient/ReservarConsulta.jsx', import.meta.url), 'utf8')

test('perfil: tocar una modalidad la elige y muestra la grilla', () => {
  assert.match(perfil, /onClick=\{\(\) => elegirModalidad\(mId\)\}/)
  assert.match(perfil, /data-testid=\{`perfil-modalidad-\$\{mId\}`\}/)
  assert.match(perfil, /if \(!modalidad \|\| agenda \|\| !professional\?\.userId\) return/, 'la agenda se pide al elegir modalidad')
  assert.match(perfil, /proximosDiasConTurnos\(/)
  assert.match(perfil, /data-testid="perfil-grilla"/)
  assert.match(perfil, /data-testid="perfil-slot"/)
})

test('perfil: "Agendar" lleva al wizard con modalidad, fecha y hora', () => {
  assert.match(perfil, /modality: modalidad, fecha: elegido\.dia\.value, hora: elegido\.slot\.startTime\.slice\(0, 5\)/)
  assert.match(perfil, /`Agendar · \$\{etiquetaTurno\(elegido\.dia, elegido\.slot\)\}`/)
})

test('wizard: con fecha y hora precargadas va al resumen y valida el horario', () => {
  assert.match(wizard, /searchParams\.get\('fecha'\)/)
  assert.match(wizard, /searchParams\.get\('hora'\)/)
  assert.match(wizard, /if \(conTurnoPrecargado\) return paramVerticalId === 'veterinaria' \? 'pet' : 'confirm'/)
  assert.match(wizard, /libres\.find\(s => s\.startTime\.slice\(0, 5\) === paramHora\)/)
})
