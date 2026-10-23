#!/usr/bin/env node
/**
 * Control: `send-email` (entera) y el `preview` / `tipo` de
 * `send-push-notification` sólo responden a la service key; la forma vieja del
 * push no acepta la key anónima ni links de afuera.
 *
 *   node scripts/verificar-send-email-solo-servidor.mjs            # staging (default)
 *   node scripts/verificar-send-email-solo-servidor.mjs produccion # sin datos de pacientes
 *   node scripts/verificar-send-email-solo-servidor.mjs --estatico # sin red: sólo el código
 *
 * Por qué existe (2026-10-23): `send-email` aceptaba cualquier JWT del
 * proyecto —incluida la key anónima, que va en el bundle del front— y con
 * `"preview": true` devolvía el mail armado. Los números de receta son
 * secuenciales: cualquiera podía leer el mail y el PDF de una receta ajena, o el
 * código de cambio de correo / el link de reactivación de otra persona.
 *
 * No manda nada que no sea de prueba:
 *  - Lo que debe pasar es siempre `preview`.
 *  - Lo que mandaría de verdad si la función estuviera abierta (envío de mail,
 *    push sin `preview`) sólo corre en staging.
 *  - En producción se usan ids que no existen: abierta da 404, cerrada 403, y
 *    nunca se carga el mail de un paciente real.
 *
 * Chequea:
 *   1. (código) config.toml no le apaga `verify_jwt` a ninguna de las dos — sin
 *      el gateway el claim `role` se puede inventar — y las dos deciden quién
 *      llama antes de tocar la base.
 *   2. (base) la key con la que llaman los triggers (vault `push_service_key`)
 *      es service_role: si no, todos los mails de la base darían 403 en silencio.
 *   3. (red) un JWT inventado con role=service_role → 401 (el gateway verifica).
 *   4. (red) key anónima → 403; (staging) sesión de un paciente → 403.
 *   5. (red) service key → pasa.
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const soloEstatico = args.includes('--estatico')
const entorno = args.includes('produccion') ? 'produccion' : 'staging'
const enStaging = entorno === 'staging'

let fallas = 0
const ok = (m) => console.log(`  ✅ ${m}`)
const mal = (m) => { fallas++; console.log(`  ❌ ${m}`) }

// ── 1: el código ─────────────────────────────────────────────────────────────
console.log('Código')
const config = readFileSync(join(raiz, 'supabase/config.toml'), 'utf8')
for (const fn of ['send-email', 'send-push-notification']) {
  const bloque = config.match(new RegExp(`\\[functions\\.${fn}\\][^\\[]*`))
  if (bloque && /verify_jwt\s*=\s*false/.test(bloque[0])) mal(`config.toml apaga verify_jwt en ${fn}`)
  else ok(`${fn} conserva verify_jwt = true`)
}
const antesDe = (archivo, gate, despues) => {
  const src = readFileSync(join(raiz, 'supabase/functions', archivo, 'index.ts'), 'utf8')
  const handler = src.slice(src.indexOf('Deno.serve('))
  const i = handler.indexOf(gate)
  const j = handler.indexOf(despues)
  return i > 0 && (j < 0 || i < j)
}
if (antesDe('send-email', 'if (!esServicio(req))', 'await req.json()')) ok('send-email decide quién llama antes de leer el body')
else mal('send-email ya no corta con esServicio(req) antes de leer el body')
if (antesDe('send-push-notification', 'rolDelLlamador(req)', 'createClient(')) ok('send-push-notification decide quién llama antes de tocar la base')
else mal('send-push-notification ya no mira rolDelLlamador(req) antes de tocar la base')

if (soloEstatico) terminar()

// ── credenciales ─────────────────────────────────────────────────────────────
const leer = (p) => {
  try {
    return Object.fromEntries(
      readFileSync(p, 'utf8').split('\n').map(l => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2].replace(/^["']|["']$/g, '')]),
    )
  } catch { return {} }
}
const g = leer(join(homedir(), 'Local', '.env'))
const prod = { ...leer(join(homedir(), 'Local/Healthier/website/.env.test')), ...leer(join(raiz, '.env.test')) }
const cfg = enStaging
  ? { ref: 'itjhrvlzuqvyhqtffumc', url: g.HEALTHIER_STAGING_SUPABASE_URL, anon: g.HEALTHIER_STAGING_SUPABASE_ANON_KEY, service: g.HEALTHIER_STAGING_SUPABASE_SERVICE_ROLE_KEY }
  : { ref: 'aixjejdoofervrkggbkd', url: prod.VITE_SUPABASE_URL, anon: prod.VITE_SUPABASE_ANON_KEY, service: prod.SUPABASE_SERVICE_ROLE_KEY }
if (!cfg.url || !cfg.anon || !cfg.service) {
  console.error(`Faltan credenciales de ${entorno} (~/Local/.env o website/.env.test).`)
  process.exit(1)
}

// ── 2: la key de los triggers ────────────────────────────────────────────────
console.log(`\nBase — ${entorno}`)
if (!g.SUPABASE_ACCESS_TOKEN) mal('falta SUPABASE_ACCESS_TOKEN en ~/Local/.env para leer el vault')
else {
  // Sólo se lee el claim `role`, nunca la key.
  const sql = `select case when decrypted_secret like 'eyJ%' then (convert_from(decode(rpad(translate(split_part(decrypted_secret,'.',2),'-_','+/'), ((length(split_part(decrypted_secret,'.',2))+3)/4)*4, '='),'base64'),'utf8')::json->>'role') end as rol from vault.decrypted_secrets where name = 'push_service_key'`
  const r = await fetch(`https://api.supabase.com/v1/projects/${cfg.ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${g.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  const filas = await r.json().catch(() => null)
  const rol = Array.isArray(filas) ? filas[0]?.rol : null
  if (rol === 'service_role') ok('la key de los triggers (vault push_service_key) es service_role')
  else mal(`la key de los triggers no es service_role (${rol ?? JSON.stringify(filas)?.slice(0, 100)}): los mails de la base darían 403`)
}

// ── 3, 4 y 5: contra las funciones ───────────────────────────────────────────
const llamar = async (fn, token, body) => {
  const r = await fetch(`${cfg.url}/functions/v1/${fn}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, apikey: cfg.anon, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  let j = null
  try { j = await r.json() } catch { /* sin cuerpo */ }
  return { status: r.status, j }
}

// En staging, una receta real (lo que buscaría quien ataca). En producción, ids
// que no existen: no hace falta el mail de nadie para saber si la puerta está cerrada.
const FALSO = '00000000-0000-4000-8000-00000000dead'
let receta = { id: 'NO-EXISTE-0', paciente: FALSO }
if (enStaging) {
  const r = await fetch(
    `${cfg.url}/rest/v1/clinical_medications?select=rcta_prescription_id,patient_id&rcta_prescription_id=not.is.null&order=created_at.desc&limit=1`,
    { headers: { apikey: cfg.service, Authorization: `Bearer ${cfg.service}` } },
  )
  const filas = await r.json().catch(() => null)
  if (!r.ok || !Array.isArray(filas)) { console.error(`No pude leer recetas de staging (${r.status}): ${JSON.stringify(filas)?.slice(0, 160)}`); process.exit(1) }
  if (!filas[0]) { console.error('No hay ninguna receta emitida en staging para probar.'); process.exit(1) }
  receta = { id: filas[0].rcta_prescription_id, paciente: filas[0].patient_id }
}
const previewReceta = { tipo: 'receta', preview: true, prescriptionId: receta.id }
const previewPush = { userId: receta.paciente, tipo: 'receta-emitida', prescriptionId: receta.id, preview: true }

const casosDeServidor = [
  ['send-email', previewReceta, 'preview de una receta ajena'],
  ['send-email', { tipo: 'bienvenida', userId: receta.paciente, preview: true }, 'preview de un mail de cuenta'],
  ['send-push-notification', previewPush, 'preview de un push'],
  // Mandarían de verdad si estuvieran abiertos: sólo en staging.
  ...(enStaging ? [
    ['send-email', { tipo: 'receta', prescriptionId: receta.id }, 'envío del mail de una receta'],
    ['send-push-notification', { ...previewPush, preview: undefined }, 'push del catálogo (`tipo`)'],
  ] : []),
]
const pushLibre = { userId: receta.paciente, title: 'Prueba de control', body: 'No debería llegar', url: '/' }

const debeNegar = async (quien, token, casos, esperado = [401, 403]) => {
  for (const [fn, body, que] of casos) {
    const { status, j } = await llamar(fn, token, body)
    const txt = JSON.stringify(j ?? '')
    const filtra = txt.includes('"preview"') || txt.includes('"sent"')
    if (esperado.includes(status) && !filtra) ok(`${quien} → ${status} en ${fn}: ${que}`)
    else mal(`${quien} → ${status} en ${fn}: ${que} (debería ser ${esperado.join('/')}) ${txt.slice(0, 120)}`)
  }
}

console.log(`\nFunciones — ${entorno}`)

// 3. Un JWT con role=service_role pero firmado por cualquiera: lo tiene que
// parar el gateway. Si da 200/403, alguien le apagó verify_jwt a la función.
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const inventado = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ role: 'service_role', iss: 'supabase', exp: 4102444800 })}.${b64('firma')}`
await debeNegar('JWT inventado', inventado, [
  ['send-email', previewReceta, 'preview con role=service_role sin firmar'],
  ['send-push-notification', previewPush, 'preview de push sin firmar'],
], [401])

// 4. Key anónima y sesión.
await debeNegar('key anónima', cfg.anon, [
  ...casosDeServidor,
  ...(enStaging ? [['send-push-notification', pushLibre, 'push con texto libre']] : []),
])
if (enStaging) {
  const s = await fetch(`${cfg.url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: cfg.anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'paciente.completo@staging.healthier.app', password: 'staging' }),
  }).then(x => x.json())
  if (s.access_token) {
    await debeNegar('sesión de un paciente', s.access_token, [
      ...casosDeServidor,
      ['send-push-notification', { ...pushLibre, url: 'https://ejemplo.com' }, 'push con link de afuera'],
    ])
  } else mal(`no pude abrir la sesión del paciente de staging: ${JSON.stringify(s).slice(0, 120)}`)
}

// 5. La service key pasa. En producción, con un id que no existe: 404 = pasó la puerta.
const srv = await llamar('send-email', cfg.service, previewReceta)
if (enStaging) {
  if (srv.status === 200 && Array.isArray(srv.j?.preview) && srv.j.preview[0]?.subject) ok(`service key → 200 con el preview ("${srv.j.preview[0].subject}")`)
  else mal(`service key → ${srv.status} en el preview de send-email ${JSON.stringify(srv.j).slice(0, 160)}`)
} else if (srv.status === 404) ok('service key → pasa la puerta (404 con una receta que no existe)')
else mal(`service key → ${srv.status} en send-email (esperaba 404 con una receta que no existe) ${JSON.stringify(srv.j).slice(0, 160)}`)

terminar()

function terminar() {
  console.log(fallas ? `\n❌ ${fallas} falla(s)` : '\n✅ Todo en verde')
  process.exit(fallas ? 1 : 0)
}
