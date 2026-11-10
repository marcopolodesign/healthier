#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Referidos — fase 1 (migración 231): código para todos + atribución con tipo.
// Control automático, SÓLO STAGING.
//
//   node scripts/verificar-referidos.mjs
//
// Qué prueba:
//   1. Todo titular paciente/profesional tiene código, y el del profesional es
//      el mismo de su link /r/<codigo> (professional_profiles.referral_code).
//   2. Un alta nueva recibe código sola, con el alfabeto sin i/l/o/0/1.
//   3. Quedar con referred_by_professional_id (el link de la 115) registra la
//      atribución: tipo profesional_paciente, origen link_profesional, código
//      del profesional. Y comision_efectiva sigue dando 0% "referido".
//   4. Inmutables: ni el código ni la atribución se reescriben (tampoco con la
//      service role). El paciente lee su código y su atribución, no los de
//      otros, y no puede escribir en ninguna de las dos tablas.
//   5. cio: cio.referidos y cio.people_referidos muestran al referido (con la
//      marca de prueba apagada un momento) y cio_reader las puede leer.
//
// Fase 2 (migración 235) — canje:
//   6. canjear_codigo: atribuye (profesional → paciente por link, paciente →
//      paciente por código), write-once, no a uno mismo, no código inválido,
//      no en círculo. El 0% del profesional sigue; el de paciente → paciente
//      NO toca la comisión.
//   7. El cliente ya no puede escribir referred_by_professional_id (hueco de la 115).
//   8. /r/<codigo> de paciente se resuelve (sólo nombre de pila); mi_programa_de_referidos
//      cuenta; el super admin ve las atribuciones con tipo.
//
// Crea pacientes de prueba y los borra al final.
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import os from 'node:os'
import { cargarEnv, sesionDe } from './guia/sesion.mjs'

if (process.env.GUIA_BASE === 'produccion') { console.error('Este chequeo es sólo de staging.'); process.exit(2) }
const env = cargarEnv()
if (env.ref !== 'itjhrvlzuqvyhqtffumc') { console.error(`No es staging (${env.ref}).`); process.exit(2) }

const PRO = 'pediatria@staging.healthier.app'
const OTRO = 'paciente.completo@staging.healthier.app'

let fallas = 0
const ok = (cond, msg, extra = '') => {
  console.log(`  ${cond ? '✅' : '❌'} ${msg}${extra ? ` — ${extra}` : ''}`)
  if (!cond) fallas++
}

const svc = { apikey: env.service, Authorization: `Bearer ${env.service}`, 'Content-Type': 'application/json' }
async function rest(path, { method = 'GET', body, token } = {}) {
  const headers = token
    ? { apikey: env.anon, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }
    : { ...svc, Prefer: 'return=representation' }
  const r = await fetch(`${env.url}/rest/v1/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined })
  const txt = await r.text()
  let data = null
  try { data = txt ? JSON.parse(txt) : null } catch { data = txt }
  return { ok: r.ok, status: r.status, data }
}

// SQL como un rol concreto (cio_reader) — Management API.
const accessToken = (() => {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN
  const m = fs.readFileSync(`${os.homedir()}/Local/.env`, 'utf8').match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)
  return m?.[1].replace(/^['"]|['"]$/g, '')
})()
async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${env.ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'User-Agent': 'verificar-referidos' },
    body: JSON.stringify({ query }),
  })
  const j = await r.json().catch(() => null)
  if (!r.ok) throw new Error(`SQL ${r.status}: ${JSON.stringify(j).slice(0, 300)}`)
  return j
}

async function perfil(email) {
  const { data } = await rest(`profiles?select=id,role&email=eq.${encodeURIComponent(email)}`)
  if (!data?.[0]) throw new Error(`No existe ${email} en staging`)
  return data[0]
}

const ALFABETO = /^[abcdefghjkmnpqrstuvwxyz23456789]{8}$/
let nuevoId = null
const creados = []

try {
  console.log('\n1. Códigos para todos')
  const [{ sin_codigo, desalineados }] = await sql(`
    select
      (select count(*) from profiles p where p.role in ('patient','professional') and p.titular_id is null
         and not exists (select 1 from referral_codes rc where rc.user_id = p.id))::int as sin_codigo,
      (select count(*) from professional_profiles pp join referral_codes rc on rc.user_id = pp.user_id
         where rc.code is distinct from pp.referral_code)::int as desalineados`)
  ok(sin_codigo === 0, 'todo titular paciente/profesional tiene código', `${sin_codigo} sin código`)
  ok(desalineados === 0, 'el código del profesional es el de su link /r/', `${desalineados} desalineados`)

  const pro = await perfil(PRO)
  const otro = await perfil(OTRO)
  const { data: [ppPro] } = await rest(`professional_profiles?select=referral_code&user_id=eq.${pro.id}`)

  console.log('\n2. Alta nueva')
  const email = `referidos.${Date.now()}@staging.healthier.app`
  const alta = await fetch(`${env.url}/auth/v1/admin/users`, {
    method: 'POST', headers: svc,
    body: JSON.stringify({ email, email_confirm: true, password: crypto.randomUUID(), user_metadata: { role: 'patient', nombre: 'Prueba', apellido: 'Referidos' } }),
  }).then((r) => r.json())
  nuevoId = alta.id
  if (!nuevoId) throw new Error(`No se pudo crear el usuario: ${JSON.stringify(alta).slice(0, 200)}`)
  const { data: [codNuevo] } = await rest(`referral_codes?select=code&user_id=eq.${nuevoId}`)
  ok(ALFABETO.test(codNuevo?.code ?? ''), 'el alta nueva tiene código de 8 caracteres sin i/l/o/0/1', codNuevo?.code)

  console.log('\n3. Atribución desde el link del profesional')
  // Lo mismo que hace authService al registrarse por /r/<codigo>.
  await rest(`profiles?id=eq.${nuevoId}`, { method: 'PATCH', body: { referred_by_professional_id: pro.id } })
  const { data: [atr] } = await rest(`referral_attributions?select=*&referred_id=eq.${nuevoId}`)
  ok(atr?.referrer_id === pro.id, 'quedó atribuido al profesional')
  ok(atr?.tipo === 'profesional_paciente', 'tipo profesional_paciente', atr?.tipo)
  ok(atr?.origen === 'link_profesional', 'origen link_profesional', atr?.origen)
  ok(atr?.codigo === ppPro.referral_code, 'guarda el código del link', atr?.codigo)
  const { data: com } = await rest('rpc/comision_efectiva', { method: 'POST', body: { p_professional_id: pro.id, p_patient_id: nuevoId } })
  ok(com?.[0]?.origen === 'referido' && Number(com?.[0]?.rate) === 0, 'comision_efectiva sigue en 0% referido', JSON.stringify(com?.[0]))

  console.log('\n4. Inmutables y permisos')
  await rest(`referral_codes?user_id=eq.${nuevoId}`, { method: 'PATCH', body: { code: 'zzzzzzzz' } })
  const { data: [codDespues] } = await rest(`referral_codes?select=code&user_id=eq.${nuevoId}`)
  ok(codDespues?.code === codNuevo.code, 'el código no cambia ni con la service role')
  const edit = await rest(`referral_attributions?referred_id=eq.${nuevoId}`, { method: 'PATCH', body: { referrer_id: otro.id } })
  ok(!edit.ok, 'la atribución no se edita ni con la service role', `HTTP ${edit.status}`)

  const s = await sesionDe(email, env)
  const tok = s.access_token
  const mios = await rest('referral_codes?select=user_id,code', { token: tok })
  ok(mios.ok && mios.data.length === 1 && mios.data[0].user_id === nuevoId, 'el paciente lee sólo su código', `${mios.data?.length} filas`)
  const misAtr = await rest('referral_attributions?select=referred_id', { token: tok })
  ok(misAtr.ok && misAtr.data.length === 1, 'el paciente lee sólo su atribución', `${misAtr.data?.length} filas`)
  const ins = await rest('referral_attributions', { method: 'POST', token: tok, body: { referred_id: otro.id, referrer_id: nuevoId, referrer_rol: 'patient', referred_rol: 'patient', tipo: 'paciente_paciente', origen: 'codigo' } })
  ok(!ins.ok, 'el paciente no puede autoatribuirse referidos', `HTTP ${ins.status}`)
  const insCod = await rest('referral_codes', { method: 'POST', token: tok, body: { user_id: nuevoId, code: 'abcdefgh' } })
  ok(!insCod.ok, 'el paciente no puede escribir códigos', `HTTP ${insCod.status}`)
  // Ni reescribir la columna de la 115 para cambiar de referente.
  await rest(`profiles?id=eq.${nuevoId}`, { method: 'PATCH', token: tok, body: { referred_by_professional_id: otro.id } })
  const { data: [atr2] } = await rest(`referral_attributions?select=referrer_id&referred_id=eq.${nuevoId}`)
  ok(atr2?.referrer_id === pro.id, 'cambiar referred_by desde el cliente no mueve la atribución')

  console.log('\n5. cio')
  await sql(`update profiles set es_prueba = false where id = '${nuevoId}'`)
  const filaCio = await sql(`set local role cio_reader; select * from cio.referidos where referido_id = '${nuevoId}'`)
  ok(filaCio.length === 1 && filaCio[0].tipo === 'profesional_paciente' && filaCio[0].referente_id === pro.id,
    'cio.referidos lo muestra (leído como cio_reader)')
  const persona = await sql(`set local role cio_reader; select * from cio.people_referidos where id = '${nuevoId}'`)
  ok(persona.length === 1 && persona[0].codigo_referido === codNuevo.code && persona[0].referido_por_id === pro.id,
    'cio.people_referidos trae su código y quién lo refirió')
  const proCio = await sql(`set local role cio_reader; select referidos_total from cio.people_referidos where id = '${pro.id}'`)
  ok(proCio.length === 0 || Number(proCio[0].referidos_total) >= 1, 'el referente suma el referido (si no es cuenta de prueba)')
  const salud = await sql(`set local role cio_reader; select count(*)::int n from information_schema.columns where table_schema='cio' and table_name in ('referidos','people_referidos') and column_name ~ '(diagn|medic|alerg|icd|specialty)'`)
  ok(salud[0].n === 0, 'las vistas nuevas no tienen columnas de datos de salud')

  // ── Fase 2 ──────────────────────────────────────────────────────────────
  async function nuevoPaciente(tag) {
    const mail = `referidos.${tag}.${Date.now()}@staging.healthier.app`
    const a = await fetch(`${env.url}/auth/v1/admin/users`, {
      method: 'POST', headers: svc,
      body: JSON.stringify({ email: mail, email_confirm: true, password: crypto.randomUUID(), user_metadata: { role: 'patient', first_name: tag, last_name: 'Referidos', full_name: `${tag} Referidos` } }),
    }).then((r) => r.json())
    if (!a.id) throw new Error(`No se pudo crear ${tag}: ${JSON.stringify(a).slice(0, 200)}`)
    creados.push(a.id)
    const ses = await sesionDe(mail, env)
    const [{ code }] = (await rest(`referral_codes?select=code&user_id=eq.${a.id}`)).data
    return { id: a.id, mail, tok: ses.access_token, code }
  }
  const canjear = (u, codigo, via = 'codigo') =>
    rest('rpc/canjear_codigo', { method: 'POST', token: u.tok, body: { p_codigo: codigo, p_via: via } }).then((r) => r.data)
  const comision = (proId, pacId) =>
    rest('rpc/comision_efectiva', { method: 'POST', body: { p_professional_id: proId, p_patient_id: pacId } }).then((r) => r.data?.[0])

  console.log('\n6. Canje')
  const B = await nuevoPaciente('B')
  const r1 = await canjear(B, ppPro.referral_code.toUpperCase(), 'link')
  ok(r1?.ok === true && r1.tipo === 'profesional_paciente', 'B canjea el código del profesional (link)', JSON.stringify(r1))
  const [aB] = (await rest(`referral_attributions?select=*&referred_id=eq.${B.id}`)).data
  ok(aB?.referrer_id === pro.id && aB.origen === 'link_profesional', 'atribución origen link_profesional', aB?.origen)
  const [pB] = (await rest(`profiles?select=referred_by_professional_id&id=eq.${B.id}`)).data
  ok(pB?.referred_by_professional_id === pro.id, 'el canje del profesional escribe referred_by_professional_id')
  const cB = await comision(pro.id, B.id)
  ok(cB?.origen === 'referido' && Number(cB?.rate) === 0, 'comisión 0% intacta para el referido por profesional', JSON.stringify(cB))

  const [{ code: codOtro }] = (await rest(`referral_codes?select=code&user_id=neq.${pro.id}&limit=1`)).data
  const r2 = await canjear(B, codOtro, 'codigo')
  ok(r2?.ok === false && r2.motivo === 'ya_tiene_referente', 'write-once: el segundo canje no pisa al primero', r2?.motivo)

  const D = await nuevoPaciente('D')
  const r3 = await canjear(D, B.code, 'codigo')
  ok(r3?.ok === true && r3.tipo === 'paciente_paciente', 'D canjea el código de un paciente', JSON.stringify(r3))
  const [aD] = (await rest(`referral_attributions?select=*&referred_id=eq.${D.id}`)).data
  ok(aD?.referrer_id === B.id && aD.origen === 'codigo', 'atribución paciente_paciente origen codigo', aD?.origen)
  const [pD] = (await rest(`profiles?select=referred_by_professional_id&id=eq.${D.id}`)).data
  ok(pD?.referred_by_professional_id === null, 'paciente → paciente NO escribe referred_by_professional_id')
  const cD = await comision(pro.id, D.id)
  ok(cD?.origen !== 'referido' && Number(cD?.rate) > 0, 'paciente → paciente no cambia la comisión', JSON.stringify(cD))

  const E = await nuevoPaciente('E')
  const rp = await canjear(E, E.code)
  ok(rp?.motivo === 'propio', 'no se puede canjear el propio código', rp?.motivo)
  const ri = await canjear(E, 'zzzzzzzz')
  ok(ri?.motivo === 'codigo_invalido', 'código inexistente', ri?.motivo)
  const F = await nuevoPaciente('F')
  await canjear(F, E.code)
  const rc = await canjear(E, F.code)
  ok(rc?.motivo === 'circular', 'no se puede cerrar un círculo', rc?.motivo)

  const G = await nuevoPaciente('G')
  const cons = await rest('consultations', { method: 'POST', body: { patient_id: G.id, professional_id: pro.id, status: 'pending', scheduled_at: new Date(Date.now() + 86400000).toISOString() } })
  if (cons.ok) {
    const rg = await canjear(G, B.code)
    ok(rg?.motivo === 'ya_consulto', 'no se canjea después de la primera consulta', rg?.motivo)
    await rest(`consultations?patient_id=eq.${G.id}`, { method: 'DELETE' })
  } else {
    console.log(`  ⚠️  no se pudo sembrar una consulta (${cons.status}); "ya_consulto" sin probar`)
  }

  console.log('\n7. El cliente no escribe la atribución')
  const H = await nuevoPaciente('H')
  await rest(`profiles?id=eq.${H.id}`, { method: 'PATCH', token: H.tok, body: { referred_by_professional_id: pro.id } })
  const [pH] = (await rest(`profiles?select=referred_by_professional_id&id=eq.${H.id}`)).data
  const comH = await comision(pro.id, H.id)
  ok(pH?.referred_by_professional_id === null, 'PATCH directo de referred_by_professional_id se ignora', String(pH?.referred_by_professional_id))
  ok(comH?.origen !== 'referido', 'y la comisión del profesional no baja a 0%', JSON.stringify(comH))
  const rh = await canjear(H, ppPro.referral_code, 'link')
  ok(rh?.ok === true, 'por la función sí se puede (H sigue sin referente)')

  console.log('\n8. /r/ de paciente, "Invitá" y super admin')
  const anon = await fetch(`${env.url}/rest/v1/rpc/resolver_codigo_de_paciente`, {
    method: 'POST', headers: { apikey: env.anon, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_codigo: B.code }),
  }).then((r) => r.json())
  ok(anon?.[0]?.first_name === 'B' && Object.keys(anon[0]).join() === 'first_name', 'el código de paciente se resuelve en público (sólo nombre de pila, sin id)', JSON.stringify(anon))
  const anonPro = await fetch(`${env.url}/rest/v1/rpc/resolver_codigo_de_paciente`, {
    method: 'POST', headers: { apikey: env.anon, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_codigo: ppPro.referral_code }),
  }).then((r) => r.json())
  ok(Array.isArray(anonPro) && anonPro.length === 0, 'el código de un profesional no sale por el resolver de pacientes')
  const prog = await rest('rpc/mi_programa_de_referidos', { method: 'POST', token: B.tok, body: {} })
  ok(prog.data?.[0]?.codigo === B.code && Number(prog.data[0].se_sumaron) === 1, 'mi_programa_de_referidos: B ve su código y "1 se sumó"', JSON.stringify(prog.data))
  const sinSesion = await fetch(`${env.url}/rest/v1/rpc/canjear_codigo`, {
    method: 'POST', headers: { apikey: env.anon, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_codigo: B.code }),
  })
  ok(sinSesion.status >= 400, 'canjear_codigo no se puede llamar sin sesión', `HTTP ${sinSesion.status}`)
  // Anónimo SIN token: ninguna de las tres funciones puede dar datos.
  const anonRpc = (fn, body) => fetch(`${env.url}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: { apikey: env.anon, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }))
  const aAtr = await anonRpc('atribuciones_de_referidos', { p_incluir_prueba: true })
  ok(aAtr.status >= 400 || (Array.isArray(aAtr.data) && aAtr.data.length === 0), 'anon sin token no ve atribuciones_de_referidos', `HTTP ${aAtr.status}`)
  const aProg = await anonRpc('mi_programa_de_referidos', {})
  ok(aProg.status >= 400 || (Array.isArray(aProg.data) && aProg.data.length === 0) || aProg.data?.[0]?.codigo == null, 'anon sin token no ve mi_programa_de_referidos', `HTTP ${aProg.status}`)
  const aCanje = await anonRpc('canjear_codigo', { p_codigo: B.code })
  ok(aCanje.status >= 400, 'anon sin token no puede canjear_codigo', `HTTP ${aCanje.status}`)
  const noAdmin = await rest('rpc/atribuciones_de_referidos', { method: 'POST', token: B.tok, body: { p_incluir_prueba: true } })
  ok(!noAdmin.ok, 'un paciente no ve las atribuciones del super admin', `HTTP ${noAdmin.status}`)
  const sa = await perfil('superadmin@healthier.app').catch(() => null)
  if (sa) {
    const ses = await sesionDe('superadmin@healthier.app', env)
    const todas = await rest('rpc/atribuciones_de_referidos', { method: 'POST', token: ses.access_token, body: { p_incluir_prueba: true } })
    const tipos = new Set((todas.data ?? []).map((x) => x.tipo))
    ok(todas.ok && tipos.has('paciente_paciente') && tipos.has('profesional_paciente'), 'el super admin ve atribuciones de los dos tipos', [...tipos].join(','))
  } else {
    console.log('  ⚠️  sin cuenta superadmin en staging; vista de super admin sin probar')
  }
} catch (e) {
  console.error('\n💥', e.message)
  fallas++
} finally {
  for (const id of creados) {
    await fetch(`${env.url}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: svc }).catch(() => {})
    await sql(`delete from referral_attributions where referred_id = '${id}' or referrer_id = '${id}'; delete from profiles where id = '${id}'`).catch(() => {})
  }
  if (nuevoId) {
    const r = await fetch(`${env.url}/auth/v1/admin/users/${nuevoId}`, { method: 'DELETE', headers: svc })
    // Si el borrado del auth no cascadea al perfil, se limpia a mano.
    await sql(`delete from referral_attributions where referred_id = '${nuevoId}'; delete from profiles where id = '${nuevoId}'`).catch(() => {})
    console.log(`\n(limpieza: usuario de prueba borrado — HTTP ${r.status})`)
  }
}

console.log(fallas ? `\n❌ ${fallas} falla(s)` : '\n✅ Todo en verde')
process.exit(fallas ? 1 : 0)
