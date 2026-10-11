#!/usr/bin/env node
/**
 * Backfill del Federador: pasa por la búsqueda a los pacientes que ya existían
 * antes de la migración 196 (los nuevos entran solos por el trigger).
 *
 *   node scripts/federador-backfill.mjs                         # staging, sólo cuenta
 *   node scripts/federador-backfill.mjs --correr                # staging, corre
 *   node scripts/federador-backfill.mjs --entorno produccion    # producción, sólo cuenta
 *   node scripts/federador-backfill.mjs --entorno produccion --correr --confirmo-produccion
 *
 * En lotes de --lote (default 20) con una pausa de --pausa segundos (default 5)
 * entre lotes; dentro del lote la función ya va de a uno cada 400 ms. Así no
 * hay ráfagas contra el bus del Ministerio.
 *
 * Qué hace: marca `federador_estado = 'pendiente'` a los pacientes con identidad
 * completa que nunca se intentaron (NULL), y llama a `federador-paciente`
 * con { lote } hasta que no quede ninguno pendiente. Lo que sale en error queda
 * para el cron de reintentos.
 *
 * 🔴 En producción NO se corre sin el OK de Mateo (de ahí el flag).
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

const leerEnv = (ruta) => Object.fromEntries(
  readFileSync(ruta, 'utf8').split('\n')
    .filter(l => l.trim() && !l.trim().startsWith('#') && l.includes('='))
    .map(l => [l.slice(0, l.indexOf('=')).trim().replace(/^export /, ''), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]),
)
const arg = (n, d = null) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1] }
const flag = (n) => process.argv.includes(`--${n}`)

const ENTORNO = arg('entorno', 'staging')
const LOTE = Number(arg('lote', 20))
const PAUSA = Number(arg('pausa', 5)) * 1000
let URL, KEY
if (ENTORNO === 'produccion') {
  const env = leerEnv(resolve(homedir(), 'Local/Healthier/website/.env'))
  URL = env.VITE_SUPABASE_URL; KEY = env.SUPABASE_SERVICE_ROLE_KEY
} else {
  const env = leerEnv(resolve(homedir(), 'Local/.env'))
  URL = env.HEALTHIER_STAGING_SUPABASE_URL; KEY = env.HEALTHIER_STAGING_SUPABASE_SERVICE_ROLE_KEY
}
if (!URL || !KEY) { console.error(`Faltan credenciales de ${ENTORNO}`); process.exit(1) }
if (ENTORNO === 'produccion' && flag('correr') && !flag('confirmo-produccion')) {
  console.error('En producción hace falta --confirmo-produccion (y el OK de Mateo).'); process.exit(1)
}

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }
const rest = (p, init = {}) => fetch(`${URL}/rest/v1/${p}`, { ...init, headers: { ...H, ...(init.headers ?? {}) } })

const federable = (p) => {
  const dni = String(p.dni ?? '').replace(/\D/g, '')
  return p.role === 'patient' && !p.deleted_at && dni.length >= 7 && dni.length <= 8
    && p.gender && p.birth_date && ((p.last_name ?? '').trim() || (p.full_name ?? '').trim())
}

let filas = await (await rest('profiles?select=id,role,dni,gender,birth_date,last_name,full_name,deleted_at,es_prueba,federador_estado&role=eq.patient&federador_estado=is.null&limit=10000')).json()
if (filas?.code === '42703') {
  // Todavía sin la migración 196: se cuenta igual, para saber de cuántos se habla.
  console.log(`[${ENTORNO}] la migración 196 todavía no está aplicada — sólo se cuenta.`)
  filas = await (await rest('profiles?select=id,role,dni,gender,birth_date,last_name,full_name,deleted_at,es_prueba&role=eq.patient&limit=10000')).json()
  const c = filas.filter(federable)
  console.log(`  pacientes: ${filas.length} · con identidad completa: ${c.length} (de prueba: ${c.filter(x => x.es_prueba).length})`)
  process.exit(0)
}
if (!Array.isArray(filas)) { console.error('Error leyendo profiles:', filas); process.exit(1) }
const candidatos = filas.filter(federable)
console.log(`[${ENTORNO}] pacientes sin intentar: ${filas.length} · con identidad completa: ${candidatos.length}`)
if (!flag('correr')) { console.log('Sólo conteo. Para correr: --correr'); process.exit(0) }

for (let i = 0; i < candidatos.length; i += 200) {
  const ids = candidatos.slice(i, i + 200).map(c => c.id)
  const r = await rest(`profiles?id=in.(${ids.join(',')})`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ federador_estado: 'pendiente', federador_intentos: 0, federador_proximo_intento: new Date().toISOString() }),
  })
  if (!r.ok) { console.error('No se pudieron marcar:', await r.text()); process.exit(1) }
}

const totales = {}
for (let vuelta = 1; ; vuelta++) {
  const r = await fetch(`${URL}/functions/v1/federador-paciente`, { method: 'POST', headers: H, body: JSON.stringify({ lote: LOTE }) })
  const out = await r.json().catch(() => ({}))
  if (!r.ok) { console.error('La función respondió', r.status, out); process.exit(1) }
  for (const x of out.resultados ?? []) totales[x.estado] = (totales[x.estado] ?? 0) + 1
  console.log(`  lote ${vuelta}: ${out.procesados} procesados`, JSON.stringify(totales))
  if (!out.procesados) break
  await new Promise(r => setTimeout(r, PAUSA))
}
console.log('Listo.', totales)
