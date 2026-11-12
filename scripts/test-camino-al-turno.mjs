/**
 * Control: desde el Inicio del paciente se llega a una agenda con horarios.
 *
 * Hyppo (2026-11-11): la tarjeta "Sacá un turno" del carrusel de atención
 * inmediata mandaba a `/paciente/consultas?vertical=`, que abría el modal viejo
 * de turnos. Ése lee la agenda de `availability_slots` —una tabla vacía en
 * producción— y mostraba "Sin franjas disponibles" con la agenda semanal del
 * profesional cargada. El asistente real es `/paciente/reservar`, que lee
 * `professional_schedules`.
 *
 * Además compara el copy del carrusel con la app, si la encuentra
 * (`HEALTHIER_MOBILE_DIR` o `../mobile`).
 *
 *   npm run test:camino-al-turno
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const leer = (p) => readFileSync(join(raiz, p), 'utf8')
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

function archivos(dir) {
  const out = []
  for (const n of readdirSync(join(raiz, dir))) {
    const rel = join(dir, n)
    if (statSync(join(raiz, rel)).isDirectory()) out.push(...archivos(rel))
    else if (/\.(jsx?|tsx?)$/.test(n)) out.push(rel)
  }
  return out
}

test('nadie manda a reservar por /paciente/consultas?… (el modal viejo sin agenda)', () => {
  const culpables = archivos('src').filter((f) =>
    /navigate\(\s*[`'"]\/paciente\/consultas\?/.test(sinComentarios(leer(f))))
  assert.deepEqual(culpables, [], `Estos archivos mandan al modal viejo: ${culpables.join(', ')}`)
})

test('la tarjeta sin nadie en línea va al asistente real de reserva', () => {
  const s = sinComentarios(leer('src/components/patient/OnDemandCarousel.jsx'))
  assert.match(s, /navigate\(`\/paciente\/reservar\?vertical=\$\{v\.id\}/)
  assert.match(s, /navigate\('\/paciente\/reservar'\)/)
})

test('los links viejos con ?vertical= se redirigen a /paciente/reservar', () => {
  const s = sinComentarios(leer('src/pages/patient/Consultations.jsx'))
  assert.match(s, /navigate\(`\/paciente\/reservar\?\$\{destino\.toString\(\)\}`, \{ replace: true \}\)/)
})

test('ninguna pantalla del paciente fuera de Consultations lee availability_slots', () => {
  const culpables = archivos('src/pages/patient').filter((f) =>
    !f.endsWith('Consultations.jsx') && /availabilityService\.getByProfessional/.test(leer(f)))
  assert.deepEqual(culpables, [])
})

test('"Buscar por nombre" vacío lleva al asistente real, no a /paciente/consultas', () => {
  const s = sinComentarios(leer('src/pages/patient/BuscarDisponibles.jsx'))
  assert.match(s, /track\('buscar_disponibles_empty_book'/)
  assert.match(s, /navigate\(chip \? `\/paciente\/reservar\?vertical=\$\{chip\}` : '\/paciente\/reservar'\)/)
  assert.doesNotMatch(s, /navigate\('\/paciente\/consultas'\)/)
})

test('el modal viejo de Consultations no se abre por ningún lado (autoBook redirige)', () => {
  const s = sinComentarios(leer('src/pages/patient/Consultations.jsx'))
  const llamadas = (s.match(/\bopenModal\(/g) || []).length
  assert.equal(llamadas, 0, 'alguien todavía abre el modal viejo, que lee availability_slots')
  assert.match(s, /state\?\.autoBook[\s\S]{0,600}navigate\(`\/paciente\/reservar\?\$\{destino\.toString\(\)\}`/)
})

test('consulta inmediata sin disponibilidad: botón para sacar turno en las dos pantallas', () => {
  const s = sinComentarios(leer('src/pages/patient/OnDemand.jsx'))
  assert.match(s, /track\('ondemand_no_match_book'/)
  assert.match(s, /navigate\(`\/paciente\/reservar\?vertical=\$\{vertical\.id\}&modality=virtual`\)/)
  assert.match(s, /sacarTurno\('sin_profesionales'\)/)
  assert.match(s, /sacarTurno\('nadie_acepto'\)/)
})

test('purchase de consulta inmediata: sale al autorizarse, una vez, nunca bonificada', () => {
  const s = sinComentarios(leer('src/pages/patient/OnDemand.jsx'))
  assert.equal((s.match(/track\('purchase'/g) || []).length, 1, 'purchase tiene que salir de un solo lugar (enviarPurchase)')
  assert.match(s, /estadoPago === 'autorizado'\) \{[\s\S]{0,300}enviarPurchase\(/)
  assert.match(s, /if \(p\.estadoPago === 'sin_pago'\) \{ setPhase\('asignado'\); return \}/)
  assert.match(s, /enviarPurchase\(pedido\.consultationId/)
})

test('marcarPurchase: una sola vez por consulta, también entre recargas', async () => {
  const datos = {}
  globalThis.window = { localStorage: { getItem: k => datos[k] ?? null, setItem: (k, v) => { datos[k] = String(v) } } }
  const { marcarPurchase } = await import(join(raiz, 'src/lib/analiticaOndemand.js'))
  assert.equal(marcarPurchase('c1', new Set()), true)
  assert.equal(marcarPurchase('c1', new Set()), false, 'otra pantalla (recarga) no lo repite')
  const mem = new Set()
  globalThis.window = { localStorage: { getItem: () => { throw new Error('bloqueado') }, setItem: () => { throw new Error('bloqueado') } } }
  assert.equal(marcarPurchase('c2', mem), true)
  assert.equal(marcarPurchase('c2', mem), false, 'sin storage, la memoria evita el duplicado')
  assert.equal(marcarPurchase(null, mem), false)
})

test('payment_error: tipo de error sin texto libre', async () => {
  const { tipoDeErrorDePago } = await import(join(raiz, 'src/lib/analiticaOndemand.js'))
  assert.equal(tipoDeErrorDePago({ mensaje: 'La consulta inmediata se paga con tarjeta de crédito.' }), 'debit_not_allowed')
  assert.equal(tipoDeErrorDePago({ mensaje: 'x', paymentMethodId: 'debvisa' }), 'debit_not_allowed')
  assert.equal(tipoDeErrorDePago({ mensaje: 'Failed to fetch' }), 'server_error')
  assert.equal(tipoDeErrorDePago({ mensaje: 'cc_rejected_other_reason', paymentMethodId: 'visa' }), 'card_error')
})

test('resumenDeAgenda: misma cuenta que la grilla, sin agenda da ceros', async () => {
  const { resumenDeAgenda, horasHasta } = await import(join(raiz, 'src/lib/agendaTurnos.js'))
  assert.deepEqual(resumenDeAgenda({ schedule: [] }), { daysAvailable: 0, slotsTotal: 0, firstSlotDate: null, hoursUntilFirstSlot: null })
  const todos = [0, 1, 2, 3, 4, 5, 6].map(d => ({ id: `f${d}`, dayOfWeek: d, startTime: '09:00:00', endTime: '10:00:00' }))
  const r = resumenDeAgenda({ schedule: todos, slotMinutes: 15 })
  assert.ok(r.daysAvailable >= 13 && r.daysAvailable <= 14)
  // Hoy puede tener la franja empezada (se corre a las 9:30 → quedan 2 de 4):
  // los demás días dan 4 cada uno.
  assert.ok(r.slotsTotal <= r.daysAvailable * 4 && r.slotsTotal >= (r.daysAvailable - 1) * 4 + 1, `slotsTotal ${r.slotsTotal} con ${r.daysAvailable} días`)
  assert.ok(r.hoursUntilFirstSlot > 0)
  // 2026-01-01 12:00 en Buenos Aires = 15:00 UTC.
  assert.equal(horasHasta('2026-01-01', '12:00', Date.UTC(2026, 0, 1, 13, 0)), 2)
})

test('los eventos nuevos del embudo no llevan especialidad, vertical ni texto libre', () => {
  const prohibidas = /vertical|specialty|especialidad|reason|motivo|note|nota|message|mensaje/i
  const eventos = /track\('(booking_pros_view|booking_pro_select|booking_slots_view|booking_slot_select|booking_no_availability|ondemand_no_match|ondemand_no_match_book|payment_error|purchase)', \{([^}]*)\}/g
  let vistos = 0
  for (const f of ['src/pages/patient/ReservarConsulta.jsx', 'src/pages/patient/OnDemand.jsx']) {
    for (const m of sinComentarios(leer(f)).matchAll(eventos)) {
      vistos++
      const claves = [...m[2].matchAll(/([a-z_]+)\s*:/g)].map(x => x[1])
      const malas = claves.filter(k => prohibidas.test(k))
      assert.deepEqual(malas, [], `${m[1]} en ${f} lleva ${malas.join(', ')}`)
    }
  }
  assert.ok(vistos >= 8, `encontré sólo ${vistos} llamadas`)
})

test('el asistente real lee la agenda semanal (professional_schedules)', () => {
  assert.match(leer('src/pages/patient/ReservarConsulta.jsx'), /availabilityService\.getSchedule\(/)
})

const mobile = process.env.HEALTHIER_MOBILE_DIR || join(raiz, '..', 'mobile')
const copyApp = join(mobile, 'src/lib/copyAtencionInmediata.ts')
test('copy del carrusel igual en web y app', { skip: !existsSync(copyApp) && 'sin la app al lado' }, async () => {
  const web = await import(join(raiz, 'src/lib/copyAtencionInmediata.js'))
  const app = readFileSync(copyApp, 'utf8')
  for (const k of ['SUBTITULO_EN_LINEA', 'SUBTITULO_SIN_NADIE', 'CTA_EN_LINEA', 'CTA_SIN_NADIE']) {
    const m = app.match(new RegExp(`export const ${k} = '([^']*)'`))
    assert.ok(m, `falta ${k} en la app`)
    assert.equal(m[1], web[k], `${k} distinto entre web y app`)
  }
})
