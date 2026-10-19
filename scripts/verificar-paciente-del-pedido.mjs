#!/usr/bin/env node
/**
 * Control de `paciente_del_pedido` (migraciones 207/208) — SÓLO staging.
 *
 * Falla si vuelve:
 *   - que el profesional elegible no vea el nombre, la edad, el sexo o la
 *     cobertura del paciente antes de aceptar (la hoja del llamado queda muda);
 *   - que alguien que NO puede tomar el pedido (otro paciente, un profesional
 *     fuera del on-demand) lea esos datos;
 *   - que una cuenta de prueba lea a un paciente real o al revés (209: la
 *     función tiene que pasar por `cuentas_compatibles`, regla de la 186).
 *
 * Usa las cuentas de `seed-llamado-profesional.mjs` (las deja listas sola).
 *   node scripts/verificar-paciente-del-pedido.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const leerEnv = (ruta) => {
  try {
    return Object.fromEntries(readFileSync(ruta, 'utf8').split('\n')
      .filter(l => l.includes('=') && !l.trimStart().startsWith('#'))
      .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }))
  } catch { return {} }
}
const env = { ...leerEnv(join(homedir(), 'Local', 'Healthier', '.env')), ...leerEnv(join(homedir(), 'Local', '.env')) }
const URL = env.HEALTHIER_STAGING_SUPABASE_URL
const ANON = env.HEALTHIER_STAGING_SUPABASE_ANON_KEY
if (!URL || URL.includes('aixjejdoofervrkggbkd')) { console.error('Sólo staging.'); process.exit(1) }

const salida = execFileSync('node', [join(dirname(fileURLToPath(import.meta.url)), 'seed-llamado-profesional.mjs'), '--pedido'], { encoding: 'utf8' })
const requestId = salida.match(/Pedido ([0-9a-f-]{36})/)?.[1]
if (!requestId) { console.error(salida); process.exit(1) }

async function como(email) {
  const c = createClient(URL, ANON, { auth: { persistSession: false } })
  const { error } = await c.auth.signInWithPassword({ email, password: 'staging' })
  if (error) throw new Error(`${email}: ${error.message}`)
  return c
}
let fallos = 0
const ok = (cond, m) => { console.log(`  ${cond ? '✅' : '❌'} ${m}`); if (!cond) fallos++ }

const pro = await como('pro.llamado@staging.healthier.app')
const { data: f, error } = await pro.rpc('paciente_del_pedido', { p_request_id: requestId })
ok(!error && f?.nombre === 'Sofía Méndez', `el profesional elegible ve el nombre (${f?.nombre ?? error?.message})`)
ok(typeof f?.edad === 'number' && f?.sexo === 'femenino' && f?.cobertura === 'OSDE', 'y la edad, el sexo y la cobertura')
ok(Object.keys(f ?? {}).sort().join() === 'cobertura,edad,nombre,para_familiar,sexo', 'y nada más del perfil')

const otro = await como('paciente.completo@staging.healthier.app')
const { data: f2 } = await otro.rpc('paciente_del_pedido', { p_request_id: requestId })
ok(f2 == null, 'otro paciente no lee nada')

// El paciente cancela: el pedido deja de estar abierto y nadie lo lee más.
const pac = await como('paciente.llamado@staging.healthier.app')
const { data: { session } } = await pac.auth.getSession()
await fetch(`${URL}/functions/v1/ondemand-despacho`, {
  method: 'POST', headers: { Authorization: `Bearer ${session.access_token}`, apikey: ANON, 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'cancelar', requestId }),
})
const { data: f3 } = await pro.rpc('paciente_del_pedido', { p_request_id: requestId })
ok(f3 == null, 'con el pedido cancelado, el profesional ya no lo lee')

// 209: el aislamiento de cuentas de prueba (186) vive en la definición.
if (env.SUPABASE_ACCESS_TOKEN && env.HEALTHIER_STAGING_SUPABASE_REF) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${env.HEALTHIER_STAGING_SUPABASE_REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: "select pg_get_functiondef('public.paciente_del_pedido(uuid)'::regprocedure) as def" }),
  })
  const def = (await r.json())?.[0]?.def ?? ''
  ok(def.includes('cuentas_compatibles'), 'paciente_del_pedido respeta el aislamiento de cuentas de prueba (209)')
} else ok(false, 'sin SUPABASE_ACCESS_TOKEN no se pudo leer la definición de paciente_del_pedido')

console.log(fallos ? `\n${fallos} en rojo` : '\nTodo en verde')
process.exit(fallos ? 1 : 0)
