#!/usr/bin/env node
/**
 * Control del Federador de pacientes y de REFES (migración 196) — STAGING.
 *
 *   node scripts/verificar-federador.mjs
 *
 * Lo que tiene que seguir siendo cierto, y falla (exit 1) si deja de serlo:
 *
 * 1. **Con el bus caído, el alta del paciente completa igual.** Crea un
 *    paciente de prueba (`control+simular-bus-caido-…@staging.healthier.app`)
 *    como lo hace el front: signUp + login + guardar DNI/sexo/nacimiento desde
 *    su propia sesión. La función lo procesa como si el bus no respondiera.
 *    Exige: el guardado responde OK y rápido (< 3 s, no espera al bus), los
 *    datos quedan guardados, y el Federador queda en `error` con un reintento
 *    programado — nunca trabado en `pendiente` ni con el alta frenada.
 * 2. **Nadie se autoverifica.** Ese mismo paciente intenta escribirse un
 *    `federador_id` y un profesional intenta ponerse "Consultorio habilitado":
 *    los dos tienen que rebotar.
 * 3. **El consultorio no se traba.** Un profesional de prueba cambia su
 *    dirección: el guardado responde OK y en segundos el estado sale de
 *    `pendiente` (verificado / revisar / error). Al final se le deja la
 *    dirección que tenía.
 * 4. **El bus responde como esperamos**: token de Patient/*.read y una búsqueda
 *    por un DNI inexistente devuelve un Bundle vacío (no un 404 de ruta).
 *
 * Borra al paciente de prueba al terminar.
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createHmac, randomUUID } from 'node:crypto'

const env = Object.fromEntries(
  readFileSync(join(homedir(), 'Local', '.env'), 'utf8').split('\n')
    .map(l => l.match(/^(?:export )?([A-Z0-9_]+)=(.*)$/)).filter(Boolean)
    .map(m => [m[1], m[2].trim().replace(/^["']|["']$/g, '')]),
)
const URL = env.HEALTHIER_STAGING_SUPABASE_URL
const ANON = env.HEALTHIER_STAGING_SUPABASE_ANON_KEY
const SRV = env.HEALTHIER_STAGING_SUPABASE_SERVICE_ROLE_KEY
const PRO_EMAIL = 'pendiente@staging.healthier.app'

let fallas = 0
const ok = m => console.log(`  ✅ ${m}`)
const mal = m => { fallas++; console.log(`  ❌ ${m}`) }
const esperar = ms => new Promise(r => setTimeout(r, ms))
const srv = { apikey: SRV, Authorization: `Bearer ${SRV}`, 'Content-Type': 'application/json' }

async function sesion(email, password) {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
  })
  const j = await r.json()
  if (!j.access_token) throw new Error(`login ${email}: ${JSON.stringify(j).slice(0, 200)}`)
  return { apikey: ANON, Authorization: `Bearer ${j.access_token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }
}

async function leer(tabla, filtro, cols) {
  const r = await fetch(`${URL}/rest/v1/${tabla}?${filtro}&select=${cols}`, { headers: srv })
  return (await r.json())[0]
}

// ── 1 y 2 · Paciente con el bus caído ─────────────────────────────────────────
console.log('\n1 · Alta de paciente con el bus caído')
const email = `control+simular-bus-caido-${Date.now()}@staging.healthier.app`
const password = randomUUID()
let userId = null
try {
  const su = await fetch(`${URL}/auth/v1/admin/users`, {
    method: 'POST', headers: srv,
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { role: 'patient', first_name: 'Control', last_name: 'Federador', full_name: 'Control Federador' } }),
  })
  const u = await su.json()
  userId = u.id
  if (!userId) throw new Error(`no se pudo crear el usuario: ${JSON.stringify(u).slice(0, 200)}`)
  ok('usuario creado (el trigger de alta armó el perfil)')

  const h = await sesion(email, password)
  const t0 = Date.now()
  const g = await fetch(`${URL}/rest/v1/profiles?id=eq.${userId}`, {
    method: 'PATCH', headers: h,
    body: JSON.stringify({ dni: '10000001', gender: 'femenino', birth_date: '1990-01-01' }),
  })
  const ms = Date.now() - t0
  const fila = (await g.json())[0]
  if (g.ok && fila?.dni === '10000001') ok(`el paciente guardó sus datos (${ms} ms)`)
  else mal(`el guardado falló: ${g.status} ${JSON.stringify(fila).slice(0, 200)}`)
  if (ms > 3000) mal(`el guardado tardó ${ms} ms: parece que espera al bus`)

  let p
  for (let i = 0; i < 20; i++) {
    await esperar(1500)
    p = await leer('profiles', `id=eq.${userId}`, 'dni,federador_estado,federador_error,federador_proximo_intento')
    if (p?.federador_estado && p.federador_estado !== 'pendiente') break
  }
  if (p?.federador_estado === 'error' && p.federador_proximo_intento) ok(`Federador en error con reintento (${p.federador_error?.slice(0, 60)}…)`)
  else mal(`se esperaba error + reintento, quedó ${JSON.stringify(p)}`)
  if (p?.dni === '10000001') ok('el perfil sigue con sus datos')

  console.log('\n2 · Nadie se autoverifica')
  const trampa = await fetch(`${URL}/rest/v1/profiles?id=eq.${userId}`, { method: 'PATCH', headers: h, body: JSON.stringify({ federador_id: '123', federador_estado: 'vinculado' }) })
  if (trampa.status >= 400) ok(`el paciente no puede escribirse un federador_id (${trampa.status})`)
  else mal('el paciente pudo escribirse un federador_id')
} catch (e) {
  mal(e.message)
} finally {
  if (userId) {
    const d = await fetch(`${URL}/auth/v1/admin/users/${userId}`, { method: 'DELETE', headers: srv })
    d.ok ? ok('paciente de prueba borrado') : mal(`no se pudo borrar ${email}`)
  }
}

// ── 2b y 3 · Consultorio ──────────────────────────────────────────────────────
console.log('\n3 · Dirección del consultorio')
try {
  const h = await sesion(PRO_EMAIL, 'staging')
  const yo = (await (await fetch(`${URL}/auth/v1/user`, { headers: h })).json()).id
  const antes = await leer('professional_profiles', `user_id=eq.${yo}`, 'id,address')
  const trampa = await fetch(`${URL}/rest/v1/professional_profiles?id=eq.${antes.id}`, { method: 'PATCH', headers: h, body: JSON.stringify({ refes_estado: 'verificado' }) })
  if (trampa.status >= 400) ok(`el profesional no puede ponerse "Consultorio habilitado" (${trampa.status})`)
  else mal('el profesional pudo marcarse el consultorio como verificado')

  const t0 = Date.now()
  const g = await fetch(`${URL}/rest/v1/professional_profiles?id=eq.${antes.id}`, { method: 'PATCH', headers: h, body: JSON.stringify({ address: `Av. Santa Fe ${1000 + (Date.now() % 900)}, C1059ABF CABA` }) })
  const ms = Date.now() - t0
  g.ok && ms < 3000 ? ok(`guardó la dirección (${ms} ms)`) : mal(`guardar la dirección: ${g.status} en ${ms} ms`)
  let pp
  for (let i = 0; i < 20; i++) {
    await esperar(1500)
    pp = await leer('professional_profiles', `id=eq.${antes.id}`, 'refes_estado,refes_error')
    if (pp?.refes_estado && pp.refes_estado !== 'pendiente') break
  }
  ;['verificado', 'revisar', 'error'].includes(pp?.refes_estado)
    ? ok(`consultorio procesado: ${pp.refes_estado}${pp.refes_error ? ` (${pp.refes_error.slice(0, 70)}…)` : ''}`)
    : mal(`el consultorio quedó ${JSON.stringify(pp)}`)
  await fetch(`${URL}/rest/v1/professional_profiles?id=eq.${antes.id}`, { method: 'PATCH', headers: h, body: JSON.stringify({ address: antes.address }) })
} catch (e) {
  mal(e.message)
}

// ── 4 · Bus ───────────────────────────────────────────────────────────────────
console.log('\n4 · Bus del Ministerio')
try {
  const b64 = b => Buffer.from(b).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const data = `${b64(JSON.stringify({ typ: 'JWT', alg: 'HS256' }))}.${b64(JSON.stringify({ iss: env.MSAL_FHIR_ISSUER, iat: now, exp: now + 300, jti: randomUUID(), aud: 'aud', sub: 'sub', name: 'name', ident: 'ident', role: 'role' }))}`
  const assertion = `${data}.${createHmac('sha256', env.MSAL_FHIR_SECRET).update(data).digest('base64url')}`
  const a = await fetch('https://bus.msal.gob.ar/bus-auth/v2/auth', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grantType: 'client_credentials', scope: 'Patient/*.read', clientAssertionType: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer', clientAssertion: assertion }),
  })
  const tok = (await a.json()).accessToken
  tok ? ok('token de Patient/*.read') : mal(`el bus no dio token (${a.status})`)
  const q = new URLSearchParams({ identifier: 'http://www.renaper.gob.ar/dni|1000001', birthdate: '1900-01-01', gender: 'male' })
  const r = await fetch(`https://bus.msal.gob.ar/masterfile-federacion-service/fhir/Patient?${q}`, { headers: { Authorization: `Bearer ${tok}`, Accept: 'application/fhir+json' } })
  const j = await r.json().catch(() => null)
  r.status === 200 && j?.resourceType === 'Bundle' ? ok(`búsqueda en el Federador responde (total ${j.total ?? 0})`) : mal(`búsqueda en el Federador: ${r.status}`)
} catch (e) {
  mal(`bus: ${e.message}`)
}

console.log(fallas ? `\n❌ ${fallas} falla(s)` : '\n✅ Todo en orden')
process.exit(fallas ? 1 : 0)
