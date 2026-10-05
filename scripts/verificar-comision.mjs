#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Comisión por profesional (migración 184) — control automático, SÓLO STAGING.
//
//   node scripts/verificar-comision.mjs            # todo
//   node scripts/verificar-comision.mjs --sin-cobro  # sin pasar por mp-payment
//
// Qué prueba:
//   1. comision_efectiva: general / exento (0%) / intermedia (5%) / vencida →
//      general / paciente referido por ese mismo profesional → 0% / familiar
//      cuyo titular fue referido por ese profesional → 0% (185) / familiar de
//      un titular no referido → general.
//   2. Seguridad: un profesional o un paciente NO pueden cargar una tasa (ni por
//      RPC ni insertando en la tabla), no leen el historial ni llaman a
//      comision_efectiva. El super admin sí carga, y el profesional la ve con
//      mi_comision().
//   3. Cobro de punta a punta por mp-payment (deployada en staging): consulta
//      pagada 100% con créditos — es el único camino de staging que no necesita
//      una cuenta de Mercado Pago vinculada (staging no tiene `mp_accounts`).
//      Verifica en la fila de `payments` la tasa aplicada, el origen y el neto.
//
// Deja la base como la encontró: borra sólo las filas que insertó.
// ─────────────────────────────────────────────────────────────────────────────
import { cargarEnv, sesionDe } from './guia/sesion.mjs'

if (process.env.GUIA_BASE === 'produccion') { console.error('Este chequeo es sólo de staging.'); process.exit(2) }
const env = cargarEnv()
if (env.ref !== 'itjhrvlzuqvyhqtffumc') { console.error(`No es staging (${env.ref}).`); process.exit(2) }
const SIN_COBRO = process.argv.includes('--sin-cobro')

const PRO_EXENTO = 'pediatria@staging.healthier.app'
const PRO_GENERAL = 'nutricion@staging.healthier.app'
const PACIENTE = 'paciente.completo@staging.healthier.app'
const PACIENTE_REFERIDO = 'comision.referido@staging.healthier.app'
const SUPER = 'superadmin@healthier.app'

let fallas = 0
const ok = (cond, msg, extra = '') => {
  console.log(`  ${cond ? '✅' : '❌'} ${msg}${extra ? ` — ${extra}` : ''}`)
  if (!cond) fallas++
}

const svcHeaders = { apikey: env.service, Authorization: `Bearer ${env.service}`, 'Content-Type': 'application/json' }
async function rest(path, { method = 'GET', body, token, prefer = 'return=representation' } = {}) {
  const headers = token
    ? { apikey: env.anon, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: prefer }
    : { ...svcHeaders, Prefer: prefer }
  const r = await fetch(`${env.url}/rest/v1/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined })
  const txt = await r.text()
  let data = null
  try { data = txt ? JSON.parse(txt) : null } catch { data = txt }
  return { ok: r.ok, status: r.status, data }
}
const rpc = (fn, args = {}, token) => rest(`rpc/${fn}`, { method: 'POST', body: args, token })

async function perfil(email) {
  const { data } = await rest(`profiles?select=id,full_name,role,referred_by_professional_id&email=eq.${encodeURIComponent(email)}`)
  if (!data?.[0]) throw new Error(`No existe ${email} en staging`)
  return data[0]
}

const insertados = []   // ids de professional_commission_changes a borrar al final
async function cargarCambio(professionalId, rate, validUntil, reason = 'verificar-comision.mjs') {
  const { ok: bien, data } = await rest('professional_commission_changes', {
    method: 'POST', body: { professional_id: professionalId, rate, valid_until: validUntil, reason },
  })
  if (!bien) throw new Error(`No se pudo insertar el cambio: ${JSON.stringify(data)}`)
  insertados.push(data[0].id)
  return data[0]
}
async function efectiva(professionalId, patientId) {
  const { data } = await rpc('comision_efectiva', { p_professional_id: professionalId, p_patient_id: patientId })
  return Array.isArray(data) ? data[0] : data
}

const dias = (n) => new Date(Date.now() + n * 86400000).toISOString()

async function asegurarPacienteReferido(referrerId) {
  let p = await rest(`profiles?select=id,referred_by_professional_id&email=eq.${encodeURIComponent(PACIENTE_REFERIDO)}`)
  if (!p.data?.[0]) {
    const r = await fetch(`${env.url}/auth/v1/admin/users`, {
      method: 'POST', headers: svcHeaders,
      body: JSON.stringify({ email: PACIENTE_REFERIDO, email_confirm: true, password: `x-${crypto.randomUUID()}`, user_metadata: { full_name: 'Paciente Referido Prueba', role: 'patient' } }),
    })
    if (!r.ok) throw new Error(`No se pudo crear ${PACIENTE_REFERIDO}: ${await r.text()}`)
    await new Promise(res => setTimeout(res, 800))
    p = await rest(`profiles?select=id,referred_by_professional_id&email=eq.${encodeURIComponent(PACIENTE_REFERIDO)}`)
  }
  const fila = p.data[0]
  if (!fila.referred_by_professional_id) {
    await rest(`profiles?id=eq.${fila.id}`, { method: 'PATCH', body: { referred_by_professional_id: referrerId, role: 'patient' } })
    fila.referred_by_professional_id = referrerId
  }
  return fila
}

// Familiar del titular (181): el trigger crea su perfil al insertar el vínculo.
async function asegurarFamiliar(titularId, nombre) {
  const q = `family_members?select=familiar_id&patient_id=eq.${titularId}&full_name=eq.${encodeURIComponent(nombre)}`
  let { data } = await rest(q)
  if (!data?.[0]) {
    const r = await rest('family_members', { method: 'POST', body: { patient_id: titularId, full_name: nombre, relationship: 'hijo' } })
    if (!r.ok) throw new Error(`No se pudo crear el familiar: ${JSON.stringify(r.data)}`)
    data = (await rest(q)).data
  }
  return data[0].familiar_id
}

const creados = { consultas: [], creditos: [] }
async function cobrarConCreditos(pacienteEmail, pacienteId, professionalId, precio) {
  const { data: [cons] } = await rest('consultations', {
    method: 'POST',
    body: {
      patient_id: pacienteId, professional_id: professionalId, status: 'pending',
      scheduled_at: dias(3), modality: 'video', price_at_booking: precio, payment_status: 'pending_payment',
    },
  })
  creados.consultas.push(cons.id)
  const { data: [cred] } = await rest('patient_credits', {
    method: 'POST', body: { patient_id: pacienteId, amount: precio, reason: 'adjustment', note: 'verificar-comision.mjs' },
  })
  creados.creditos.push(cred.id)

  const sesion = await sesionDe(pacienteEmail, env)
  const r = await fetch(`${env.url}/functions/v1/mp-payment`, {
    method: 'POST',
    headers: { apikey: env.anon, Authorization: `Bearer ${sesion.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ consultationId: cons.id, useCredits: true }),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`mp-payment ${r.status}: ${JSON.stringify(j)}`)
  const { data: [pago] } = await rest(`payments?select=*&consultation_id=eq.${cons.id}`)
  return pago
}

async function limpiar() {
  for (const id of insertados) await rest(`professional_commission_changes?id=eq.${id}`, { method: 'DELETE' })
  for (const id of creados.consultas) {
    await rest(`patient_credits?consultation_id=eq.${id}`, { method: 'DELETE' })
    await rest(`payments?consultation_id=eq.${id}`, { method: 'DELETE' })
    await rest(`consultations?id=eq.${id}`, { method: 'DELETE' })
  }
  for (const id of creados.creditos) await rest(`patient_credits?id=eq.${id}`, { method: 'DELETE' })
}

try {
  const [exento, general, paciente, superAdmin] = await Promise.all([perfil(PRO_EXENTO), perfil(PRO_GENERAL), perfil(PACIENTE), perfil(SUPER)])
  const referido = await asegurarPacienteReferido(general.id)
  const { data: [settings] } = await rest('platform_settings?select=commission_rate&id=eq.1')
  const tasaGeneral = Number(settings.commission_rate)

  // Punto de partida conocido: los dos sin tasa propia vigente (filas temporales).
  await cargarCambio(exento.id, null, null)
  await cargarCambio(general.id, null, null)

  console.log(`\n1) comision_efectiva (general = ${tasaGeneral})`)
  let e = await efectiva(general.id, paciente.id)
  ok(Number(e.rate) === tasaGeneral && e.origen === 'general', 'profesional normal → la general', JSON.stringify(e))

  await cargarCambio(exento.id, 0, dias(30))
  e = await efectiva(exento.id, paciente.id)
  ok(Number(e.rate) === 0 && e.origen === 'profesional', 'exento hasta dentro de 30 días → 0%', JSON.stringify(e))

  e = await efectiva(general.id, referido.id)
  ok(Number(e.rate) === 0 && e.origen === 'referido', 'paciente traído por ese profesional → 0%', JSON.stringify(e))
  e = await efectiva(exento.id, referido.id)
  ok(e.origen !== 'referido', 'el referido de OTRO profesional no cuenta como referido', JSON.stringify(e))

  // Grupo familiar (185): el familiar del titular referido también va sin comisión.
  const famRef = await asegurarFamiliar(referido.id, 'Hijo Prueba Comisión')
  e = await efectiva(general.id, famRef)
  ok(Number(e.rate) === 0 && e.origen === 'referido', 'familiar de un titular traído por ese profesional → 0%', JSON.stringify(e))
  const { data: famNoRef } = await rest(`family_members?select=familiar_id&patient_id=eq.${paciente.id}&limit=1`)
  if (famNoRef?.[0]) {
    e = await efectiva(general.id, famNoRef[0].familiar_id)
    ok(Number(e.rate) === tasaGeneral && e.origen === 'general', 'familiar de un titular NO referido → la general', JSON.stringify(e))
  } else ok(false, `${PACIENTE} no tiene familiares para probar el caso no referido`)

  await cargarCambio(exento.id, 0.05, dias(10))
  e = await efectiva(exento.id, paciente.id)
  ok(Number(e.rate) === 0.05 && e.origen === 'profesional', 'tasa intermedia 5% → 5%', JSON.stringify(e))

  await cargarCambio(exento.id, 0, dias(-1))
  e = await efectiva(exento.id, paciente.id)
  ok(Number(e.rate) === tasaGeneral && e.origen === 'general', 'tasa propia vencida → vuelve a la general', JSON.stringify(e))

  console.log('\n2) Seguridad')
  const sPro = await sesionDe(PRO_EXENTO, env)
  const sPac = await sesionDe(PACIENTE, env)
  const sSuper = await sesionDe(SUPER, env)
  for (const [quien, s] of [['profesional', sPro], ['paciente', sPac]]) {
    const r1 = await rpc('fijar_comision_de_profesional', { p_professional_id: exento.id, p_rate: 0, p_until: null, p_reason: 'intento' }, s.access_token)
    ok(!r1.ok, `${quien} no puede cargar una tasa por RPC`, `HTTP ${r1.status}`)
    const r2 = await rest('professional_commission_changes', { method: 'POST', token: s.access_token, body: { professional_id: exento.id, rate: 0, reason: 'intento' } })
    ok(!r2.ok, `${quien} no puede insertar en el historial`, `HTTP ${r2.status}`)
    const r3 = await rest('professional_commission_changes?select=id', { token: s.access_token })
    ok(r3.ok && Array.isArray(r3.data) && r3.data.length === 0, `${quien} no lee el historial`, `${r3.data?.length} filas`)
    const r4 = await rpc('comision_efectiva', { p_professional_id: exento.id, p_patient_id: paciente.id }, s.access_token)
    ok(!r4.ok, `${quien} no puede llamar a comision_efectiva`, `HTTP ${r4.status}`)
  }
  const sinMotivo = await rpc('fijar_comision_de_profesional', { p_professional_id: exento.id, p_rate: 0, p_until: null, p_reason: ' ' }, sSuper.access_token)
  ok(!sinMotivo.ok, 'super admin sin motivo → rechazado', `HTTP ${sinMotivo.status}`)
  const fijado = await rpc('fijar_comision_de_profesional', { p_professional_id: exento.id, p_rate: 0, p_until: dias(20), p_reason: 'verificar-comision.mjs (super admin)' }, sSuper.access_token)
  ok(fijado.ok && fijado.data?.set_by === superAdmin.id, 'super admin carga exento y queda registrado quién', `HTTP ${fijado.status}`)
  if (fijado.ok) insertados.push(fijado.data.id)
  const lista = await rpc('comisiones_de_profesionales', {}, sSuper.access_token)
  const fila = lista.data?.find?.(x => x.professional_id === exento.id)
  ok(fila?.vigente === true && Number(fila.rate) === 0, 'aparece vigente en la lista del super admin')
  const mia = await rpc('mi_comision', {}, sPro.access_token)
  const m = mia.data?.[0]
  ok(m && Number(m.rate) === 0 && m.origen === 'profesional' && m.valid_until, 'el profesional ve su 0% con vencimiento', JSON.stringify(m))
  ok(m && !('reason' in m), 'el profesional NO ve el motivo')
  const intentoUpdate = await rest(`professional_commission_changes?id=eq.${fijado.data?.id}`, { method: 'PATCH', body: { rate: 0.5 } })
  ok(!intentoUpdate.ok, 'el historial no se edita (ni con service role)', `HTTP ${intentoUpdate.status}`)

  if (!SIN_COBRO) {
    console.log('\n3) Cobro por mp-payment (100% créditos)')
    const precio = 10000
    let p = await cobrarConCreditos(PACIENTE, paciente.id, exento.id, precio)
    ok(p && Number(p.commission_rate_applied) === 0 && p.commission_source === 'profesional' && Number(p.net_to_professional) === precio,
      'exento: tasa 0, origen profesional, neto = bruto', `rate=${p?.commission_rate_applied} src=${p?.commission_source} neto=${p?.net_to_professional}`)
    p = await cobrarConCreditos(PACIENTE, paciente.id, general.id, precio)
    ok(p && Number(p.commission_rate_applied) === tasaGeneral && p.commission_source === 'general' && Number(p.net_to_professional) === Math.round(precio * (1 - tasaGeneral) * 100) / 100,
      'normal: tasa general, neto = bruto × (1 − general)', `rate=${p?.commission_rate_applied} src=${p?.commission_source} neto=${p?.net_to_professional}`)
    p = await cobrarConCreditos(PACIENTE_REFERIDO, referido.id, general.id, precio)
    ok(p && Number(p.commission_rate_applied) === 0 && p.commission_source === 'referido' && Number(p.net_to_professional) === precio,
      'referido: tasa 0, origen referido, neto = bruto', `rate=${p?.commission_rate_applied} src=${p?.commission_source} neto=${p?.net_to_professional}`)
  }
} catch (err) {
  console.error('\n💥', err.message)
  fallas++
} finally {
  await limpiar()
}

console.log(fallas ? `\n❌ ${fallas} chequeo(s) en rojo.` : '\n✅ Comisión por profesional OK.')
process.exit(fallas ? 1 : 0)
