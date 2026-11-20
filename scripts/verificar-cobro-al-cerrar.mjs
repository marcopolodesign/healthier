#!/usr/bin/env node
/**
 * Control: CERRAR UNA EMERGENCIA, POR CUALQUIER CAMINO, NO DEJA PLATA SIN COBRAR
 * (migración 245). SÓLO STAGING, contra el sandbox real de Mercado Pago: cada
 * caso hace una reserva de verdad (tarjeta de prueba APRO) y cierra la emergencia
 * como lo hace cada pantalla, SIN llamar a `mp-capture` desde el cliente.
 *
 *   node scripts/verificar-cobro-al-cerrar.mjs
 *
 * Falla si alguna emergencia queda `completed` con la reserva sin capturar, o sin
 * plata y sin el "cierre sin pago" asentado:
 *   1 operador (registro del día) · 2 operador en modo operador (sesión del
 *   profesional) · 3 médico (web) · 4 tripulación (chofer) · 5 despacho cerrando
 *   directo · 6 despacho por el camino de siempre (cobra y cierra: no se cobra dos
 *   veces) · 7 bonificada · 8 sin reserva · 9 barrido (si el trigger falló) ·
 *   10 cancelada sin cobro (libera) · 11 el diagnóstico del operador no parece
 *   "sin atención".
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const g = Object.fromEntries(readFileSync(`${process.env.HOME}/Local/.env`, 'utf8').split('\n')
  .filter(l => l.includes('=') && !l.startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim()] }))
const webEnv = (() => {
  for (const r of [new URL('../.env', import.meta.url), join(process.env.HOME, 'Local/Healthier/website/.env')]) {
    try { return Object.fromEntries(readFileSync(r, 'utf8').split('\n').filter(l => /^[A-Z0-9_]+=/.test(l)).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')] })) } catch { /* sigue */ }
  }
  return {}
})()
const URL_ = g.HEALTHIER_STAGING_SUPABASE_URL
const REF = g.HEALTHIER_STAGING_SUPABASE_REF
const SERVICE = g.HEALTHIER_STAGING_SUPABASE_SERVICE_ROLE_KEY
const MP_PUBLIC_KEY = webEnv.VITE_MP_PUBLIC_KEY_SANDBOX
if (!URL_?.includes('itjhrvlzuqvyhqtffumc')) { console.error('Esto corre sólo contra staging.'); process.exit(2) }
const MOVIL = '40000000-0000-0000-0000-000000000001'
const ENTIDAD = '20000000-0000-0000-0000-000000000001'

let fallas = 0
const ok = (c, m, x) => { console.log(`${c ? '✅' : '❌'} ${m}${x ? ` — ${x}` : ''}`); if (!c) fallas++ }
const espera = ms => new Promise(r => setTimeout(r, ms))
const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } })
const sqlq = async q => (await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${g.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': 'curl/8' }, body: JSON.stringify({ query: q }) })).json()
async function como(email) {
  const { data: l, error: le } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (le) throw new Error(`${email}: ${le.message}`)
  const c = createClient(URL_, g.HEALTHIER_STAGING_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { data, error } = await c.auth.verifyOtp({ token_hash: l.properties.hashed_token, type: 'magiclink' })
  if (error) throw new Error(`${email}: ${error.message}`)
  c.uid = data.user.id; c.jwt = data.session.access_token
  return c
}
const fn = async (nombre, jwt, body) => {
  const r = await fetch(`${URL_}/functions/v1/${nombre}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}`, apikey: g.HEALTHIER_STAGING_SUPABASE_ANON_KEY }, body: JSON.stringify(body) })
  return { status: r.status, body: await r.json().catch(() => ({})) }
}

// ── Cuentas ────────────────────────────────────────────────────────────────
async function asegurarPaciente(email) {
  const { data: l } = await admin.auth.admin.listUsers({ perPage: 200 })
  let u = l.users.find(x => x.email === email)
  if (!u) ({ data: { user: u } } = await admin.auth.admin.createUser({ email, password: 'staging', email_confirm: true }))
  await admin.from('profiles').upsert({ id: u.id, email, full_name: 'Paciente Control Cobro', role: 'patient' })
}
await asegurarPaciente('op-test-paciente@staging.healthier.app')
const paciente = await como('op-test-paciente@staging.healthier.app')
const op1 = await como('operador1@staging.healthier.app')
const op4 = await como('operador4@staging.healthier.app')
const medico = await como('clinica@staging.healthier.app')
const chofer = await como('chofer@staging.healthier.app')
const despacho = await como('despacho@staging.healthier.app')
const despachoOp = await como('operador@staging.healthier.app')
const proPlano = await como('profesional@healthier.app')
const PRO = proPlano.uid
const { data: proPerfil } = await admin.from('profiles').select('dni').eq('id', PRO).single()
await admin.from('emergency_provider_profesionales').upsert({ provider_id: ENTIDAD, professional_id: PRO, active: true }, { onConflict: 'provider_id,professional_id' })

// ── Reservas de verdad en el sandbox de Mercado Pago ───────────────────────
async function tokenDeTarjeta() {
  const r = await fetch(`https://api.mercadopago.com/v1/card_tokens?public_key=${MP_PUBLIC_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ card_number: process.env.MP_CARD || '5031755734530604', security_code: '123', expiration_month: 11, expiration_year: 2030, cardholder: { name: 'APRO', identification: { type: 'DNI', number: '12345678' } } }),
  })
  const j = await r.json()
  if (!j.id) throw new Error(`card_token: ${JSON.stringify(j)}`)
  return j.id
}
async function emergenciaPaga({ reservar = true, bonificada = false } = {}) {
  await admin.from('emergencies').update({ status: 'cancelled' }).eq('patient_id', paciente.uid).in('status', ['pending', 'awaiting_dispatch', 'dispatched', 'in_transit', 'arrived'])
  const { data: e, error } = await admin.from('emergencies').insert({ patient_id: paciente.uid, triage_code: 'ROJO', status: 'pending', patient_latitude: -34.599, patient_longitude: -58.39, notes: '["Control cobro al cerrar"]' }).select().single()
  if (error) throw error
  if (reservar) {
    const r = await fn('mp-payment', paciente.jwt, {
      emergencyId: e.id, cardToken: await tokenDeTarjeta(), paymentMethodId: process.env.MP_METHOD || 'master',
      payerEmail: process.env.MP_PAYER_EMAIL || 'comprador.prueba.healthier@gmail.com', payerDocType: 'DNI', payerDocNumber: '12345678',
    })
    if (r.status !== 200 || !r.body?.data?.approved) throw new Error(`la reserva falló: ${r.status} ${JSON.stringify(r.body)}`)
  } else if (bonificada) {
    await admin.from('emergencies').update({ paid_at: new Date().toISOString(), bonificada: true }).eq('id', e.id)
  } else {
    await admin.from('emergencies').update({ paid_at: new Date().toISOString() }).eq('id', e.id)
  }
  return e.id
}
const enCurso = (id, cambios = {}) => admin.from('emergencies').update({ ambulance_id: MOVIL, provider_id: ENTIDAD, status: 'arrived', dispatched_at: new Date().toISOString(), dispatch_code: 'UTM-COBRO', ...cambios }).eq('id', id)
const pago = async id => (await admin.from('payments').select('status, captured_at, auth_cancelled_at, mp_payment_id').eq('emergency_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle()).data
const fila = async id => (await admin.from('emergencies').select('status, cierre_sin_pago, cierre_sin_pago_por, cierre_sin_pago_at, cierre_sin_atencion, diagnostico_cierre, nota_cierre, bonificada').eq('id', id).single()).data
async function esperarPago(id, estado, segundos = 40) {
  for (let i = 0; i < segundos / 2; i++) { const p = await pago(id); if (p?.status === estado) return p; await espera(2000) }
  return pago(id)
}
const reservaAuth = async (id, etiqueta) => { const p = await pago(id); ok(p?.status === 'authorized' && !!p.mp_payment_id, `${etiqueta}: la reserva está autorizada antes de cerrar`, p?.status) }

const DESENLACE = { desenlace: 'en_el_lugar' }
// ═══ 1 · operador (registro del día, 241) ═══════════════════════════════════
console.log('\n▸ 1 · operador (registro del día)')
{
  const id = await emergenciaPaga(); await enCurso(id, { professional_id: op1.uid, cuenta_operador_id: op1.uid })
  await reservaAuth(id, 'operador')
  const { error } = await op1.from('emergencies').update({ status: 'completed', ...DESENLACE, diagnostico_cierre: 'Lumbalgia', nota_cierre: 'Sin novedades' }).eq('id', id)
  ok(!error, `el operador cierra desde su pantalla, sin tocar mp-capture (${error?.message ?? 'ok'})`)
  const p = await esperarPago(id, 'approved')
  ok(p?.status === 'approved' && !!p.captured_at, 'la reserva queda CAPTURADA (lo hizo el servidor al cerrar)', p?.status)
  const f = await fila(id)
  ok(!f.cierre_sin_atencion && f.diagnostico_cierre === 'Lumbalgia' && f.nota_cierre === 'Sin novedades', '11 · el diagnóstico y la nota quedan en su columna: NO figura "cerrada sin atención"')
  ok(!f.cierre_sin_pago_at, 'con plata cobrada no se registra un "cierre sin pago"')
}
// ═══ 2 · operador en modo operador (sesión del profesional) ═════════════════
console.log('\n▸ 2 · operador en modo operador')
{
  await admin.rpc('cerrar_turnos_previos_del_movil', { p_cuenta: op4.uid, p_conservar: null })
  const ped = await fn('operador-modo', op4.jwt, { dni: String(proPerfil.dni) })
  await despachoOp.rpc('resolver_ingreso_operador', { p_id: ped.body.ingreso_id, p_aprobar: true })
  const ent = await fn('operador-modo', op4.jwt, { ingresoId: ped.body.ingreso_id })
  ok(ent.body.modo === 'profesional', `ingresa como el profesional (${ent.body.modo ?? JSON.stringify(ent.body)})`)
  const pro = createClient(URL_, g.HEALTHIER_STAGING_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  await pro.auth.setSession({ access_token: ent.body.session.access_token, refresh_token: ent.body.session.refresh_token })
  const id = await emergenciaPaga(); await enCurso(id, { professional_id: PRO, cuenta_operador_id: op4.uid })
  await reservaAuth(id, 'modo operador')
  const { error } = await pro.from('emergencies').update({ status: 'completed', ...DESENLACE, diagnostico_cierre: 'Cefalea tensional' }).eq('id', id)
  ok(!error, `cierra como el profesional (${error?.message ?? 'ok'})`)
  const p = await esperarPago(id, 'approved')
  ok(p?.status === 'approved' && !!p.captured_at, 'la reserva queda CAPTURADA', p?.status)
  await pro.rpc('terminar_turno_operador')
}
// ═══ 3 · médico (web) ═══════════════════════════════════════════════════════
console.log('\n▸ 3 · médico en /profesional/emergencias')
{
  const id = await emergenciaPaga(); await enCurso(id, { professional_id: medico.uid })
  await reservaAuth(id, 'médico')
  const { error } = await medico.from('emergencies').update({ status: 'completed', ...DESENLACE, cierre_sin_atencion: 'El paciente rechazó la atención' }).eq('id', id)
  ok(!error, `el médico cierra (${error?.message ?? 'ok'})`)
  const p = await esperarPago(id, 'approved')
  ok(p?.status === 'approved' && !!p.captured_at, 'la reserva queda CAPTURADA', p?.status)
}
// ═══ 4 · tripulación (chofer) ═══════════════════════════════════════════════
console.log('\n▸ 4 · tripulación (chofer)')
{
  const id = await emergenciaPaga(); await enCurso(id, {})
  await reservaAuth(id, 'chofer')
  const { error } = await chofer.from('emergencies').update({ status: 'completed', ...DESENLACE, cierre_sin_atencion: 'Cierre por la tripulación' }).eq('id', id)
  ok(!error, `la tripulación cierra (${error?.message ?? 'ok'})`)
  const p = await esperarPago(id, 'approved')
  ok(p?.status === 'approved' && !!p.captured_at, 'la reserva queda CAPTURADA', p?.status)
}
// ═══ 5 · despacho cerrando directo ══════════════════════════════════════════
console.log('\n▸ 5 · despacho cerrando sin pasar por mp-capture')
{
  const id = await emergenciaPaga(); await enCurso(id, {})
  await reservaAuth(id, 'despacho directo')
  const { error } = await despacho.from('emergencies').update({ status: 'completed', ...DESENLACE, cierre_sin_atencion: 'Cierre del despacho' }).eq('id', id)
  ok(!error, `el despacho cierra (${error?.message ?? 'ok'})`)
  const p = await esperarPago(id, 'approved')
  ok(p?.status === 'approved' && !!p.captured_at, 'la reserva queda CAPTURADA', p?.status)
}
// ═══ 6 · despacho por el camino de siempre (cobra y cierra) ═════════════════
console.log('\n▸ 6 · despacho: cobra y después cierra (camino de siempre)')
{
  const id = await emergenciaPaga(); await enCurso(id, {})
  const cap = await fn('mp-capture', despacho.jwt, { action: 'capture-emergency', emergencyId: id })
  ok(cap.status === 200 && cap.body.data?.captured, `capture-emergency del despacho (${cap.status})`)
  const { error } = await despacho.from('emergencies').update({ status: 'completed', ...DESENLACE, cierre_sin_atencion: 'Cierre del despacho' }).eq('id', id)
  ok(!error, 'cierra después de cobrar')
  await espera(6000)
  const p = await pago(id)
  ok(p?.status === 'approved', 'sigue cobrada una sola vez (el cierre no vuelve a capturar)', p?.status)
}
// ═══ 7 · bonificada ═════════════════════════════════════════════════════════
console.log('\n▸ 7 · bonificada (sin plata): el mensaje de cierre queda asentado')
{
  const id = await emergenciaPaga({ reservar: false, bonificada: true }); await enCurso(id, { professional_id: op1.uid })
  const { error } = await op1.from('emergencies').update({ status: 'completed', ...DESENLACE, diagnostico_cierre: 'Control' }).eq('id', id)
  ok(!error, `el operador cierra una bonificada (${error?.message ?? 'ok'})`)
  const f = await fila(id)
  ok(!!f.cierre_sin_pago && f.cierre_sin_pago_por === op1.uid && !!f.cierre_sin_pago_at, 'queda el "cierre sin pago": mensaje, quién y cuándo', f.cierre_sin_pago)
}
// ═══ 8 · sin reserva ════════════════════════════════════════════════════════
console.log('\n▸ 8 · sin reserva de pago')
{
  const id = await emergenciaPaga({ reservar: false }); await enCurso(id, { professional_id: op1.uid })
  const { error } = await op1.from('emergencies').update({ status: 'completed', ...DESENLACE, diagnostico_cierre: 'Control' }).eq('id', id)
  ok(!error, 'el operador cierra')
  const f = await fila(id)
  ok(!!f.cierre_sin_pago_at && /sin cobro/i.test(f.cierre_sin_pago ?? ''), 'queda el "cierre sin pago" (no había reserva)', f.cierre_sin_pago)
}
// ═══ 8b · si ya hay mensaje (cerrar-sin-pago del despacho) no se pisa ═══════
{
  const id = await emergenciaPaga({ reservar: false, bonificada: true }); await enCurso(id, {})
  const r = await fn('mp-capture', despacho.jwt, { action: 'cerrar-sin-pago', emergencyId: id, nota: 'Mensaje del despacho' })
  ok(r.status === 200, `cerrar-sin-pago del despacho (${r.status})`)
  await despacho.from('emergencies').update({ status: 'completed', ...DESENLACE, cierre_sin_atencion: 'x' }).eq('id', id)
  const f = await fila(id)
  ok(f.cierre_sin_pago === 'Mensaje del despacho', 'el mensaje que escribió el despacho se conserva', f.cierre_sin_pago)
}
// ═══ 9 · el barrido, si el trigger falló ════════════════════════════════════
console.log('\n▸ 9 · barrido (backstop)')
{
  await sqlq('alter table public.emergencies disable trigger emergencies_cobrar_al_cerrar')
  try {
    const id = await emergenciaPaga(); await enCurso(id, { professional_id: op1.uid })
    const { error } = await op1.from('emergencies').update({ status: 'completed', ...DESENLACE, diagnostico_cierre: 'Control' }).eq('id', id)
    ok(!error, 'cierra con el trigger apagado (simula una captura que no salió)')
    await espera(4000)
    ok((await pago(id))?.status === 'authorized', 'sin el trigger, la reserva queda sin capturar')
    await sqlq('alter table public.emergencies enable trigger emergencies_cobrar_al_cerrar')
    const sw = await fetch(`${URL_}/functions/v1/mp-capture`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE}` }, body: JSON.stringify({ action: 'sweep' }) })
    const swj = await sw.json().catch(() => ({}))
    ok(sw.status === 200 && swj.data?.emergencias?.captured >= 1, `el barrido la captura (${JSON.stringify(swj.data?.emergencias)})`)
    ok((await pago(id))?.status === 'approved', 'la reserva queda CAPTURADA por el barrido')
  } finally {
    await sqlq('alter table public.emergencies enable trigger emergencies_cobrar_al_cerrar')
  }
}
// ═══ 10 · cancelada sin cobro: el barrido libera la reserva ═════════════════
console.log('\n▸ 10 · cancelada sin cobro')
{
  const id = await emergenciaPaga()
  await admin.from('emergencies').update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancellation_charged: false }).eq('id', id)
  const sw = await fetch(`${URL_}/functions/v1/mp-capture`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE}` }, body: JSON.stringify({ action: 'sweep' }) })
  const swj = await sw.json().catch(() => ({}))
  ok(sw.status === 200 && swj.data?.emergencias?.released >= 1, `el barrido libera la reserva de una cancelada sin cobro (${JSON.stringify(swj.data?.emergencias)})`)
  ok((await pago(id))?.status === 'cancelled', 'la reserva queda liberada')
}
// ═══ Permisos de la acción interna ══════════════════════════════════════════
console.log('\n▸ la acción interna es sólo del servidor')
{
  const id = await emergenciaPaga()
  const r = await fn('mp-capture', paciente.jwt, { action: 'cobrar-emergencia-terminada', emergencyId: id })
  ok(r.status === 401, `un usuario no puede llamarla (${r.status})`)
  await admin.from('emergencies').update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancellation_charged: false }).eq('id', id)
  await fn('mp-capture', paciente.jwt, { action: 'cancel-auth-emergency', emergencyId: id })
}

// ── Limpieza ───────────────────────────────────────────────────────────────
await admin.from('emergencies').update({ status: 'cancelled' }).eq('patient_id', paciente.uid).in('status', ['pending', 'awaiting_dispatch', 'dispatched', 'in_transit', 'arrived'])
await admin.from('ambulances').update({ status: 'disponible' }).eq('id', MOVIL)
console.log(fallas ? `\n❌ ${fallas} chequeo(s) en rojo` : '\n✅ todo en verde')
process.exit(fallas ? 1 : 0)
