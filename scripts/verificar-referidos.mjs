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
// Crea un paciente de prueba y lo borra al final.
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
} catch (e) {
  console.error('\n💥', e.message)
  fallas++
} finally {
  if (nuevoId) {
    const r = await fetch(`${env.url}/auth/v1/admin/users/${nuevoId}`, { method: 'DELETE', headers: svc })
    // Si el borrado del auth no cascadea al perfil, se limpia a mano.
    await sql(`delete from referral_attributions where referred_id = '${nuevoId}'; delete from profiles where id = '${nuevoId}'`).catch(() => {})
    console.log(`\n(limpieza: usuario de prueba borrado — HTTP ${r.status})`)
  }
}

console.log(fallas ? `\n❌ ${fallas} falla(s)` : '\n✅ Todo en verde')
process.exit(fallas ? 1 : 0)
