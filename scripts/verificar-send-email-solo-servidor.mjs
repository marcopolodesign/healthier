#!/usr/bin/env node
/**
 * Control: `send-email` (entera) y el `preview` / `tipo` de
 * `send-push-notification` sólo responden a la service key.
 *
 *   node scripts/verificar-send-email-solo-servidor.mjs            # staging (default)
 *   node scripts/verificar-send-email-solo-servidor.mjs produccion # sólo lectura también
 *   node scripts/verificar-send-email-solo-servidor.mjs --estatico # sin red: sólo el código
 *
 * Por qué existe (2026-10-23): `send-email` aceptaba cualquier JWT del
 * proyecto —incluida la key anónima, que va en el bundle del front— y con
 * `"preview": true` devolvía el mail armado. Los números de receta son
 * secuenciales: cualquiera podía leer el mail y el PDF de una receta ajena, o el
 * código de cambio de correo / el link de reactivación de otra persona.
 *
 * No manda nada: todas las llamadas que deben pasar son `preview`, y las que
 * deben fallar se cortan antes de leer la base. Las dos que mandarían si la
 * función estuviera abierta (envío de mail y push sin `preview`) sólo corren en
 * staging: contra producción el control se puede correr antes del pase sin
 * escribirle a nadie.
 *
 * Chequea:
 *   1. (código) config.toml no le apaga `verify_jwt` a ninguna de las dos — sin
 *      el gateway el claim `role` se puede inventar.
 *   2. (código) send-email llama a `esServicio(req)` antes de leer el body.
 *   3. (red) key anónima → 403 en send-email (preview de receta, envío) y en el
 *      preview/tipo de push.
 *   4. (red, sólo staging) sesión de un paciente → 403.
 *   5. (red) service key → 200 con el preview de una receta real.
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const soloEstatico = args.includes('--estatico')
const entorno = args.includes('produccion') ? 'produccion' : 'staging'

let fallas = 0
const ok = (m) => console.log(`  ✅ ${m}`)
const mal = (m) => { fallas++; console.log(`  ❌ ${m}`) }

// ── 1 y 2: el código ─────────────────────────────────────────────────────────
console.log('Código')
const config = readFileSync(join(raiz, 'supabase/config.toml'), 'utf8')
for (const fn of ['send-email', 'send-push-notification']) {
  const bloque = config.match(new RegExp(`\\[functions\\.${fn}\\][^\\[]*`))
  if (bloque && /verify_jwt\s*=\s*false/.test(bloque[0])) mal(`config.toml apaga verify_jwt en ${fn}`)
  else ok(`${fn} conserva verify_jwt = true`)
}
const fuente = readFileSync(join(raiz, 'supabase/functions/send-email/index.ts'), 'utf8')
const iGate = fuente.indexOf('if (!esServicio(req))')
const iBody = fuente.indexOf('await req.json()')
if (iGate > 0 && iGate < iBody) ok('send-email corta con esServicio(req) antes de leer el body')
else mal('send-email ya no corta con esServicio(req) antes de leer el body')
const push = readFileSync(join(raiz, 'supabase/functions/send-push-notification/index.ts'), 'utf8')
if (/preview[\s\S]{0,80}tipo\)\s*&&\s*!esServicio\(req\)/.test(push)) ok('send-push-notification corta preview/tipo sin service key')
else mal('send-push-notification ya no corta preview/tipo sin service key')

if (soloEstatico) terminar()

// ── 3, 4 y 5: contra el entorno ──────────────────────────────────────────────
const leer = (p) => {
  try {
    return Object.fromEntries(
      readFileSync(p, 'utf8').split('\n').map(l => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2].replace(/^["']|["']$/g, '')]),
    )
  } catch { return {} }
}
const g = leer(join(homedir(), 'Local', '.env'))
const prod = { ...leer(join(homedir(), 'Local/Healthier/website/.env.test')), ...leer(join(raiz, '.env.test')) }
const cfg = entorno === 'staging'
  ? { url: g.HEALTHIER_STAGING_SUPABASE_URL, anon: g.HEALTHIER_STAGING_SUPABASE_ANON_KEY, service: g.HEALTHIER_STAGING_SUPABASE_SERVICE_ROLE_KEY }
  : { url: prod.VITE_SUPABASE_URL, anon: prod.VITE_SUPABASE_ANON_KEY, service: prod.SUPABASE_SERVICE_ROLE_KEY }
if (!cfg.url || !cfg.anon || !cfg.service) {
  console.error(`Faltan credenciales de ${entorno} (~/Local/.env o website/.env.test).`)
  process.exit(1)
}

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

// Una receta real cualquiera (la más nueva) y su paciente: lo que buscaría quien ataca.
const r = await fetch(
  `${cfg.url}/rest/v1/clinical_medications?select=rcta_prescription_id,patient_id&rcta_prescription_id=not.is.null&order=created_at.desc&limit=1`,
  { headers: { apikey: cfg.service, Authorization: `Bearer ${cfg.service}` } },
)
const [med] = await r.json()
if (!med) { console.error(`No hay ninguna receta emitida en ${entorno} para probar.`); process.exit(1) }
const receta = { tipo: 'receta', preview: true, prescriptionId: med.rcta_prescription_id }

// Los dos casos sin `preview` mandarían de verdad si la función estuviera
// abierta: sólo se prueban en staging, nunca contra pacientes reales.
const casos = [
  ['send-email', receta, 'preview de una receta ajena'],
  ['send-email', { tipo: 'bienvenida', userId: med.patient_id, preview: true }, 'preview de un mail de cuenta'],
  ['send-push-notification', { userId: med.patient_id, tipo: 'receta-emitida', prescriptionId: med.rcta_prescription_id, preview: true }, 'preview de un push'],
  ...(entorno === 'staging' ? [
    ['send-email', { tipo: 'receta', prescriptionId: med.rcta_prescription_id }, 'envío del mail de una receta'],
    ['send-push-notification', { userId: med.patient_id, tipo: 'receta-emitida', prescriptionId: med.rcta_prescription_id }, 'push del catálogo (`tipo`)'],
  ] : []),
]

const debeNegar = async (quien, token) => {
  for (const [fn, body, que] of casos) {
    const { status, j } = await llamar(fn, token, body)
    const filtra = JSON.stringify(j ?? '').includes('"preview"') || JSON.stringify(j ?? '').includes('"sent"')
    if ((status === 401 || status === 403) && !filtra) ok(`${quien} → ${status} en ${fn}: ${que}`)
    else mal(`${quien} → ${status} en ${fn}: ${que} (debería ser 401/403) ${JSON.stringify(j).slice(0, 120)}`)
  }
}

console.log(`\nRed — ${entorno}`)
await debeNegar('key anónima', cfg.anon)

if (entorno === 'staging') {
  const s = await fetch(`${cfg.url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: cfg.anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'paciente.completo@staging.healthier.app', password: 'staging' }),
  }).then(x => x.json())
  if (s.access_token) await debeNegar('sesión de un paciente', s.access_token)
  else mal(`no pude abrir la sesión del paciente de staging: ${JSON.stringify(s).slice(0, 120)}`)
}

const srv = await llamar('send-email', cfg.service, receta)
if (srv.status === 200 && Array.isArray(srv.j?.preview) && srv.j.preview[0]?.subject) ok(`service key → 200 con el preview ("${srv.j.preview[0].subject}")`)
else mal(`service key → ${srv.status} en el preview de send-email ${JSON.stringify(srv.j).slice(0, 160)}`)

terminar()

function terminar() {
  console.log(fallas ? `\n❌ ${fallas} falla(s)` : '\n✅ Todo en verde')
  process.exit(fallas ? 1 : 0)
}
