#!/usr/bin/env node
/**
 * Control del MODO OPERADOR (migración 242). SÓLO STAGING.
 *
 *   node scripts/verificar-modo-operador.mjs
 *
 * La cuenta operadorN, con el DNI de un profesional de la lista de la entidad,
 * abre una sesión real de ESE profesional. Qué falla si el problema vuelve:
 *   A. La lista de profesionales de la entidad: sólo la cargan el admin del
 *      despacho y el super admin, y sólo con profesionales reales.
 *   B. `operador-modo`: sólo cuentas operador; DNI fuera de la lista (o profesional
 *      no verificado) cae al registro del día de la 241 ("registro"), sin sesión.
 *   C. DNI de la lista → sesión del profesional; las emergencias en curso del
 *      móvil pasan a su nombre y las que se asignen después también.
 *   D. La sesión se reconoce como "modo operador" (`estoy_en_modo_operador`) y
 *      una sesión común del mismo profesional NO.
 *   E. Con esa sesión atiende como el profesional: inicia la atención (la
 *      consulta es SUYA), "llegué", publica la ubicación del móvil (algo que una
 *      sesión común del profesional no puede), puede recetar, cierra.
 *   F. Auditoría: el ingreso queda en operador_sesiones_log (cuenta, profesional,
 *      DNI, session_id) y la emergencia lleva `cuenta_operador_id`; el log no se
 *      puede tocar ni leer por el paciente ni por el propio profesional.
 *   G. El cierre vencido de sesiones de modo operador no mata las de hoy.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const g = Object.fromEntries(readFileSync(`${process.env.HOME}/Local/.env`, 'utf8').split('\n')
  .filter(l => l.includes('=') && !l.startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim()] }))
const URL_ = g.HEALTHIER_STAGING_SUPABASE_URL
const MOVIL = '40000000-0000-0000-0000-000000000001'
const ENTIDAD = '20000000-0000-0000-0000-000000000001'
const PRO_EMAIL = 'profesional@healthier.app'
let fallas = 0
const ok = (c, m) => { console.log(`${c ? '✅' : '❌'} ${m}`); if (!c) fallas++ }

const sqlq = async (query) => (await fetch(`https://api.supabase.com/v1/projects/${g.HEALTHIER_STAGING_SUPABASE_REF}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${g.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': 'curl/8' }, body: JSON.stringify({ query }) })).json()
const admin = createClient(URL_, g.HEALTHIER_STAGING_SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
async function como(email) {
  const { data: l, error: le } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (le) throw new Error(`${email}: ${le.message}`)
  const c = createClient(URL_, g.HEALTHIER_STAGING_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { data, error } = await c.auth.verifyOtp({ token_hash: l.properties.hashed_token, type: 'magiclink' })
  if (error) throw new Error(`${email}: ${error.message}`)
  c.uid = data.user.id; c.jwt = data.session.access_token
  return c
}
async function fn(nombre, jwt, body) {
  const r = await fetch(`${URL_}/functions/v1/${nombre}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` }, body: JSON.stringify(body ?? {}) })
  return { status: r.status, body: await r.json().catch(() => ({})) }
}
async function asegurarPaciente(email) {
  const { data: l } = await admin.auth.admin.listUsers({ perPage: 200 })
  let u = l.users.find(x => x.email === email)
  if (!u) ({ data: { user: u } } = await admin.auth.admin.createUser({ email, password: 'staging', email_confirm: true }))
  await admin.from('profiles').upsert({ id: u.id, email, full_name: 'Paciente Control Operador', role: 'patient' })
}

await asegurarPaciente('op-test-paciente@staging.healthier.app')
const paciente = await como('op-test-paciente@staging.healthier.app')
const despacho = await como('despacho@staging.healthier.app')           // emergency_admin
const despachoOp = await como('operador@staging.healthier.app')         // emergency_operator (no admin)
const superAdmin = await como('superadmin@healthier.app')
const chofer = await como('chofer@staging.healthier.app')
const op = await como('operador4@staging.healthier.app')
const proComun = await como(PRO_EMAIL)
const PRO = proComun.uid
const { data: proPerfil } = await admin.from('profiles').select('dni').eq('id', PRO).single()
const DNI = String(proPerfil.dni)

await admin.from('emergency_provider_profesionales').delete().eq('provider_id', ENTIDAD).eq('professional_id', PRO)
await admin.from('emergencies').update({ status: 'cancelled' }).eq('patient_id', paciente.uid).in('status', ['pending', 'awaiting_dispatch', 'dispatched', 'in_transit', 'arrived'])
await admin.from('ambulances').update({ status: 'disponible' }).eq('id', MOVIL)

// ═══ A · la lista ══════════════════════════════════════════════════════════
console.log('\n▸ A · la lista de profesionales de la entidad')
const sinPerm = await despachoOp.from('emergency_provider_profesionales').insert({ provider_id: ENTIDAD, professional_id: PRO })
ok(!!sinPerm.error, 'el operador del despacho (no admin) NO carga la lista')
const pacIns = await paciente.from('emergency_provider_profesionales').insert({ provider_id: ENTIDAD, professional_id: PRO })
ok(!!pacIns.error, 'un paciente NO carga la lista')
const noPro = await despacho.from('emergency_provider_profesionales').insert({ provider_id: ENTIDAD, professional_id: paciente.uid })
ok(!!noPro.error && /profesional/i.test(noPro.error.message), `no se puede cargar a quien no es profesional (${noPro.error?.message})`)

// ═══ B · antes de estar en la lista ═════════════════════════════════════════
console.log('\n▸ B · operador-modo')
const antes = await fn('operador-modo', op.jwt, { dni: DNI })
ok(antes.status === 200 && antes.body.modo === 'registro' && !antes.body.session, 'DNI de un profesional que NO está en la lista → registro (sin pedido ni sesión)')
const alta = await despacho.from('emergency_provider_profesionales').insert({ provider_id: ENTIDAD, professional_id: PRO })
ok(!alta.error, `el admin del despacho carga al profesional (${alta.error?.message ?? 'ok'})`)
const { data: lst } = await despachoOp.from('emergency_provider_profesionales').select('id')
ok(lst?.length >= 1, 'el operador del despacho sí ve la lista')
const { data: lstPac } = await paciente.from('emergency_provider_profesionales').select('id')
ok(!lstPac?.length, 'el paciente no ve la lista')
const malDni = await fn('operador-modo', op.jwt, { dni: '10000001' })
ok(malDni.body.modo === 'registro' && !malDni.body.session, 'DNI que no es de la lista → registro')
const formato = await fn('operador-modo', op.jwt, { dni: '12' })
ok(formato.status === 422, `DNI mal formado → 422 (${formato.status})`)
const choferR = await fn('operador-modo', chofer.jwt, { dni: DNI })
ok(choferR.status === 403, `un chofer no entra en modo operador (${choferR.status})`)
const proR = await fn('operador-modo', proComun.jwt, { dni: DNI })
ok(proR.status === 403, `el propio profesional no usa el modo operador (${proR.status})`)
const sinSesion = await fetch(`${URL_}/functions/v1/operador-modo`, { method: 'POST', body: '{}' })
ok(sinSesion.status === 401, `sin sesión: ${sinSesion.status}`)

// ═══ C · emergencia en curso antes del ingreso, y otra después ═════════════
console.log('\n▸ C · la emergencia queda a nombre del profesional')
async function emergenciaEsperando() {
  const { data: e, error } = await admin.from('emergencies').insert({ patient_id: paciente.uid, triage_code: 'ROJO', status: 'pending', patient_latitude: -34.599, patient_longitude: -58.39, price_at_request: 50 }).select().single()
  if (error) throw error
  await admin.from('emergencies').update({ status: 'awaiting_dispatch', paid_at: new Date().toISOString(), notes: JSON.stringify(['Control modo operador']) }).eq('id', e.id)
  return e
}
async function asignarSinMedico(id) {
  const { error } = await despacho.from('emergencies').update({ ambulance_id: MOVIL, provider_id: ENTIDAD, operator_id: despacho.uid, professional_id: null, status: 'in_transit', dispatched_at: new Date().toISOString(), dispatch_code: 'UTM-0002' }).eq('id', id).eq('status', 'awaiting_dispatch')
  if (error) throw error
}
// Emergencia ya en curso en el móvil y sin nadie a cargo (insert directo: el trigger
// de asignación sólo actúa al ASIGNAR, así que el control no depende de si hoy ya
// hubo otros ingresos de esta cuenta).
const { data: e1, error: e1err } = await admin.from('emergencies').insert({
  patient_id: paciente.uid, triage_code: 'ROJO', status: 'in_transit', patient_latitude: -34.599, patient_longitude: -58.39, price_at_request: 50,
  ambulance_id: MOVIL, provider_id: ENTIDAD, paid_at: new Date().toISOString(), dispatched_at: new Date().toISOString(), dispatch_code: 'UTM-0003',
}).select().single()
if (e1err) throw e1err
const { data: e1a } = await admin.from('emergencies').select('professional_id,cuenta_operador_id').eq('id', e1.id).single()
ok(e1a.professional_id !== PRO, 'antes de ingresar, la emergencia no está a nombre del profesional')

// ═══ C0 · el ingreso lo aprueba el despacho (migración 243) ═════════════════
console.log('\n▸ C0 · aprobación del despacho')
const pushes0 = (await sqlq(`select count(*)::int n from net._http_response`))[0]?.n ?? 0
const ped = await fn('operador-modo', op.jwt, { dni: DNI })
ok(ped.status === 200 && ped.body.modo === 'pendiente' && !!ped.body.ingreso_id && !ped.body.session, `el DNI de la lista deja el ingreso PENDIENTE, sin sesión (${ped.status} ${ped.body.modo ?? ped.body.error})`)
const ped2 = await fn('operador-modo', op.jwt, { dni: DNI })
ok(ped2.body.ingreso_id === ped.body.ingreso_id, 'pedirlo de nuevo reutiliza el mismo pedido vigente')
const retiroPend = await fn('operador-modo', op.jwt, { ingresoId: ped.body.ingreso_id })
ok(retiroPend.body.modo === 'pendiente' && !retiroPend.body.session, 'mientras está pendiente no hay sesión')
const { data: e1p } = await admin.from('emergencies').select('professional_id').eq('id', e1.id).single()
ok(e1p.professional_id !== PRO, 'mientras está pendiente, las emergencias del móvil no se mueven')
await new Promise(r => setTimeout(r, 2500))
const pushes1 = (await sqlq(`select count(*)::int n from net._http_response`))[0]?.n ?? 0
ok(pushes1 > pushes0, `el pedido manda push al despacho (pedidos de net: +${pushes1 - pushes0})`)
const { data: vistoDesp } = await despacho.from('operador_ingresos').select('estado').eq('id', ped.body.ingreso_id)
const { data: vistoOp } = await op.from('operador_ingresos').select('estado').eq('id', ped.body.ingreso_id)
const { data: vistoPac } = await paciente.from('operador_ingresos').select('id')
ok(vistoDesp?.length === 1 && vistoOp?.length === 1 && !vistoPac?.length, 'el pedido lo ven el despacho y la cuenta; el paciente no')
const aprobaOp = await op.rpc('resolver_ingreso_operador', { p_id: ped.body.ingreso_id, p_aprobar: true })
const aprobaPac = await paciente.rpc('resolver_ingreso_operador', { p_id: ped.body.ingreso_id, p_aprobar: true })
const aprobaPro = await proComun.rpc('resolver_ingreso_operador', { p_id: ped.body.ingreso_id, p_aprobar: true })
ok(!!aprobaOp.error && !!aprobaPac.error && !!aprobaPro.error, 'ni la propia cuenta, ni un paciente, ni el profesional pueden aprobar')
const rech = await despacho.rpc('resolver_ingreso_operador', { p_id: ped.body.ingreso_id, p_aprobar: false, p_motivo: 'No es quien dice' })
ok(!rech.error, `el despacho rechaza (${rech.error?.message ?? 'ok'})`)
const retRech = await fn('operador-modo', op.jwt, { ingresoId: ped.body.ingreso_id })
ok(retRech.body.modo === 'rechazado' && retRech.body.motivo === 'No es quien dice' && !retRech.body.session, 'rechazado: la cuenta ve el motivo y no recibe sesión')
const reRes = await despacho.rpc('resolver_ingreso_operador', { p_id: ped.body.ingreso_id, p_aprobar: true })
ok(!!reRes.error, 'un pedido ya resuelto no se vuelve a resolver')
const pedV = await fn('operador-modo', op.jwt, { dni: DNI })
await admin.from('operador_ingresos').update({ created_at: new Date(Date.now() - 11 * 60_000).toISOString() }).eq('id', pedV.body.ingreso_id)
const retV = await fn('operador-modo', op.jwt, { ingresoId: pedV.body.ingreso_id })
const apV = await despacho.rpc('resolver_ingreso_operador', { p_id: pedV.body.ingreso_id, p_aprobar: true })
ok(retV.body.modo === 'vencido' && !!apV.error, 'un pedido de más de 10 minutos vence (ni se retira ni se aprueba)')
async function ingresar() {
  const p = await fn('operador-modo', op.jwt, { dni: DNI })
  const ap = await despachoOp.rpc('resolver_ingreso_operador', { p_id: p.body.ingreso_id, p_aprobar: true })
  if (ap.error) throw new Error(ap.error.message)
  const r = await fn('operador-modo', op.jwt, { ingresoId: p.body.ingreso_id })
  return { ingresoId: p.body.ingreso_id, ...r }
}
const entrada = await ingresar()
ok(entrada.status === 200 && entrada.body.modo === 'profesional' && entrada.body.profesional?.id === PRO && !!entrada.body.session?.access_token,
  `aprobado por el despacho → sesión del profesional (${entrada.status} ${entrada.body.modo ?? entrada.body.error})`)
const { data: ingE } = await admin.from('operador_ingresos').select('estado,decidido_por').eq('id', entrada.ingresoId).single()
ok(ingE.estado === 'entregado' && ingE.decidido_por === despachoOp.uid, 'el pedido queda "entregado" con quién lo aprobó')
const otraVez = await fn('operador-modo', op.jwt, { ingresoId: entrada.ingresoId })
ok(otraVez.status === 409 && !otraVez.body.session, 'una aprobación se retira una sola vez')
const { data: logAp } = await admin.from('operador_sesiones_log').select('aprobado_por,ingreso_id').eq('ingreso_id', entrada.ingresoId).single()
ok(logAp?.aprobado_por === despachoOp.uid, 'el log de ingresos guarda quién aprobó')
ok(entrada.body.emergencias_tomadas >= 1, `las emergencias en curso del móvil pasan al profesional recién al entregar la sesión (${entrada.body.emergencias_tomadas})`)
const { data: e1b } = await admin.from('emergencies').select('professional_id,cuenta_operador_id').eq('id', e1.id).single()
ok(e1b.professional_id === PRO && e1b.cuenta_operador_id === op.uid, 'emergencia en curso: professional_id = el profesional, cuenta_operador_id = operador4')
await admin.from('emergencies').update({ status: 'cancelled' }).eq('id', e1.id)
await admin.from('ambulances').update({ status: 'disponible' }).eq('id', MOVIL)

const pro = createClient(URL_, g.HEALTHIER_STAGING_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
await pro.auth.setSession({ access_token: entrada.body.session.access_token, refresh_token: entrada.body.session.refresh_token })
const e2 = await emergenciaEsperando()
await asignarSinMedico(e2.id)
const { data: e2a } = await admin.from('emergencies').select('professional_id,cuenta_operador_id').eq('id', e2.id).single()
ok(e2a.professional_id === PRO && e2a.cuenta_operador_id === op.uid, 'una emergencia asignada DESPUÉS del ingreso queda a nombre del profesional (despacho asigna sin médico)')

// ═══ D · la sesión se reconoce ═════════════════════════════════════════════
console.log('\n▸ D · modo operador reconocible')
const { data: m1 } = await pro.rpc('estoy_en_modo_operador')
ok(m1?.activo === true && m1.cuenta_operador_id === op.uid, `la sesión de modo operador lo dice (${JSON.stringify(m1)})`)
const { data: m2 } = await proComun.rpc('estoy_en_modo_operador')
ok(m2?.activo === false, 'una sesión común del mismo profesional NO está en modo operador')

// ═══ E · atiende como el profesional ═══════════════════════════════════════
console.log('\n▸ E · todas las funcionalidades del profesional')
const { data: cid, error: cerr } = await pro.rpc('iniciar_atencion_emergencia', { p_emergency_id: e2.id })
ok(!cerr && !!cid, `iniciar la atención (${cerr?.message ?? 'ok'})`)
const { data: cons } = await pro.from('consultations').select('professional_id').eq('emergency_id', e2.id).maybeSingle()
ok(cons?.professional_id === PRO, 'la consulta de la atención es del PROFESIONAL (no de la cuenta operador)')
const { error: llegoErr } = await pro.from('emergencies').update({ status: 'arrived' }).eq('id', e2.id)
ok(!llegoErr, `"llegué" (${llegoErr?.message ?? 'ok'})`)
const pos = { ambulance_id: MOVIL, latitude: -34.6, longitude: -58.4, updated_at: new Date().toISOString() }
const posPro = await pro.from('ambulance_locations').upsert({ ...pos, profile_id: PRO }, { onConflict: 'ambulance_id' })
ok(!posPro.error, `publica la ubicación del móvil (${posPro.error?.message ?? 'ok'})`)
const posComun = await proComun.from('ambulance_locations').upsert({ ...pos, profile_id: PRO }, { onConflict: 'ambulance_id' })
ok(!!posComun.error, 'una sesión común del profesional NO publica la ubicación de ese móvil')
const { data: puede } = await pro.rpc('profesional_puede_recetar', { p_professional_id: PRO })
ok(puede === true, 'puede cargar medicación (es un profesional verificado, con su legajo)')
const mpModo = await fn('mp-connect', entrada.body.session.access_token, { action: 'authorize' })
const mpComun = await fn('mp-connect', proComun.jwt, { action: 'authorize' })
ok(mpModo.status === 403 && mpComun.status === 200, `en modo operador NO se conecta el Mercado Pago del profesional (${mpModo.status}); la sesión común sí (${mpComun.status})`)
const mpDesc = await fn('mp-connect', entrada.body.session.access_token, { action: 'disconnect' })
ok(mpDesc.status === 403, `ni se desconecta (${mpDesc.status})`)
const { data: hc, error: hcErr } = await pro.from('clinical_encounters').select('id').limit(1)
ok(!hcErr, `accede a la HC como profesional (${hcErr?.message ?? 'ok'})`)
const { error: cierreErr } = await pro.from('emergencies').update({ desenlace: 'en_el_lugar', cierre_sin_atencion: 'Control modo operador', status: 'completed' }).eq('id', e2.id)
ok(!cierreErr, `cierra la emergencia con desenlace (${cierreErr?.message ?? 'ok'})`)
const { data: ve } = await paciente.from('emergencies').select('professional_id,status').eq('id', e2.id).single()
ok(ve?.professional_id === PRO && ve?.status === 'completed', 'el paciente ve la emergencia a nombre del profesional')

// ═══ F · auditoría ═════════════════════════════════════════════════════════
console.log('\n▸ F · auditoría')
const { data: log } = await admin.from('operador_sesiones_log').select('operator_id,professional_id,dni_ingresado,session_id').eq('professional_id', PRO).order('created_at', { ascending: false }).limit(1)
ok(log?.[0]?.operator_id === op.uid && log[0].dni_ingresado === DNI && !!log[0].session_id, 'el ingreso quedó en operador_sesiones_log (cuenta, profesional, DNI, session_id)')
const { data: lg1 } = await despacho.from('operador_sesiones_log').select('id').eq('professional_id', PRO)
const { data: lg2 } = await superAdmin.from('operador_sesiones_log').select('id').eq('professional_id', PRO)
ok(lg1?.length >= 1 && lg2?.length >= 1, 'el despacho y el super admin ven el log')
const { data: lg3 } = await paciente.from('operador_sesiones_log').select('id')
const { data: lg4 } = await pro.from('operador_sesiones_log').select('id')
ok(!lg3?.length && !lg4?.length, 'ni el paciente ni el propio profesional ven el log')
const upd = await admin.from('operador_sesiones_log').update({ dni_ingresado: '1' }).eq('id', (await admin.from('operador_sesiones_log').select('id').limit(1)).data[0].id)
ok(!!upd.error, 'el log es inmutable (ni la service key lo modifica)')
const { data: ec } = await admin.from('emergencies').select('cuenta_operador_id').eq('id', e2.id).single()
ok(ec.cuenta_operador_id === op.uid, 'la emergencia dice por qué cuenta se atendió')

// ═══ G · cierre de sesiones vencidas ═══════════════════════════════════════
console.log('\n▸ G · las sesiones no sobreviven al día')
await admin.rpc('cerrar_sesiones_modo_operador_vencidas')
const { data: viva } = await pro.rpc('estoy_en_modo_operador')
ok(viva?.activo === true, 'el cierre de vencidas no toca las sesiones de hoy')

// ═══ H · terminar turno (migración 243) ════════════════════════════════════
console.log('\n▸ H · terminar turno')
const sinModo = await proComun.rpc('terminar_turno_operador')
ok(!!sinModo.error, 'una sesión común del profesional no puede "terminar turno"')
const fin = await pro.rpc('terminar_turno_operador')
ok(!fin.error && fin.data?.terminada === true, `el profesional en modo operador termina su turno (${fin.error?.message ?? 'ok'})`)
const { data: m3 } = await admin.from('operador_sesiones_fin').select('session_id').eq('session_id', fin.data?.session_id ?? '00000000-0000-0000-0000-000000000000')
ok(m3?.length === 1, 'queda marcada como terminada')
const refr = await pro.auth.refreshSession()
ok(!!refr.error || !refr.data.session, `la sesión ya no se puede renovar (${refr.error?.message ?? 'sin sesión'})`)
const ua = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: g.HEALTHIER_STAGING_SUPABASE_ANON_KEY, Authorization: `Bearer ${entrada.body.session.access_token}` } })
ok(ua.status >= 400, `Auth rechaza el access token de la sesión terminada (${ua.status}) — es lo que usan las Edge Functions (receta, pagos)`)
const rpcViejo = await fetch(`${URL_}/rest/v1/rpc/estoy_en_modo_operador`, { method: 'POST', headers: { apikey: g.HEALTHIER_STAGING_SUPABASE_ANON_KEY, Authorization: `Bearer ${entrada.body.session.access_token}`, 'Content-Type': 'application/json' }, body: '{}' })
const rj = await rpcViejo.json().catch(() => ({}))
console.log(`ℹ️  PostgREST con el access token ya emitido: HTTP ${rpcViejo.status}, modo operador activo=${rj?.activo} (el JWT dura hasta jwt_exp; la app tiene que descartarlo al terminar el turno)`)
ok(rj?.activo !== true, 'terminada la sesión, la base ya no la reconoce como modo operador')
const entrada2 = await ingresar()
ok(entrada2.body.modo === 'profesional', 'segundo ingreso aprobado')
const sid2 = (await admin.from('operador_sesiones_log').select('session_id').eq('ingreso_id', entrada2.ingresoId).single()).data.session_id
const finPac = await paciente.rpc('terminar_turno_operador', { p_session_id: sid2 })
ok(!!finPac.error, 'un paciente no cierra la sesión de otro')
const finDesp = await despacho.rpc('terminar_turno_operador', { p_session_id: sid2 })
ok(!finDesp.error, `el despacho puede cerrar la sesión de un operador (${finDesp.error?.message ?? 'ok'})`)
const DNI_NUEVO = String(40000000 + Math.floor(Math.random() * 9000000))
const { data: sinDni } = await admin.from('profiles').select('id,dni').eq('email', 'demo.martin@healthier.app').single()
await admin.from('profiles').update({ dni: null }).eq('id', sinDni.id)
await admin.from('emergency_provider_profesionales').upsert({ provider_id: ENTIDAD, professional_id: sinDni.id }, { onConflict: 'provider_id,professional_id' })
const dniOp = await despachoOp.rpc('cargar_dni_de_profesional_de_entidad', { p_professional_id: sinDni.id, p_dni: DNI_NUEVO })
ok(!!dniOp.error, 'el operador del despacho (no admin) no carga DNI')
const dniOk = await despacho.rpc('cargar_dni_de_profesional_de_entidad', { p_professional_id: sinDni.id, p_dni: DNI_NUEVO })
ok(!dniOk.error, `el admin del despacho carga el DNI que falta (${dniOk.error?.message ?? 'ok'})`)
const dniPisa = await despacho.rpc('cargar_dni_de_profesional_de_entidad', { p_professional_id: sinDni.id, p_dni: String(Number(DNI_NUEVO) + 1) })
ok(!!dniPisa.error, 'no pisa un DNI ya cargado')
const dniFuera = await despacho.rpc('cargar_dni_de_profesional_de_entidad', { p_professional_id: PRO, p_dni: String(Number(DNI_NUEVO) + 2) })
ok(!!dniFuera.error, 'no carga DNI de alguien que ya tiene')
await admin.from('emergency_provider_profesionales').delete().eq('provider_id', ENTIDAD).eq('professional_id', sinDni.id)
await admin.from('profiles').update({ dni: sinDni.dni }).eq('id', sinDni.id)

// Limpieza (el log no se borra: es inmutable)
await admin.from('emergencies').update({ status: 'cancelled' }).eq('patient_id', paciente.uid).in('status', ['pending', 'awaiting_dispatch', 'dispatched', 'in_transit', 'arrived'])
await admin.from('ambulances').update({ status: 'disponible' }).eq('id', MOVIL)
await admin.from('emergency_provider_profesionales').delete().eq('provider_id', ENTIDAD).eq('professional_id', PRO)
await pro.auth.signOut().catch(() => {})
console.log(fallas ? `\n❌ ${fallas} chequeo(s) en rojo` : '\n✅ todo en verde')
process.exit(fallas ? 1 : 0)
