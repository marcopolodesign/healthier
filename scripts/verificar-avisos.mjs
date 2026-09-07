#!/usr/bin/env node
/*
 * ¿Los avisos push realmente salen?
 *
 *   node scripts/verificar-avisos.mjs      # contra STAGING
 *
 * 🔴 ESCRIBE: crea una emergencia y una consulta de prueba, las pasea por todos
 * sus estados y las borra. Por eso corre sólo contra staging.
 * No mira el catálogo de triggers: hace las transiciones de verdad y después
 * cuenta las peticiones que `pg_net` dejó registradas. Es la diferencia entre
 * "el trigger existe" y "el aviso salió".
 *
 * Por qué existe: hasta el 2026-09-06 casi todos los avisos al paciente salían
 * de un `functions.invoke` del navegador del website. Se perdían al cerrar la
 * pestaña y NO salían nunca si la acción venía de la app. Un aviso que no llega
 * se ve exactamente igual que uno que sí — no hay error en ningún lado — así
 * que la única forma de saberlo es preguntarle a la base.
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
const leer = (p) => Object.fromEntries(readFileSync(p,'utf8').split('\n').map(l=>l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map(m=>[m[1],m[2]]))
const env = { ...leer(join(homedir(),'Local','.env')), ...leer(join(homedir(),'Local','Healthier','.env')) }
const REF = 'itjhrvlzuqvyhqtffumc'
const URL = env.HEALTHIER_STAGING_SUPABASE_URL
const SR  = env.HEALTHIER_STAGING_SUPABASE_SERVICE_ROLE_KEY

/*
 * Los cambios de fila van por PostgREST con la service key, NO por el SQL de la
 * API de administración: el guard `proteger_payment_status_consultations` deja
 * pasar a `auth.role() = 'service_role'`, y por SQL directo ese rol es NULL.
 */
const rest = async (path, opts = {}) => {
  const r = await fetch(`${URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json',
               Prefer: 'return=representation', ...(opts.headers ?? {}) },
  })
  const t = await r.text()
  let b; try { b = JSON.parse(t) } catch { b = t }
  if (!r.ok) throw new Error(`${path} → ${r.status} ${JSON.stringify(b).slice(0,200)}`)
  return b
}

const sql = async (query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const b = await r.json()
  if (!Array.isArray(b)) throw new Error(JSON.stringify(b).slice(0, 300))
  return b
}

const PAC = 'ede3027e-e586-4e65-8b52-d7c44117a0c1'
const PRO = '85b520a4-dfda-41ea-9b9e-9e999b92f664'

let fallas = 0
const ok = (m) => console.log(`   ✅ ${m}`)
const mal = (m) => { fallas++; console.log(`   ❌ ${m}`) }

/*
 * Contador MONÓTONO de peticiones encoladas por pg_net.
 *
 * Sumar las filas de las dos tablas no sirve: una petición sale de la cola
 * cuando pg_net la toma y entra en `_http_response` cuando vuelve, así que
 * mientras está en vuelo no está en ninguna de las dos y el total BAJA. Con eso
 * el primer intento reportó "en camino → no disparó nada" cuando en realidad sí
 * había disparado. Los ids son la misma secuencia, así que el máximo sólo sube.
 */
const contar = async () => (await sql(`
  select coalesce(greatest(
    coalesce((select max(id) from net.http_request_queue), 0),
    coalesce((select max(id) from net._http_response), 0)
  ), 0)::int as n
`))[0].n

console.log('\n▸ ¿Están los secretos de Vault? (sin ellos enviar_push no manda nada)')
const secretos = await sql(`select name from vault.decrypted_secrets where name in ('push_service_key','functions_base_url')`)
const nombres = secretos.map(s => s.name)
for (const n of ['push_service_key', 'functions_base_url']) {
  nombres.includes(n) ? ok(`\`${n}\` presente`) : mal(`falta \`${n}\` en Vault — ningún aviso sale de la base`)
}

console.log('\n▸ Emergencias — cada transición tiene que disparar una llamada')
const antes = await contar()
const [{ id }] = await rest('emergencies', { method: 'POST', body: JSON.stringify({
  patient_id: PAC, professional_id: PRO, triage_code: 'ROJO', status: 'dispatched',
  dispatch_code: 'UTM-TRIG', patient_latitude: -34.5885, patient_longitude: -58.3974,
})})
const trasInsert = await contar()
trasInsert > antes ? ok(`alta → aviso al profesional (+${trasInsert - antes})`) : mal('alta → NO disparó nada')

await rest(`emergencies?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'in_transit' }) })
const trasCamino = await contar()
trasCamino > trasInsert ? ok(`en camino → aviso al paciente (+${trasCamino - trasInsert})`) : mal('en camino → NO disparó nada')

await rest(`emergencies?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'arrived' }) })
const trasLlego = await contar()
trasLlego > trasCamino ? ok(`llegó → aviso al paciente (+${trasLlego - trasCamino})`) : mal('llegó → NO disparó nada')

await rest(`emergencies?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'cancelled' }) })
const trasCancel = await contar()
// service role ⇒ auth.uid() es NULL ⇒ se avisa a los dos lados
trasCancel - trasLlego >= 2 ? ok(`cancelada → aviso a los dos lados (+${trasCancel - trasLlego})`) : mal(`cancelada → sólo +${trasCancel - trasLlego}`)
await rest(`emergencies?id=eq.${id}`, { method: 'DELETE' })

console.log('\n▸ Consultas — el lado del paciente, que antes salía del navegador')
const c0 = await contar()
const [{ id: cid }] = await rest('consultations', { method: 'POST', body: JSON.stringify({
  patient_id: PAC, professional_id: PRO, status: 'pending', modality: 'video',
  scheduled_at: new Date(Date.now() + 2 * 864e5).toISOString(),
})})
const c1 = await contar()
// auth.uid() NULL ⇒ no se avisa "te agendaron" (no lo agendó el profesional),
// pero sí el aviso al profesional de la 091.
c1 > c0 ? ok(`alta → aviso al profesional (091) (+${c1 - c0})`) : mal('alta → NO disparó nada')

await rest(`consultations?id=eq.${cid}`, { method: 'PATCH', body: JSON.stringify({ status: 'confirmed' }) })
const c2 = await contar()
c2 > c1 ? ok(`confirmada → aviso al paciente (+${c2 - c1})`) : mal('confirmada → NO disparó nada')

await rest(`consultations?id=eq.${cid}`, { method: 'PATCH', body: JSON.stringify({ status: 'in_progress' }) })
const c3 = await contar()
c3 > c2 ? ok(`el profesional entró a la sala → aviso al paciente (+${c3 - c2})`) : mal('in_progress → NO disparó nada')

await rest(`consultations?id=eq.${cid}`, { method: 'PATCH', body: JSON.stringify({ status: 'cancelled' }) })
const c4 = await contar()
c4 - c3 >= 2 ? ok(`cancelada → aviso a los dos lados (+${c4 - c3})`) : mal(`cancelada → sólo +${c4 - c3}`)
await rest(`consultations?id=eq.${cid}`, { method: 'DELETE' })

console.log('\n▸ ¿Llegaron a destino?')
await new Promise(r => setTimeout(r, 4000))
const respuestas = await sql(`
  select status_code, count(*)::int as n
    from net._http_response
   where created > now() - interval '2 minutes'
   group by status_code order by n desc
`)
if (!respuestas.length) console.log('   ·  sin respuestas todavía — pg_net las procesa en segundos')
respuestas.forEach(r => {
  const linea = `${r.n} respuesta(s) con estado ${r.status_code ?? 'sin estado'}`
  if (r.status_code === 200) ok(linea)
  else mal(linea)
})

console.log(fallas ? `\n${fallas} problema(s).\n` : '\nTodos los avisos disparan.\n')
process.exit(fallas ? 1 : 0)
