#!/usr/bin/env node
// Control de regresión — el mapa del inicio del paciente (2026-09-30).
//
// Pedido de Nacho (uso real): en el mapa, TODOS los profesionales, verde si
// está para consulta inmediata y rojo si no; al rojo se le saca turno.
// Antes el mapa mostraba uno solo por especialidad, a los que no tenían
// coordenadas los dibujaba en posiciones inventadas, y "Disponible ahora" salía
// para cualquiera con el switch prendido aunque no entrara hace semanas.
//
// Chequea, sin tocar la base:
//  1. El mapa carga con getMapaProfesionales: MP conectado + coordenadas, sin
//     filtrar por modalidad (los virtuales también van, en su dirección).
//  2. Un pin por profesional, en sus coordenadas reales (nada de posiciones
//     inventadas), y verde/rojo por disponibleAhora().
//  3. disponibleAhora exige switch + vigencia + MP.
//  4. primerTurnoLibre respeta agenda, turnos tomados y el margen de hoy.
//  5. Las variantes de dirección ubican las que se tipean a mano.
//
// Uso: node scripts/verificar-mapa-profesionales.mjs   (sale 1 si falla)
import { readFileSync } from 'node:fs'
import { primerTurnoLibre, fechaISOBuenosAires, relojBuenosAires } from '../src/lib/agendaTurnos.js'
import { variantesDeDireccion } from '../src/lib/geo.js'

const leer = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const fallas = []
const check = (ok, msg) => { if (!ok) fallas.push(msg) }

// 1 ── la consulta del mapa
const servicio = leer('src/services/professionalService.js')
const mapa = servicio.match(/async getMapaProfesionales\(\) \{([\s\S]*?)\n  \},/)
check(mapa, 'professionalService: falta getMapaProfesionales')
if (mapa) {
  check(/\.eq\('mp_connected', true\)/.test(mapa[1]), 'getMapaProfesionales no exige Mercado Pago conectado')
  check(/\.not\('latitude', 'is', null\)/.test(mapa[1]), 'getMapaProfesionales no exige coordenadas')
  check(!/modality_preference/.test(mapa[1]), 'getMapaProfesionales volvió a filtrar por modalidad (los virtuales tienen que ir)')
  check(/ocultaDePrueba/.test(mapa[1]), 'getMapaProfesionales dejó de esconder a los de prueba')
}

// 2 ── el dashboard y el pin
const dashboard = leer('src/pages/patient/Dashboard.jsx')
check(/getMapaProfesionales\(\)/.test(dashboard), 'Dashboard del paciente no usa getMapaProfesionales')
check(!/FALLBACK_SLOTS|latLngToPixel|pickProForVertical/.test(dashboard), 'Dashboard volvió a inventar posiciones o a mostrar uno por especialidad')
check(/isOnDemand: disponibleAhora\(pro\)/.test(dashboard), 'El color del pin no sale de disponibleAhora()')
check(/mapa-pro-sacar-turno/.test(dashboard), 'Falta el botón para sacar turno con un profesional no disponible')
const pin = leer('src/components/patient/InteractiveMap.jsx')
check(/border-emerald-500' : 'border-red-500'/.test(pin), 'El pin ya no es verde/rojo')
check(/longitude=\{m\.lng\}/.test(pin), 'El pin no usa las coordenadas reales')

// 3 ── disponibleAhora (copiada del servicio para no arrastrar supabase-js)
const fuente = servicio.match(/export function disponibleAhora\(pro, now = Date\.now\(\)\) \{([\s\S]*?)\n\}/)
check(fuente, 'professionalService: falta disponibleAhora')
if (fuente) {
  const ttl = 60 * 60 * 1000
  const disponibleAhora = new Function('pro', 'now', 'ON_DEMAND_PRESENCE_TTL_MS', fuente[1])
  const ahora = Date.now()
  const hace = min => new Date(ahora - min * 60_000).toISOString()
  check(disponibleAhora({ isOnDemand: true, onDemandLastSeenAt: hace(5), mpConnected: true }, ahora, ttl) === true, 'disponibleAhora: conectado hace 5 min debería ser verde')
  check(disponibleAhora({ isOnDemand: true, onDemandLastSeenAt: hace(90), mpConnected: true }, ahora, ttl) === false, 'disponibleAhora: latido vencido debería ser rojo')
  check(disponibleAhora({ isOnDemand: true, onDemandLastSeenAt: null, mpConnected: true }, ahora, ttl) === false, 'disponibleAhora: sin latido debería ser rojo')
  check(disponibleAhora({ isOnDemand: false, onDemandLastSeenAt: hace(5), mpConnected: true }, ahora, ttl) === false, 'disponibleAhora: switch apagado debería ser rojo')
  check(disponibleAhora({ isOnDemand: true, onDemandLastSeenAt: hace(5), mpConnected: false }, ahora, ttl) === false, 'disponibleAhora: sin MP debería ser rojo')
}

// 4 ── primer turno libre
const hoy = relojBuenosAires()
const manana = new Date(hoy); manana.setUTCDate(hoy.getUTCDate() + 1)
const dowManana = manana.getUTCDay()
const schedule = [{ id: 'f1', dayOfWeek: dowManana, startTime: '09:00:00', endTime: '10:00:00' }]
const turno = primerTurnoLibre({ schedule, consultations: [], slotMinutes: 15, dias: 3 })
check(turno?.fecha === fechaISOBuenosAires(manana) && turno?.startTime === '09:00:00', `primerTurnoLibre: esperaba mañana 09:00, dio ${JSON.stringify(turno)}`)
const tomado = { status: 'confirmed', scheduledAt: `${fechaISOBuenosAires(manana)}T09:00:00-03:00` }
const siguiente = primerTurnoLibre({ schedule, consultations: [tomado], slotMinutes: 15, dias: 3 })
check(siguiente?.startTime === '09:15:00', `primerTurnoLibre: con las 9:00 tomadas esperaba 09:15, dio ${siguiente?.startTime}`)
check(primerTurnoLibre({ schedule: [], consultations: [] }) === null, 'primerTurnoLibre: sin agenda tiene que dar null')

// 5 ── direcciones tipeadas a mano (casos reales de producción)
check(variantesDeDireccion('Arenales 3709 1A Palermo').includes('Arenales 3709, Palermo'), 'variantesDeDireccion: no limpia la unidad ("3709 1A")')
check(variantesDeDireccion('Gral Belgrano 733 Ramallo Buenos Aires').includes('General Belgrano 733, Ramallo, Buenos Aires'), 'variantesDeDireccion: no expande "Gral" ni separa la provincia')

if (fallas.length) {
  console.error('✗ mapa de profesionales:\n  - ' + fallas.join('\n  - '))
  process.exit(1)
}
console.log('✓ mapa de profesionales: todos los cobrables con coordenadas, verde/rojo por disponibleAhora, turno más cercano')
