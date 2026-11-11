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
