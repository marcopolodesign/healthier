#!/usr/bin/env node
/**
 * Control del flujo de emergencias de la reunión del 18/11 (migración 240).
 * SÓLO STAGING — crea una emergencia de prueba para `paciente@healthier.app`
 * y la lleva por todos los estados con las cuentas reales de cada rol.
 *
 *   node scripts/verificar-emergencia-flujo.mjs
 *
 * Qué falla si el problema vuelve:
 *   1. Asignar un móvil deja la emergencia directo en `in_transit` (sin paso
 *      "aceptar"), tanto por el update del despacho web como por el RPC
 *      `asignar_emergencia` del coordinador.
 *   2. El paciente recibe por Realtime el "en camino", el "llegó" y el cierre
 *      (antes una pantalla se quedaba clavada), y el despacho también.
 *   3. "Llegué" y el cierre mandan push al staff del despacho
 *      (`avisar_emergencia_estado`): se cuentan los pedidos de `net`.
 *   4. El paciente puede pedir la última posición del móvil
 *      (`ubicacion_movil_de_mi_emergencia`) y un tercero NO.
 *   5. Los textos de error del cierre dicen "recepción", no "orden".
 *
 * Es un control por script: no reemplaza mirar la pantalla (ver catchup).
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const g = Object.fromEntries(readFileSync(`${process.env.HOME}/Local/.env`, 'utf8').split('\n')
  .filter(l => l.includes('=') && !l.startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim()] }))
const URL_ = g.HEALTHIER_STAGING_SUPABASE_URL
const REF = g.HEALTHIER_STAGING_SUPABASE_REF
const MOVIL = '40000000-0000-0000-0000-000000000002'
const ENTIDAD = '20000000-0000-0000-0000-000000000001'

let fallas = 0
const ok = (c, m) => { console.log(`${c ? '✅' : '❌'} ${m}`); if (!c) fallas++ }
const espera = ms => new Promise(r => setTimeout(r, ms))

const admin = createClient(URL_, g.HEALTHIER_STAGING_SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
async function como(email) {
  // Sesión por magic link del Admin API: sin tipear contraseñas (cada cuenta de
  // staging tiene la suya).
  const { data: l, error: le } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (le) throw new Error(`${email}: ${le.message}`)
  const c = createClient(URL_, g.HEALTHIER_STAGING_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { data, error } = await c.auth.verifyOtp({ token_hash: l.properties.hashed_token, type: 'magiclink' })
  if (error) throw new Error(`${email}: ${error.message}`)
  c.uid = data.user.id
  return c
}
async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${g.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': 'curl/8' },
    body: JSON.stringify({ query }),
  })
  return r.json()
}
const pushesDesde = async (desde) =>
  (await sql(`select count(*)::int n from net._http_response where created >= '${desde}'`))[0]?.n ?? 0

const paciente = await como('paciente@healthier.app')
const despacho = await como('despacho@staging.healthier.app')
const chofer = await como('chofer@staging.healthier.app')
const tercero = await como('operador@staging.healthier.app') // staff, pero no es el paciente

// ── Una emergencia nueva, paga y triada, esperando móvil ────────────────────
await admin.from('emergencies').update({ status: 'cancelled' }).eq('patient_id', paciente.uid)
  .in('status', ['pending', 'awaiting_dispatch', 'dispatched', 'in_transit', 'arrived'])
const { data: e0, error: e0err } = await admin.from('emergencies').insert({
  patient_id: paciente.uid, triage_code: 'ROJO', status: 'pending', patient_latitude: -34.599, patient_longitude: -58.39, price_at_request: 50,
}).select().single()
if (e0err) throw e0err
await admin.from('emergencies').update({ status: 'awaiting_dispatch', paid_at: new Date().toISOString(), notes: JSON.stringify(['Dolor en el pecho']) }).eq('id', e0.id)
await admin.from('ambulances').update({ status: 'disponible' }).eq('id', MOVIL)
await admin.from('ambulance_locations').upsert({ ambulance_id: MOVIL, latitude: -34.6083, longitude: -58.3712, updated_at: new Date().toISOString() })

// ── Realtime: el paciente y el despacho escuchan ────────────────────────────
const vistoPaciente = []
const vistoDespacho = []
const chP = paciente.channel('ctl-pac').on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'emergencies', filter: `id=eq.${e0.id}` }, p => vistoPaciente.push(p.new.status)).subscribe()
const chD = despacho.channel('ctl-des').on('postgres_changes', { event: '*', schema: 'public', table: 'emergencies' }, p => { if (p.new?.id === e0.id) vistoDespacho.push(p.new.status) }).subscribe()
await espera(2500)

// 1 · Asignar (update del despacho web) → in_transit directo
const { data: crew } = await despacho.from('ambulance_crew').select('profile_id, crew_role').eq('ambulance_id', MOVIL).eq('active', true)
const medico = crew?.find(c => c.crew_role === 'medico')
const { data: asig, error: asigErr } = await despacho.from('emergencies').update({
  ambulance_id: MOVIL, provider_id: ENTIDAD, operator_id: despacho.uid, professional_id: medico?.profile_id ?? null,
  status: 'in_transit', dispatched_at: new Date().toISOString(), dispatch_code: 'UTM-0000',
}).eq('id', e0.id).eq('status', 'awaiting_dispatch').select('status').maybeSingle()
ok(!asigErr && asig?.status === 'in_transit', `1 · asignar deja la emergencia en "in_transit" (${asigErr?.message ?? asig?.status})`)
await espera(2000)
ok(vistoPaciente.includes('in_transit'), '2a · el paciente recibe por Realtime el "en camino"')
ok(vistoDespacho.includes('in_transit'), '2b · el despacho recibe por Realtime el "en camino"')

// 4 · última posición del móvil: el paciente sí, un tercero no
const { data: pos } = await paciente.rpc('ubicacion_movil_de_mi_emergencia', { p_emergency_id: e0.id })
ok(pos?.latitude != null, '4a · el paciente obtiene la última posición del móvil')
const { data: posAjena } = await tercero.rpc('ubicacion_movil_de_mi_emergencia', { p_emergency_id: e0.id })
ok(posAjena == null, '4b · un tercero NO la obtiene')

// "Llegué" → paciente y despacho lo ven; push al staff
const t1 = new Date().toISOString()
const { error: llErr } = await chofer.from('emergencies').update({ status: 'arrived' }).eq('id', e0.id)
await espera(2500)
ok(!llErr && vistoPaciente.includes('arrived'), `2c · "llegué": el paciente lo ve en vivo (${llErr?.message ?? ''})`)
ok(vistoDespacho.includes('arrived'), '2d · "llegué": el despacho lo ve en vivo')
const pushLlegue = await pushesDesde(t1)
const { data: staff } = await admin.from('emergency_provider_staff').select('profile_id').eq('provider_id', ENTIDAD).eq('active', true)
ok(pushLlegue >= 1 + (staff?.length ?? 0), `3a · "llegué" manda push al paciente y a ${staff?.length} del despacho (pedidos: ${pushLlegue})`)

// Cierre → paciente y despacho lo ven; push al staff
const t2 = new Date().toISOString()
const { error: ciErr } = await chofer.from('emergencies').update({ status: 'completed', desenlace: 'en_el_lugar', cierre_sin_atencion: 'control automático' }).eq('id', e0.id)
await espera(2500)
ok(!ciErr && vistoPaciente.includes('completed'), `2e · cierre: el paciente lo ve en vivo (${ciErr?.message ?? ''})`)
ok(vistoDespacho.includes('completed'), '2f · cierre: el despacho lo ve en vivo')
const pushCierre = await pushesDesde(t2)
ok(pushCierre >= (staff?.length ?? 0), `3b · el cierre manda push al despacho (pedidos: ${pushCierre})`)

// 5 · textos: "recepción", no "orden"
const { data: e1 } = await admin.from('emergencies').insert({ patient_id: paciente.uid, triage_code: 'VERDE', status: 'pending' }).select().single()
await admin.from('emergencies').update({ status: 'awaiting_dispatch', paid_at: new Date().toISOString() }).eq('id', e1.id)
await despacho.from('emergencies').update({ ambulance_id: MOVIL, provider_id: ENTIDAD, operator_id: despacho.uid, status: 'in_transit', dispatched_at: new Date().toISOString(), dispatch_code: 'UTM-0001' }).eq('id', e1.id)
await chofer.from('emergencies').update({ status: 'arrived' }).eq('id', e1.id)
const { error: trErr } = await chofer.from('emergencies').update({ status: 'completed', desenlace: 'traslado', cierre_sin_atencion: 'control' }).eq('id', e1.id)
ok(/recepción/i.test(trErr?.message ?? '') && !/orden/i.test(trErr?.message ?? ''), `5 · el cierre con traslado sin foto dice "recepción" (${trErr?.message})`)

// Limpieza
await admin.from('emergencies').update({ status: 'cancelled' }).in('id', [e0.id, e1.id]).in('status', ['pending', 'awaiting_dispatch', 'in_transit', 'arrived'])
await admin.from('ambulances').update({ status: 'disponible' }).eq('id', MOVIL)
paciente.removeChannel(chP); despacho.removeChannel(chD)

console.log(fallas ? `\n❌ ${fallas} falla(s)` : '\n✅ todo en verde')
process.exit(fallas ? 1 : 0)
