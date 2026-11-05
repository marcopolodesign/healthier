// Control: el recorrido de navegación (`flow_url`, migración 232) nunca guarda
// mails, tokens ni query que no sea utm_*, y la base lo completa y lo valida.
//   npm run test:flow-url          (parte pura + staging si hay credenciales)
//
// Parte A (sin red): src/lib/flowUrl.js limpia la URL.
// Parte B (staging): las RPC escriben una sola vez, sólo en lo propio, y la
//   columna rechaza lo que no es un array acotado.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import {
  urlLimpia, normalizarRuta, nombreDePantalla, recortar, registrarPantalla,
  leerRecorrido, reiniciarRecorrido, FLOW_MAX, filasDelRecorrido,
} from '../src/lib/flowUrl.js'

const ORIGEN = 'https://staging.healthier.com.ar'

test('la query se descarta salvo utm_*', () => {
  const u = urlLimpia({ origin: ORIGEN, pathname: '/registro', search: '?utm_source=meta&utm_campaign=x&email=a@b.com&token_hash=abc&code=123&dni=30111222' })
  assert.equal(u, `${ORIGEN}/registro?utm_source=meta&utm_campaign=x`)
  for (const prohibido of ['a@b.com', 'token_hash', 'code=', 'dni', '30111222']) assert.ok(!u.includes(prohibido), prohibido)
})

test('sin utm no queda ni el signo de pregunta, y el hash no entra', () => {
  const u = urlLimpia({ origin: ORIGEN, pathname: '/restablecer-contrasena', search: '?code=secreto' })
  assert.equal(u, `${ORIGEN}/restablecer-contrasena`)
})

test('los ids, los números largos y los mails de la ruta pasan a :id', () => {
  assert.equal(normalizarRuta('/paciente/profesional/0b1c2d3e-1111-4222-8333-444455556666'), '/paciente/profesional/:id')
  assert.equal(normalizarRuta('/paciente/sala-espera/0b1c2d3e-1111-4222-8333-444455556666'), '/paciente/sala-espera/:id')
  assert.equal(normalizarRuta('/x/30111222'), '/x/:id')
  assert.equal(normalizarRuta('/x/juan%40mail.com'), '/x/:id')
  assert.equal(normalizarRuta('/r/ABC123'), '/r/:codigo')
  assert.equal(normalizarRuta('/guia/paciente'), '/guia/paciente')
})

test('cada ruta de la app tiene nombre legible', () => {
  assert.equal(nombreDePantalla('/paciente/reservar'), 'Reservar consulta')
  assert.equal(nombreDePantalla('/guia/paciente'), 'Guía de uso')
  assert.equal(nombreDePantalla('/paciente/profesional/:id'), 'Perfil del profesional')
  assert.equal(nombreDePantalla('/ruta/rara'), '/ruta/rara')
})

test('tope: se conserva la primera y las últimas', () => {
  const flujo = Array.from({ length: 70 }, (_, i) => ({ url: `u${i}`, name: 'n', at: '2026-11-04T10:00:00Z' }))
  const r = recortar(flujo)
  assert.equal(r.length, FLOW_MAX)
  assert.equal(r[0].url, 'u0')
  assert.equal(r.at(-1).url, 'u69')
})

test('recarga o misma URL no duplica; la query prohibida no crea pantallas nuevas', () => {
  reiniciarRecorrido()
  const loc = (pathname, search = '') => ({ origin: ORIGEN, pathname, search })
  registrarPantalla(loc('/', '?utm_source=prueba_flow&email=a@b.com'), Date.parse('2026-11-04T10:00:00Z'))
  registrarPantalla(loc('/', '?utm_source=prueba_flow&email=a@b.com'), Date.parse('2026-11-04T10:00:05Z'))
  registrarPantalla(loc('/', '?utm_source=prueba_flow&email=otro@b.com'), Date.parse('2026-11-04T10:00:06Z'))
  registrarPantalla(loc('/registro'), Date.parse('2026-11-04T10:02:05Z'))
  const flujo = leerRecorrido()
  assert.equal(flujo.length, 2)
  assert.equal(JSON.stringify(flujo).includes('@'), false)
  assert.equal(flujo[0].at, '2026-11-04T10:00:00Z')
  const filas = filasDelRecorrido(flujo)
  assert.equal(filas[1].espera, '2 min')
  reiniciarRecorrido()
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

test('staging: la columna se completa una sola vez y sólo la propia', { skip: !hayStaging && 'sin credenciales de staging' }, async () => {
  const admin = createClient(URL_, SVC, { auth: { persistSession: false } })
  const email = `flow-test-${Date.now()}@healthier.app`
  const { data: u, error: e1 } = await admin.auth.admin.createUser({ email, password: 'Flow-test-123', email_confirm: true, user_metadata: { role: 'patient', full_name: 'Flow Test' } })
  assert.ifError(e1)
  const id = u.user.id
  try {
    const cli = createClient(URL_, ANON, { auth: { persistSession: false } })
    const { error: e2 } = await cli.auth.signInWithPassword({ email, password: 'Flow-test-123' })
    assert.ifError(e2)

    const flujo = [
      { url: `${ORIGEN}/?utm_source=prueba_flow`, name: 'Inicio', at: '2026-11-04T10:00:00Z' },
      { url: `${ORIGEN}/registro`, name: 'Registro de paciente', at: '2026-11-04T10:01:00Z' },
    ]
    const a = await cli.rpc('registrar_flow_url_perfil', { p_flow: flujo })
    assert.ifError(a.error)
    assert.equal(a.data, true)
    const b = await cli.rpc('registrar_flow_url_perfil', { p_flow: [{ url: 'otro', name: 'x', at: '2026-11-04T11:00:00Z' }] })
    assert.equal(b.data, false, 'no pisa un recorrido ya guardado')

    const { data: fila } = await admin.from('profiles').select('flow_url').eq('id', id).single()
    assert.deepEqual(fila.flow_url, flujo)

    // Forma y tamaño: un objeto, o un array enorme, no entran.
    const c = await cli.rpc('registrar_flow_url_perfil', { p_flow: { a: 1 } })
    assert.equal(c.data, false)
    const grande = Array.from({ length: 80 }, (_, i) => ({ url: `u${i}`, name: 'n', at: '2026-11-04T10:00:00Z' }))
    const { error: eDirecto } = await cli.from('profiles').update({ flow_url: grande }).eq('id', id)
    assert.ok(eDirecto, 'la columna rechaza un array de más de 60 entradas aunque se escriba directo')

    // Consulta propia: se escribe una vez; la de otro paciente, nunca.
    const { data: propia, error: eIns } = await admin.from('consultations').insert({
      patient_id: id, professional_id: '5eed0001-0000-4000-8000-000000000001',
      status: 'confirmed', modality: 'video', scheduled_at: new Date(Date.now() + 86400000).toISOString(),
    }).select('id').single()
    assert.ifError(eIns)
    try {
      const r1 = await cli.rpc('registrar_flow_url_consulta', { p_consultation_id: propia.id, p_flow: flujo })
      assert.equal(r1.data, true)
      const r2 = await cli.rpc('registrar_flow_url_consulta', { p_consultation_id: propia.id, p_flow: grande.slice(0, 3) })
      assert.equal(r2.data, false, 'no pisa el recorrido de una consulta')
      const { data: cf } = await admin.from('consultations').select('flow_url').eq('id', propia.id).single()
      assert.deepEqual(cf.flow_url, flujo)
    } finally {
      await admin.from('consultations').delete().eq('id', propia.id)
    }

    // Consulta ajena: no se escribe.
    const { data: ajena } = await admin.from('consultations').select('id').neq('patient_id', id).limit(1).maybeSingle()
    if (ajena) {
      const d = await cli.rpc('registrar_flow_url_consulta', { p_consultation_id: ajena.id, p_flow: flujo })
      assert.equal(d.data, false, 'no escribe en la consulta de otro paciente')
    }
  } finally {
    await admin.auth.admin.deleteUser(id)
  }
})
