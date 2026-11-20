#!/usr/bin/env node
/**
 * Control de los OPERADORES de emergencias y del COBRO AL PRESTADOR
 * (migración 241). SÓLO STAGING.
 *
 *   node scripts/verificar-operador-emergencias.mjs
 *
 * Qué falla si el problema vuelve:
 *   A. El operador cae en los flujos de profesional: la cuenta operadorN es
 *      `emergency_crew`, sin fila en professional_profiles (verificación),
 *      sin mp_accounts (conectar MP) ni comisión.
 *   B. Registro del día: sólo una cuenta operador lo carga; con la primera
 *      emergencia de su móvil el operador pasa a ser `professional_id`
 *      (y las siguientes del día se le asignan solas, aunque el despacho
 *      asigne con professional_id vacío); nadie registra con la selfie de otro.
 *   C. El operador hace lo mismo que el médico: iniciar la atención, "llegué",
 *      cierre con desenlace — por la misma RLS de siempre.
 *   D. El paciente ve nombre + foto de SU operador y NADA más (ni el DNI ni la
 *      tabla); un tercero no ve nada; el despacho ve todo.
 *   E. SISA corre en segundo plano (la fila sale de "pendiente") y la carga de
 *      medicación (`profesional_puede_recetar`) sólo se habilita con un médico
 *      habilitado confirmado.
 *   F. El cobro de la emergencia usa la cuenta del PRESTADOR: con una cuenta
 *      conectada la reserva queda con `emergency_provider_id` y se hace con su
 *      token; sin cuenta, con la plataforma (NULL). mp-capture mueve la reserva
 *      con el token con el que se creó, nunca con otro.
 *   G. emergency-mp-connect: sin sesión no hay OAuth; sólo el admin del
 *      despacho / super admin arrancan el OAuth (con el state de SU entidad).
 *
 * Mercado Pago NO deja completar el OAuth en el sandbox de staging (la app es
 * real; una cuenta de prueba no la puede autorizar): la cuenta del prestador se
 * siembra con un token falso y se verifica QUÉ token se elige, no que MP cobre.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const g = Object.fromEntries(readFileSync(`${process.env.HOME}/Local/.env`, 'utf8').split('\n')
  .filter(l => l.includes('=') && !l.startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim()] }))
const URL_ = g.HEALTHIER_STAGING_SUPABASE_URL
const REF = g.HEALTHIER_STAGING_SUPABASE_REF
const MOVIL = '40000000-0000-0000-0000-000000000001'
const ENTIDAD = '20000000-0000-0000-0000-000000000001'
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

let fallas = 0
const ok = (c, m) => { console.log(`${c ? '✅' : '❌'} ${m}`); if (!c) fallas++ }
const espera = ms => new Promise(r => setTimeout(r, ms))

const admin = createClient(URL_, g.HEALTHIER_STAGING_SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
async function como(email) {
  const { data: l, error: le } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (le) throw new Error(`${email}: ${le.message}`)
  const c = createClient(URL_, g.HEALTHIER_STAGING_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { data, error } = await c.auth.verifyOtp({ token_hash: l.properties.hashed_token, type: 'magiclink' })
  if (error) throw new Error(`${email}: ${error.message}`)
  c.uid = data.user.id
  c.jwt = data.session.access_token
  return c
}
async function fn(nombre, jwt, body, method = 'POST') {
  const r = await fetch(`${URL_}/functions/v1/${nombre}`, {
    method, headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) },
    ...(method === 'POST' ? { body: JSON.stringify(body ?? {}) } : {}), redirect: 'manual',
  })
  return { status: r.status, loc: r.headers.get('location'), body: await r.json().catch(() => ({})) }
}

// ── Cuentas ────────────────────────────────────────────────────────────────
async function asegurarPaciente(email) {
  const { data: l } = await admin.auth.admin.listUsers({ perPage: 200 })
  let u = l.users.find(x => x.email === email)
  if (!u) ({ data: { user: u } } = await admin.auth.admin.createUser({ email, password: 'staging', email_confirm: true }))
  await admin.from('profiles').upsert({ id: u.id, email, full_name: 'Paciente Control Operador', role: 'patient' })
  return u.id
}
await asegurarPaciente('op-test-paciente@staging.healthier.app')
const paciente = await como('op-test-paciente@staging.healthier.app')
const tercero = await como('paciente@healthier.app')
const despacho = await como('despacho@staging.healthier.app')
const superAdmin = await como('superadmin@healthier.app')
const chofer = await como('chofer@staging.healthier.app')
const op1 = await como('operador1@staging.healthier.app')
const op2 = await como('operador2@staging.healthier.app')

// El "tercero" no puede tener emergencias vivas ni atendidas por estas cuentas (si no, es paciente de ellas y ve la foto con razón).
await admin.from('emergencies').update({ status: 'cancelled' }).eq('patient_id', tercero.uid).in('status', ['pending', 'awaiting_dispatch', 'dispatched', 'in_transit', 'arrived'])
await admin.from('emergencies').update({ professional_id: null }).eq('patient_id', tercero.uid).in('professional_id', [op1.uid, op2.uid])
// Estado limpio: sin registro de hoy, sin cuenta de MP del prestador, sin emergencias de prueba vivas.
await admin.from('operadores_del_dia').delete().in('profile_id', [op1.uid, op2.uid])
await admin.from('emergency_provider_mp_accounts').delete().eq('provider_id', ENTIDAD)
await admin.from('emergencies').update({ status: 'cancelled' }).eq('patient_id', paciente.uid)
  .in('status', ['pending', 'awaiting_dispatch', 'dispatched', 'in_transit', 'arrived'])

// ═══ A · el operador NO es un profesional ═══════════════════════════════════
console.log('\n▸ A · el operador no cae en los flujos de profesional')
for (const o of [op1, op2]) {
  const { data: p } = await admin.from('profiles').select('role').eq('id', o.uid).single()
  const { data: pp } = await admin.from('professional_profiles').select('id').eq('user_id', o.uid)
  const { data: mp } = await admin.from('mp_accounts').select('professional_id').eq('professional_id', o.uid)
  const { data: crew } = await admin.from('ambulance_crew').select('crew_role,active').eq('profile_id', o.uid)
  ok(p.role === 'emergency_crew' && !pp?.length && !mp?.length && crew?.some(c => c.crew_role === 'operador' && c.active),
    `${o.uid.slice(0, 8)}: rol ${p.role}, sin professional_profiles (${pp?.length ?? 0}), sin mp_accounts (${mp?.length ?? 0}), crew_role operador activo`)
}
const { data: colaVerif } = await admin.from('professional_profiles').select('user_id').in('user_id', [op1.uid, op2.uid])
ok(!colaVerif?.length, 'ninguna cuenta operador figura en professional_profiles (cola de verificación / ganancias / comisiones)')
const { data: yoOp } = await op1.rpc('soy_operador_de_emergencias')
const { data: yoChofer } = await chofer.rpc('soy_operador_de_emergencias')
ok(yoOp === true && yoChofer === false, `soy_operador_de_emergencias: operador1=${yoOp}, chofer=${yoChofer}`)

// ═══ B · registro del día ═══════════════════════════════════════════════════
console.log('\n▸ B · registro del día')
async function emergenciaEsperando() {
  const { data: e, error } = await admin.from('emergencies').insert({
    patient_id: paciente.uid, triage_code: 'ROJO', status: 'pending', patient_latitude: -34.599, patient_longitude: -58.39, price_at_request: 50,
  }).select().single()
  if (error) throw error
  await admin.from('emergencies').update({ status: 'awaiting_dispatch', paid_at: new Date().toISOString(), notes: JSON.stringify(['Control operador']) }).eq('id', e.id)
  return e
}
async function asignarComoDespacho(id) {
  // Igual que el despacho web, pero SIN médico: professional_id vacío.
  const { data, error } = await despacho.from('emergencies').update({
    ambulance_id: MOVIL, provider_id: ENTIDAD, operator_id: despacho.uid, professional_id: null,
    status: 'in_transit', dispatched_at: new Date().toISOString(), dispatch_code: 'UTM-0001',
  }).eq('id', id).eq('status', 'awaiting_dispatch').select('professional_id,status').maybeSingle()
  if (error) throw error
  return data
}
await admin.from('ambulances').update({ status: 'disponible' }).eq('id', MOVIL)
// Ya en curso en el móvil y sin nadie a cargo (insert directo: el trigger de asignación
// sólo actúa al asignar, y otras cuentas pueden haber ingresado hoy en modo operador).
const { data: e1, error: e1err } = await admin.from('emergencies').insert({
  patient_id: paciente.uid, triage_code: 'ROJO', status: 'in_transit', patient_latitude: -34.599, patient_longitude: -58.39, price_at_request: 50,
  ambulance_id: MOVIL, provider_id: ENTIDAD, paid_at: new Date().toISOString(), dispatched_at: new Date().toISOString(), dispatch_code: 'UTM-0001',
}).select('id,professional_id,status').single()
if (e1err) throw e1err
const e1id = e1.id
ok(e1?.status === 'in_transit' && e1.professional_id === null, '1ª emergencia en curso sin registro del día: nadie la atiende todavía (professional_id vacío)')

const ruta1 = `${op1.uid}/hoy.png`
const subida = await op1.storage.from('operadores-dia').upload(ruta1, PNG, { contentType: 'image/png', upsert: true })
ok(!subida.error, `operador1 sube su selfie a su carpeta (${subida.error?.message ?? 'ok'})`)
const ajena = await op2.storage.from('operadores-dia').upload(`${op1.uid}/robada.png`, PNG, { contentType: 'image/png' })
ok(!!ajena.error, 'operador2 NO puede subir a la carpeta de operador1')
const choferSube = await chofer.storage.from('operadores-dia').upload(`${chofer.uid}/x.png`, PNG, { contentType: 'image/png' })
ok(!!choferSube.error, 'un chofer (no operador) NO puede subir selfies')

const regChofer = await chofer.rpc('registrar_operador_del_dia', { p_nombre: 'Chofer Pérez', p_dni: '30111222', p_foto_path: `${chofer.uid}/x.png` })
ok(!!regChofer.error, `un chofer NO registra operador del día (${regChofer.error?.message ?? ''})`)
const regFoto = await op2.rpc('registrar_operador_del_dia', { p_nombre: 'Ana Gómez', p_dni: '30111222', p_foto_path: ruta1 })
ok(!!regFoto.error, `operador2 NO registra con la selfie de operador1 (${regFoto.error?.message ?? ''})`)
const regMal = await op1.rpc('registrar_operador_del_dia', { p_nombre: 'Lu', p_dni: '12', p_foto_path: ruta1 })
ok(!!regMal.error, `nombre/DNI inválidos se rechazan (${regMal.error?.message ?? ''})`)

const DNI = '12345678'
const reg = await op1.rpc('registrar_operador_del_dia', { p_nombre: 'María Operadora Prueba', p_dni: DNI, p_foto_path: ruta1 })
ok(!reg.error && reg.data?.emergencias_tomadas >= 1, `operador1 se registra y toma la emergencia en curso (${reg.error?.message ?? JSON.stringify(reg.data)})`)
const { data: e1b } = await admin.from('emergencies').select('professional_id').eq('id', e1id).single()
ok(e1b.professional_id === op1.uid, 'la emergencia en curso quedó con professional_id = operador1')

const e2 = await emergenciaEsperando()
await admin.from('emergencies').update({ status: 'cancelled' }).eq('id', e1id) // libera el móvil para la 2ª
await admin.from('ambulances').update({ status: 'disponible' }).eq('id', MOVIL)
const a2 = await asignarComoDespacho(e2.id)
ok(a2?.professional_id === op1.uid, '2ª emergencia del día: el despacho asigna sin médico y queda a cargo del operador registrado')

// ═══ C · el operador hace lo mismo que el médico ════════════════════════════
console.log('\n▸ C · el operador atiende y cierra como el médico')
const { data: cid, error: cerr } = await op1.rpc('iniciar_atencion_emergencia', { p_emergency_id: e2.id })
ok(!cerr && !!cid, `iniciar_atencion_emergencia como operador (${cerr?.message ?? 'consulta ' + String(cid).slice(0, 8)})`)
const { data: llego, error: llegoErr } = await op1.from('emergencies').update({ status: 'arrived' }).eq('id', e2.id).select('status').maybeSingle()
ok(!llegoErr && llego?.status === 'arrived', `"Llegué" (${llegoErr?.message ?? llego?.status})`)
const { data: cons } = await op1.from('consultations').select('id,status,professional_id').eq('emergency_id', e2.id).maybeSingle()
ok(cons?.professional_id === op1.uid, 'la consulta de la atención es del operador y la ve')
const { error: obsErr } = await op1.from('clinical_encounters').select('id').limit(1)
ok(!obsErr, `lee la HC que le corresponde sin error de permisos (${obsErr?.message ?? ''})`)

// ═══ D · qué ve el paciente, el tercero y el despacho ═══════════════════════
console.log('\n▸ D · visibilidad')
const { data: vp } = await paciente.rpc('operador_de_mi_emergencia', { p_emergency_id: e2.id })
ok(vp?.nombre === 'María Operadora Prueba' && vp?.foto_path === ruta1 && Object.keys(vp).sort().join() === 'foto_path,nombre',
  `el paciente ve sólo nombre + foto (${JSON.stringify(vp)})`)
ok(!JSON.stringify(vp).includes(DNI), 'el DNI no viaja al paciente')
const { data: tabla } = await paciente.from('operadores_del_dia').select('*')
ok(!tabla?.length, 'el paciente NO puede leer la tabla del registro (0 filas)')
const { data: vt } = await tercero.rpc('operador_de_mi_emergencia', { p_emergency_id: e2.id })
ok(vt == null, 'un tercero (otro paciente) no ve nada')
const dlP = await paciente.storage.from('operadores-dia').download(ruta1)
ok(!dlP.error, `el paciente descarga la foto de SU operador (${dlP.error?.message ?? 'ok'})`)
const dlT = await tercero.storage.from('operadores-dia').download(ruta1)
ok(!!dlT.error, 'un tercero NO descarga la foto')
const { data: vd } = await despacho.from('operadores_del_dia').select('nombre,dni,sisa_estado,foto_path').eq('profile_id', op1.uid)
ok(vd?.length === 1 && vd[0].dni === DNI, 'el despacho ve el registro completo (con DNI)')
const dlD = await despacho.storage.from('operadores-dia').download(ruta1)
ok(!dlD.error, 'el despacho ve la foto')
const { data: vo2 } = await op2.from('operadores_del_dia').select('id')
ok(!vo2?.length, 'otro operador NO ve el registro de operador1')
const { data: vs } = await superAdmin.from('operadores_del_dia').select('id').eq('profile_id', op1.uid)
ok(vs?.length === 1, 'el super admin lo ve')

// ═══ E · SISA y recetar ═════════════════════════════════════════════════════
console.log('\n▸ E · SISA en segundo plano y la receta')
let fila
for (let i = 0; i < 25; i++) {
  ;({ data: fila } = await admin.from('operadores_del_dia').select('sisa_estado,sisa_detalle').eq('profile_id', op1.uid).single())
  if (fila.sisa_estado !== 'pendiente') break
  await espera(2000)
}
ok(fila.sisa_estado !== 'pendiente', `SISA corrió sola y dejó el resultado: "${fila.sisa_estado}"`)
const puede = async () => (await admin.rpc('profesional_puede_recetar', { p_professional_id: op1.uid })).data
const resolver = (estado, medico) => admin.rpc('resolver_sisa_operador', {
  p_id: undefined, p_estado: estado, p_es_medico: medico, p_profesion: medico ? 'Médico/a' : 'Enfermero/a', p_matricula: '1', p_nombre: 'X', p_detalle: {},
})
const { data: filaId } = await admin.from('operadores_del_dia').select('id').eq('profile_id', op1.uid).single()
const set = (estado, medico) => admin.rpc('resolver_sisa_operador', { p_id: filaId.id, p_estado: estado, p_es_medico: medico, p_profesion: medico ? 'Médico/a' : 'Enfermero/a', p_matricula: '1', p_nombre: 'X', p_detalle: {} })
await set('no_encontrado', false); ok((await puede()) === false, 'SISA "no encontrado" → no se ofrece la receta')
await set('sin_respuesta', false); ok((await puede()) === false, 'SISA sin respuesta → no se ofrece la receta')
await set('habilitado', false); ok((await puede()) === false, 'SISA habilitado pero no médico → no se ofrece la receta')
await set('habilitado', true); ok((await puede()) === true, 'SISA confirma médico habilitado → se habilita')
const noEjec = await op1.rpc('resolver_sisa_operador', { p_id: filaId.id, p_estado: 'habilitado', p_es_medico: true, p_profesion: 'x', p_matricula: '1', p_nombre: 'x', p_detalle: {} })
ok(!!noEjec.error, 'el operador NO puede escribirse su propio resultado de SISA')
await set('no_encontrado', false)

// ═══ F · el cobro de la emergencia ══════════════════════════════════════════
console.log('\n▸ F · cobro: token del prestador')
const e3 = await emergenciaEsperando()
await admin.from('emergencies').update({ paid_at: null, status: 'pending' }).eq('id', e3.id)
const pagar = () => fn('mp-payment', paciente.jwt, { emergencyId: e3.id, cardToken: 'token-falso-control', paymentMethodId: 'visa', payerEmail: 'op-test-paciente@staging.healthier.app' })
const MP_USER = '999000111'
// F1 · sin cuenta del prestador → plataforma (NULL)
await pagar()
let { data: pay } = await admin.from('payments').select('emergency_provider_id,collector_id,status').eq('emergency_id', e3.id).order('created_at', { ascending: false }).limit(1).maybeSingle()
ok(pay && pay.emergency_provider_id === null, `sin cuenta conectada la reserva sale con la plataforma (emergency_provider_id=${pay?.emergency_provider_id})`)
// F2 · con cuenta del prestador → su token
await admin.from('emergency_provider_mp_accounts').upsert({ provider_id: ENTIDAD, mp_user_id: MP_USER, access_token: 'TEST-token-del-prestador-falso', refresh_token: null, active: true, expires_at: new Date(Date.now() + 90 * 864e5).toISOString() }, { onConflict: 'provider_id' })
await pagar()
;({ data: pay } = await admin.from('payments').select('emergency_provider_id,collector_id,status').eq('emergency_id', e3.id).order('created_at', { ascending: false }).limit(1).maybeSingle())
ok(pay?.emergency_provider_id === ENTIDAD && pay?.collector_id === MP_USER, `con cuenta conectada el cobro va a la cuenta del prestador (emergency_provider_id=${pay?.emergency_provider_id}, collector=${pay?.collector_id})`)
// F3 · capture / cancel usan el token de la reserva
const { data: pr } = await admin.from('payments').insert({
  emergency_id: e3.id, patient_id: paciente.uid, method: 'card', gross_amount: 50, charged_amount: 50, credits_used: 0, platform_fee: 0, mp_fee_estimated: 0,
  net_to_professional: 0, manual_settlement_amount: 0, currency: 'ARS', status: 'authorized', mp_payment_id: '1', emergency_provider_id: ENTIDAD,
}).select('id').single()
await admin.from('emergency_provider_mp_accounts').delete().eq('provider_id', ENTIDAD)
const capSin = await fn('mp-capture', despacho.jwt, { action: 'capture-emergency', emergencyId: e3.id })
ok(capSin.status === 422 && /prestador/i.test(capSin.body?.error ?? ''), `capturar una reserva del prestador SIN su cuenta no cae a la plataforma: ${capSin.status} "${capSin.body?.error}"`)
await admin.from('emergency_provider_mp_accounts').upsert({ provider_id: ENTIDAD, mp_user_id: MP_USER, access_token: 'TEST-token-del-prestador-falso', refresh_token: null, active: true, expires_at: new Date(Date.now() + 90 * 864e5).toISOString() }, { onConflict: 'provider_id' })
const capCon = await fn('mp-capture', despacho.jwt, { action: 'capture-emergency', emergencyId: e3.id })
ok(capCon.status === 502, `con la cuenta del prestador la captura llega a Mercado Pago con SU token (MP rechaza el token falso: ${capCon.status})`)
await admin.from('payments').update({ emergency_provider_id: null }).eq('id', pr.id)
const capPlat = await fn('mp-capture', despacho.jwt, { action: 'capture-emergency', emergencyId: e3.id })
ok(capPlat.status === 502 && !/prestador/i.test(capPlat.body?.error ?? ''), `una reserva anterior (plataforma, NULL) sigue usando el token de la plataforma (${capPlat.status})`)
await admin.from('payments').delete().eq('emergency_id', e3.id)

// ═══ G · emergency-mp-connect ═══════════════════════════════════════════════
console.log('\n▸ G · conectar Mercado Pago del prestador')
const sinSesion = await fn('emergency-mp-connect', null, { action: 'authorize' })
ok(sinSesion.status === 401, `sin sesión: ${sinSesion.status}`)
const nav = await fetch(`${URL_}/functions/v1/emergency-mp-connect?action=authorize&providerId=${ENTIDAD}`, { redirect: 'manual', headers: { Accept: 'text/html', 'Sec-Fetch-Mode': 'navigate' } })
ok(nav.status === 302 && !(nav.headers.get('location') ?? '').includes('mercadopago.com'), 'link sin sesión (navegación): vuelve a la app, nunca a Mercado Pago')
for (const [quien, c] of [['paciente', paciente], ['operador', op1], ['chofer', chofer]]) {
  const r = await fn('emergency-mp-connect', c.jwt, { action: 'authorize' })
  ok(r.status === 403, `${quien} no puede conectar el MP del prestador (${r.status})`)
}
for (const [quien, c] of [['despacho (emergency_admin)', despacho], ['super admin', superAdmin]]) {
  const r = await fn('emergency-mp-connect', c.jwt, { action: 'authorize', providerId: '00000000-0000-0000-0000-000000000001' })
  const u = r.body?.data?.url ?? ''
  const state = new URL(u || 'http://x').searchParams.get('state') ?? ''
  ok(r.status === 200 && u.includes('auth.mercadopago.com') && state.split('.')[1] === ENTIDAD, `${quien}: arranca el OAuth con el state de SU entidad, ignorando el providerId del pedido (${r.status})`)
}
const cb = await fetch(`${URL_}/functions/v1/emergency-mp-connect?code=x&state=v2.${ENTIDAD}.9999999999.deadbeef`, { redirect: 'manual' })
ok(cb.status === 302 && (cb.headers.get('location') ?? '').includes('mp_error=invalid_state'), 'callback con state falso → mp_error=invalid_state, no guarda nada')
const { data: est } = await despacho.rpc('estado_mp_de_entidad')
ok(est && 'conectado' in est && !JSON.stringify(est).includes('TEST-token'), `estado_mp_de_entidad no devuelve tokens (${JSON.stringify(est)})`)
const { data: tokens } = await despacho.from('emergency_provider_mp_accounts').select('*')
ok(!tokens?.length, 'ninguna sesión puede leer la tabla de tokens del prestador')
const estPac = await paciente.rpc('estado_mp_de_entidad')
ok(!!estPac.error, 'el paciente no puede pedir el estado de MP de la entidad')

// ── Limpieza ───────────────────────────────────────────────────────────────
await admin.from('emergency_provider_mp_accounts').delete().eq('provider_id', ENTIDAD)
await admin.from('emergencies').update({ status: 'cancelled' }).eq('patient_id', paciente.uid).in('status', ['pending', 'awaiting_dispatch', 'dispatched', 'in_transit', 'arrived'])
await admin.from('ambulances').update({ status: 'disponible' }).eq('id', MOVIL)
await admin.from('operadores_del_dia').delete().in('profile_id', [op1.uid, op2.uid])
await admin.storage.from('operadores-dia').remove([ruta1])

console.log(fallas ? `\n❌ ${fallas} chequeo(s) en rojo` : '\n✅ todo en verde')
process.exit(fallas ? 1 : 0)
