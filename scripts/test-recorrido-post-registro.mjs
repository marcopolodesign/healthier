// Control: el recorrido del paciente SIGUE anotándose después del alta
// (migración 247, `recorrido_paciente`). Antes se cortaba en "Completar
// registro" / "Onboarding del paciente" y no se sabía qué hacía después.
//   npm run test:recorrido-post-registro   (parte pura + staging si hay credenciales)
//
// Parte A (sin red): con un paciente logueado cada pantalla va a la RPC con
//   via 'web', sin duplicados seguidos; los eventos del embudo se vuelven hitos;
//   sin paciente no se manda nada. Y las cuentas del script de embudo.
// Parte B (staging): la RPC guarda, no duplica, recorta a 100 pantallas, sólo
//   para pacientes, y el paciente no puede leer la tabla (sólo super admin).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import {
  registrarPantalla, seguirRecorridoDelPaciente, anotarHito, reiniciarRecorrido,
  HITOS, HITO_DE_EVENTO,
} from '../src/lib/flowUrl.js'
import { PASOS, llegoA, ultimaPantalla, abandonoElPago } from './embudo-pacientes.mjs'

const ORIGEN = 'https://staging.healthier.com.ar'
const loc = pathname => ({ origin: ORIGEN, pathname, search: '' })

function clienteFalso() {
  const llamadas = []
  return { llamadas, rpc: async (fn, args) => { llamadas.push({ fn, ...args.p_entradas[0] }); return { data: 1, error: null } } }
}
const esperar = () => new Promise(r => setTimeout(r, 20))

test('después del alta, cada pantalla del paciente va a la base (web) sin duplicados seguidos', async () => {
  reiniciarRecorrido()
  const cli = clienteFalso()
  // Antes del login: se anota sólo en el navegador.
  registrarPantalla(loc('/registro'))
  seguirRecorridoDelPaciente(false, cli)
  await esperar()
  assert.equal(cli.llamadas.length, 0, 'sin paciente logueado no se manda nada')

  // Termina el alta: el perfil pasa a paciente → se manda la pantalla actual.
  registrarPantalla(loc('/paciente/onboarding'))
  seguirRecorridoDelPaciente(true, cli)
  registrarPantalla(loc('/paciente/dashboard'))
  registrarPantalla(loc('/paciente/dashboard'))
  registrarPantalla(loc('/paciente/buscar'))
  registrarPantalla(loc('/paciente/profesional/0b1c2d3e-1111-4222-8333-444455556666'))
  anotarHito('vio_horarios')
  registrarPantalla(loc('/paciente/farmacia'))
  await esperar()

  const nombres = cli.llamadas.map(l => l.name)
  assert.deepEqual(nombres, [
    'Onboarding del paciente', 'Inicio del paciente', 'Buscar profesional',
    'Perfil del profesional', 'Vio horarios', 'Farmacia',
  ])
  assert.ok(cli.llamadas.every(l => l.fn === 'anotar_recorrido' && l.via === 'web'))
  assert.equal(cli.llamadas[4].hito, 'vio_horarios')
  assert.ok(cli.llamadas[3].url.endsWith('/paciente/profesional/:id'), 'el id del profesional no viaja')
  assert.ok(!JSON.stringify(cli.llamadas).includes('0b1c2d3e'))

  // Cierre de sesión: se corta.
  reiniciarRecorrido()
  registrarPantalla(loc('/login'))
  anotarHito('pago')
  await esperar()
  assert.equal(cli.llamadas.length, 6)
})

test('los eventos del embudo tienen hito, y todo hito tiene nombre', () => {
  for (const ev of ['booking_slots_view', 'begin_checkout', 'purchase', 'payment_error', 'booking_pro_select']) {
    assert.ok(HITO_DE_EVENTO[ev], ev)
  }
  for (const h of Object.values(HITO_DE_EVENTO)) assert.ok(HITOS[h], h)
  for (const h of Object.keys(HITOS)) assert.match(h, /^[a-z_]{2,40}$/) // lo que acepta la RPC
})

test('el analytics manda el hito (track → anotarHito)', () => {
  const src = readFileSync(new URL('../src/utils/analytics.js', import.meta.url), 'utf8')
  assert.match(src, /HITO_DE_EVENTO\[eventName\]/)
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
  assert.match(app, /seguirRecorridoDelPaciente\(profile\?\.role === 'patient'\)/)
})

test('embudo: pasos, última pantalla y abandono del pago', () => {
  const p = {
    completoAlta: true, reservo: false,
    antes: [{ name: 'Completar registro' }],
    despues: [
      { name: 'Inicio del paciente', via: 'app' },
      { name: 'Perfil del profesional', via: 'app' },
      { name: 'Vio horarios', hito: 'vio_horarios', via: 'app' },
      { name: 'Pago de la consulta', via: 'app' },
      { name: 'Llegó al pago', hito: 'llego_al_pago', via: 'app', at: '2026-11-24T10:00:00Z' },
      { name: 'Farmacia', via: 'web' },
    ],
  }
  const llego = Object.fromEntries(PASOS.map(s => [s.clave, llegoA(s, p)]))
  assert.equal(llego.inicio, true)
  assert.equal(llego.perfil_pro, true)
  assert.equal(llego.horarios, true)
  assert.equal(llego.pago, true)
  assert.equal(llego.pago_ok, false)
  assert.equal(llego.farmacia, true)
  assert.equal(ultimaPantalla(p), 'Farmacia')
  assert.equal(abandonoElPago(p), true)
  assert.equal(abandonoElPago({ ...p, despues: [...p.despues, { name: 'Pagó', hito: 'pago' }] }), false)
  assert.equal(abandonoElPago({ ...p, reservo: true, ultimaConsulta: '2026-11-01T00:00:00Z' }), true, 'una consulta vieja no tapa el abandono')
  assert.equal(abandonoElPago({ ...p, reservo: true, ultimaConsulta: '2026-11-24T10:05:00Z' }), false)
  assert.equal(ultimaPantalla({ antes: [{ name: 'Completar registro' }], despues: [] }), 'Completar registro (antes del alta)')
})

// ── Parte B: staging ────────────────────────────────────────────────────────
function leerEnv() {
  const e = { ...process.env }
  const f = `${process.env.HOME}/Local/.env`
  if (existsSync(f)) {
    for (const l of readFileSync(f, 'utf8').split('\n')) {
      const m = l.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m && !(m[1] in e)) e[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  }
  return e
}
const env = leerEnv()
const URL_ = env.HEALTHIER_STAGING_SUPABASE_URL
const SVC = env.HEALTHIER_STAGING_SUPABASE_SERVICE_ROLE_KEY
const ANON = env.HEALTHIER_STAGING_SUPABASE_ANON_KEY
const hayStaging = Boolean(URL_ && SVC && ANON)

async function usuario(admin, role) {
  const email = `recorrido-test-${role}-${Date.now()}@healthier.app`
  const { data: u, error } = await admin.auth.admin.createUser({ email, password: 'Recorrido-test-123', email_confirm: true, user_metadata: { role, full_name: 'Recorrido Test' } })
  assert.ifError(error)
  const cli = createClient(URL_, ANON, { auth: { persistSession: false } })
  const { error: e2 } = await cli.auth.signInWithPassword({ email, password: 'Recorrido-test-123' })
  assert.ifError(e2)
  return { id: u.user.id, cli }
}

test('staging: anotar_recorrido guarda, no duplica, recorta y sólo para pacientes', { skip: !hayStaging && 'sin credenciales de staging' }, async () => {
  const admin = createClient(URL_, SVC, { auth: { persistSession: false } })
  const pac = await usuario(admin, 'patient')
  const pro = await usuario(admin, 'professional')
  try {
    const e = (name, extra = {}) => ({ url: `${ORIGEN}/x/${name}`, name, at: new Date().toISOString(), via: 'web', ...extra })
    const a = await pac.cli.rpc('anotar_recorrido', { p_entradas: [e('inicio'), e('inicio'), e('buscar'), e('Vio horarios', { url: `${ORIGEN}/x/buscar`, hito: 'vio_horarios' }), e('Vio horarios', { url: `${ORIGEN}/x/buscar`, hito: 'vio_horarios' }), e('buscar')] })
    assert.ifError(a.error)
    assert.equal(a.data, 3, 'pantalla repetida, hito repetido y volver a la misma pantalla tras un hito no suman')

    const b = await pac.cli.rpc('anotar_recorrido', { p_entradas: [{ url: 'x', name: 'x', at: 'no-es-fecha', via: 'tv' }, { url: 'y', name: 'y', via: 'app', hito: 'DROP TABLE' }] })
    assert.equal(b.data, 0, 'via inválida o hito raro se descartan')

    // La RPC vuelve a limpiar: sin hash, query sólo utm_*, nada con @.
    const q = await pac.cli.rpc('anotar_recorrido', { p_entradas: [
      e('Restablecer', { url: `${ORIGEN}/restablecer-contrasena?code=SECRETO&token_hash=zz&utm_source=meta#access_token=yy` }),
      e('Con mail', { url: `${ORIGEN}/x/juan@mail.com` }),
      e('Con mail codificado', { url: `${ORIGEN}/x/juan%40mail.com` }),
    ] })
    assert.equal(q.data, 1, 'las URLs con mail se descartan')
    const { data: limpia } = await admin.from('recorrido_paciente').select('url').eq('user_id', pac.id).eq('name', 'Restablecer').single()
    assert.equal(limpia.url, `${ORIGEN}/restablecer-contrasena?utm_source=meta`)
    const { data: todas } = await admin.from('recorrido_paciente').select('url, name').eq('user_id', pac.id)
    assert.ok(!JSON.stringify(todas).match(/SECRETO|token_hash|access_token|@|%40/), 'nada sensible quedó guardado')

    // No hay forma de escribir en el recorrido de otro: la RPC no recibe user_id.
    const intruso = await pac.cli.rpc('anotar_recorrido', { p_entradas: [e('otro', { user_id: pro.id })] })
    assert.equal(intruso.data, 1)
    const { data: delOtro } = await admin.from('recorrido_paciente').select('id').eq('user_id', pro.id)
    assert.equal(delOtro.length, 0, 'un user_id en la entrada se ignora')
    const directo = await pac.cli.from('recorrido_paciente').insert({ user_id: pro.id, at: new Date().toISOString(), url: 'x', name: 'x', via: 'web' })
    assert.ok(directo.error, 'no se puede insertar directo en la tabla')

    const { data: propias } = await pac.cli.from('recorrido_paciente').select('id')
    assert.equal(propias.length, 0, 'el paciente no lee la tabla (sólo super admin)')

    // Tope: 110 pantallas distintas más → quedan 100 + el hito.
    for (let lote = 0; lote < 5; lote++) {
      const entradas = Array.from({ length: 22 }, (_, i) => e(`p${lote * 22 + i}`))
      await pac.cli.rpc('anotar_recorrido', { p_entradas: entradas })
    }
    const { data: filas } = await admin.from('recorrido_paciente').select('name, hito, via').eq('user_id', pac.id)
    assert.equal(filas.filter(f => !f.hito).length, 100)
    assert.equal(filas.filter(f => f.hito === 'vio_horarios').length, 1, 'el hito sobrevive al recorte de pantallas')
    assert.ok(filas.some(f => f.name === 'p109'))
    assert.ok(!filas.some(f => f.name === 'inicio'), 'se van las más viejas')

    const c = await pro.cli.rpc('anotar_recorrido', { p_entradas: [e('inicio')] })
    assert.equal(c.data, 0, 'un profesional no anota')

    const anon = createClient(URL_, ANON, { auth: { persistSession: false } })
    const d = await anon.rpc('anotar_recorrido', { p_entradas: [e('inicio')] })
    assert.ok(d.error, 'sin sesión no se puede')
  } finally {
    await admin.auth.admin.deleteUser(pac.id)
    await admin.auth.admin.deleteUser(pro.id)
  }
})
