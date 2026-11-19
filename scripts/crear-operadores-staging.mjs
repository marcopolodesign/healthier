#!/usr/bin/env node
/**
 * Crea (o repara) las cuentas operador1..5@staging.healthier.app en STAGING,
 * asignadas al Móvil 1 como `crew_role = 'operador'` (migración 241).
 * Idempotente. SÓLO staging: en prod las cuentas operador1..5@healthier.app
 * las crea Mateo/Medizin cuando dé el OK (mismo procedimiento).
 *
 *   node scripts/crear-operadores-staging.mjs
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const env = Object.fromEntries(
  readFileSync(join(homedir(), 'Local', '.env'), 'utf8')
    .split('\n').map(l => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2]]))
const URL_ = env.HEALTHIER_STAGING_SUPABASE_URL, SK = env.HEALTHIER_STAGING_SUPABASE_SERVICE_ROLE_KEY
const MOVIL_1 = '40000000-0000-0000-0000-000000000001'
const H = { apikey: SK, Authorization: `Bearer ${SK}`, 'Content-Type': 'application/json' }

async function rest(path, opts = {}) {
  const r = await fetch(`${URL_}/rest/v1/${path}`, { ...opts, headers: { ...H, Prefer: 'return=representation,resolution=merge-duplicates', ...(opts.headers ?? {}) } })
  const t = await r.text()
  if (!r.ok) throw new Error(`${path}: ${r.status} ${t}`)
  return t ? JSON.parse(t) : null
}

for (let i = 1; i <= 5; i++) {
  const email = `operador${i}@staging.healthier.app`
  let id
  const c = await fetch(`${URL_}/auth/v1/admin/users`, { method: 'POST', headers: H, body: JSON.stringify({ email, password: 'staging', email_confirm: true, user_metadata: { full_name: `Operador ${i}` } }) })
  const cj = await c.json()
  if (cj.id) id = cj.id
  else {
    // Ya existía en Auth: se busca por mail (el perfil puede no existir todavía).
    for (let pag = 1; !id && pag <= 20; pag++) {
      const l = await (await fetch(`${URL_}/auth/v1/admin/users?page=${pag}&per_page=200`, { headers: H })).json()
      if (!l.users?.length) break
      id = l.users.find(u => u.email === email)?.id
    }
    if (!id) throw new Error(`${email}: ${JSON.stringify(cj)}`)
  }
  // El perfil no lo crea ningún trigger con el alta por Admin API: se upsertea.
  await rest('profiles?on_conflict=id', { method: 'POST', body: JSON.stringify({ id, email, full_name: `Operador ${i}`, role: 'emergency_crew' }) })
  const ya = await rest(`ambulance_crew?profile_id=eq.${id}&ambulance_id=eq.${MOVIL_1}&select=id,active`)
  if (ya?.length) await rest(`ambulance_crew?id=eq.${ya[0].id}`, { method: 'PATCH', body: JSON.stringify({ active: true, crew_role: 'operador' }) })
  else await rest('ambulance_crew', { method: 'POST', body: JSON.stringify({ ambulance_id: MOVIL_1, profile_id: id, crew_role: 'operador', active: true }) })
  console.log('OK', email, id)
}
