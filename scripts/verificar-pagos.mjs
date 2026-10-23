#!/usr/bin/env node
/**
 * Chequeo del circuito de pagos — PRIORIDAD MÁXIMA de Healthier.
 *
 *   node scripts/verificar-pagos.mjs            # producción + staging
 *   node scripts/verificar-pagos.mjs produccion # sólo producción
 *   node scripts/verificar-pagos.mjs staging    # sólo staging
 *
 * **Correrlo ante CUALQUIER cambio que roce Edge Functions, variables de
 * entorno, dominios o deploys — incluidos los refactors "sin cambio de
 * comportamiento".** Ver la regla en el `CLAUDE.md` del monorepo.
 *
 * **Por qué existe.** El 2026-08-07 un refactor correcto de `mp-connect` se
 * redeployó sin `config.toml`, y el CLI puso `verify_jwt = true` por default.
 * Con eso el gateway de Supabase empezó a rechazar, ANTES de ejecutar la
 * función, tanto el OAuth del profesional (que llega por una navegación normal
 * del browser) como los webhooks de Mercado Pago (que los mandan sus
 * servidores). No falló ningún build, no apareció nada en los logs, y la UI
 * seguía mostrando el botón "Conectar" como si nada: **estuvo 18 días roto y se
 * descubrió porque una profesional lo reportó por WhatsApp.** Este script tarda
 * segundos y lo habría cazado el mismo día.
 *
 * Sólo lee: no toca ninguna base, ni ninguna función, ni Mercado Pago. Abre
 * una sesión con las cuentas de prueba documentadas para probar el vínculo de
 * MP como lo hace el front (el `authorize` exige sesión desde el 2026-10-23).
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const env = Object.fromEntries(
  readFileSync(join(homedir(), 'Local', '.env'), 'utf8')
    .split('\n').map(l => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2]])
)

const ENTORNOS = {
  produccion: { ref: 'aixjejdoofervrkggbkd', url: 'https://aixjejdoofervrkggbkd.supabase.co', web: 'https://www.healthier.com.ar', clave: 'APP_USR-' },
  staging:    { ref: 'itjhrvlzuqvyhqtffumc', url: 'https://itjhrvlzuqvyhqtffumc.supabase.co', web: 'https://gethealthier-staging.vercel.app', clave: 'TEST-' },
}

// Las tres que tienen que ser PÚBLICAS (verify_jwt=false): a ninguna le puede
// llegar un JWT de Supabase. Validan por su cuenta — HMAC en el `state` del
// OAuth, firma del webhook.
// `reactivar-cuenta` (188) no es de pagos, pero también es pública a propósito:
// la llama alguien sin sesión desde el registro y valida con su propio token.
const PUBLICAS = ['mp-connect', 'mp-webhook', 'pharmacy-mp-connect', 'mp-refresh-tokens', 'reactivar-cuenta']

// Cuentas de prueba documentadas en docs/testing.md (no rotarlas). Abrir una
// sesión con ellas no escribe datos de negocio.
const CUENTAS = {
  produccion: {
    profesional: { email: 'profesional@healthier.app', password: 'profesional' },
    farmacia: { email: env.HEALTHIER_FARMACIA_PANEL_EMAIL, password: env.HEALTHIER_FARMACIA_PANEL_PASSWORD },
  },
  staging: {
    profesional: { email: 'clinica@staging.healthier.app', password: 'staging' },
    farmacia: { email: 'farmacia@staging.healthier.app', password: 'staging' },
  },
}
const FARMACIA_ID = '10000000-0000-0000-0000-000000000001' // único tenant (migración 103)

async function anonKey(ref) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys`, {
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}` },
  })
  const keys = await r.json().catch(() => [])
  return Array.isArray(keys) ? keys.find(k => k.name === 'anon')?.api_key : undefined
}

async function login(url, anon, { email, password }) {
  if (!anon) return null
  const r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const j = await r.json().catch(() => ({}))
  return j.access_token ? j : null
}

let fallas = 0
const ok   = (m) => console.log(`   ✅ ${m}`)
const mal  = (m) => { fallas++; console.log(`   ❌ ${m}`) }
const nota = (m) => console.log(`   ·  ${m}`)

async function revisar(nombre, { ref, url, web, clave }) {
  console.log(`\n═══ ${nombre.toUpperCase()} ═══`)

  // ── 1) Los flags del gateway ──────────────────────────────────────────────
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/functions`, {
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}` },
  })
  const fns = await r.json()
  if (!Array.isArray(fns)) return mal(`no se pudo leer las functions: ${JSON.stringify(fns).slice(0, 120)}`)

  console.log(`\n▸ Flags del gateway (${fns.length} functions)`)
  for (const f of fns) {
    const deberiaSerPublica = PUBLICAS.includes(f.slug)
    const esPublica = f.verify_jwt === false
    if (deberiaSerPublica && !esPublica) {
      mal(`${f.slug}: verify_jwt=true — el gateway va a rechazar a Mercado Pago con 401 ANTES de ejecutarla`)
    } else if (!deberiaSerPublica && esPublica) {
      mal(`${f.slug}: verify_jwt=false y no debería ser pública — cualquiera puede invocarla`)
    }
  }
  if (!fallas) ok('cada function tiene el flag que le corresponde')

  // ── 2) El vínculo de Mercado Pago ─────────────────────────────────────────
  // Desde el 2026-10-23 el paso `authorize` exige la sesión: antes aceptaba
  // `?professionalId=<cualquiera>` sin JWT y firmaba el state con ese id, así
  // que cualquiera podía vincular SU cuenta de MP al perfil de otro y quedarse
  // con los cobros. Se chequean las dos caras: sin sesión NO hay OAuth, y con
  // sesión el profesional / la farmacia SÍ llegan a Mercado Pago, con el state
  // armado con quien está logueado (nunca con el id que venga en el pedido).
  console.log('\n▸ Vínculo de Mercado Pago')
  const ID_AJENO = '00000000-0000-0000-0000-000000000001'
  for (const [fn, query] of [['mp-connect', `professionalId=${ID_AJENO}`], ['pharmacy-mp-connect', `pharmacyId=${ID_AJENO}`]]) {
    for (const [como, headers] of [['fetch', {}], ['navegación', { Accept: 'text/html', 'Sec-Fetch-Mode': 'navigate' }]]) {
      const r = await fetch(`${url}/functions/v1/${fn}?action=authorize&${query}`, { redirect: 'manual', headers })
      const loc = r.headers.get('location') ?? ''
      // El 401 de la FUNCIÓN es `{ error: "Unauthorized…" }`; el del gateway (verify_jwt
      // prendido) trae `sb-error-code` y/o `{ code, message }`. No confundirlos.
      const cuerpo401 = r.status === 401 ? await r.json().catch(() => ({})) : {}
      const esDeLaFuncion = typeof cuerpo401.error === 'string' && /unauthorized/i.test(cuerpo401.error)
      if (r.headers.get('sb-error-code') || (r.status === 401 && !esDeLaFuncion)) {
        mal(`${fn}: 401 del gateway — ES EL BUG DEL 2026-08-07 (verify_jwt prendido). Nadie puede vincular.`)
      } else if (loc.includes('mercadopago.com')) {
        mal(`${fn} (${como}, sin sesión): arranca el OAuth — HUECO: cualquiera puede vincular su Mercado Pago a otro perfil`)
      } else if (como === 'fetch' && r.status === 401) {
        ok(`${fn} sin sesión → 401`)
      } else if (como === 'navegación' && r.status === 302) {
        ok(`${fn} link viejo sin sesión → vuelve a la app (${new URL(loc).pathname}${new URL(loc).search})`)
      } else {
        mal(`${fn} (${como}, sin sesión): HTTP ${r.status} — se esperaba ${como === 'fetch' ? '401' : '302 a la app'}`)
      }
    }
  }

  const anon = await anonKey(ref)
  const cuentas = CUENTAS[nombre] ?? {}
  for (const [fn, cuenta, esperado] of [
    ['mp-connect', cuentas.profesional, (sesion) => sesion.user.id],
    ['pharmacy-mp-connect', cuentas.farmacia, () => FARMACIA_ID],
  ]) {
    if (!cuenta?.email || !cuenta?.password) { nota(`${fn}: sin cuenta de prueba en este entorno — no pruebo el caso con sesión`); continue }
    const sesion = await login(url, anon, cuenta)
    if (!sesion) { mal(`${fn}: no pude iniciar sesión como ${cuenta.email}`); continue }
    const r = await fetch(`${url}/functions/v1/${fn}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sesion.access_token}` },
      // un id ajeno a propósito: el servidor tiene que ignorarlo
      body: JSON.stringify({ action: 'authorize', professionalId: ID_AJENO, pharmacyId: ID_AJENO }),
    })
    const cuerpo = await r.json().catch(() => ({}))
    const destino = cuerpo?.data?.url ?? ''
    if (!r.ok || !destino.includes('auth.mercadopago.com')) { mal(`${fn} con sesión (${cuenta.email}): HTTP ${r.status} ${JSON.stringify(cuerpo).slice(0, 120)}`); continue }
    const params = new URL(destino).searchParams
    const cid = params.get('client_id')
    if (!cid || cid === 'undefined') mal(`${fn}: client_id=${cid} — falta MP_CLIENT_ID_* en los secrets de este entorno`)
    const [v, idDelState, exp] = (params.get('state') ?? '').split('.')
    const vence = Number(exp) * 1000 - Date.now()
    if (v !== 'v2') mal(`${fn}: el state no viene en el formato firmado con vencimiento (v2)`)
    else if (idDelState !== esperado(sesion)) mal(`${fn}: el state lleva ${idDelState} en vez de ${esperado(sesion)} — se firmó con el id del pedido`)
    else if (!(vence > 0 && vence <= 61 * 60_000)) mal(`${fn}: el state vence en ${Math.round(vence / 60_000)} min — tiene que ser corto (≤ 1 h)`)
    else ok(`${fn} con sesión → Mercado Pago (client_id ${cid}), state de quien está logueado, vence en ${Math.round(vence / 60_000)} min`)
  }

  // ── 3) El webhook de Mercado Pago entra ───────────────────────────────────
  console.log('\n▸ Webhook de Mercado Pago (lo que mandan sus servidores)')
  const wh = await fetch(`${url}/functions/v1/mp-webhook`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'payment', data: { id: '0' } }),
  })
  const cuerpo = await wh.text()
  if (wh.headers.get('sb-error-code') === 'UNAUTHORIZED_NO_AUTH_HEADER') {
    mal('el gateway rechaza el webhook — los avisos de pago de MP se pierden en silencio')
  } else if (/signature|firma/i.test(cuerpo)) {
    ok('llega a la función, que valida la firma (correcto)')
  } else {
    nota(`responde ${wh.status}: ${cuerpo.slice(0, 80)}`)
  }

  // ── 4) La web tokeniza con la clave de SU entorno ─────────────────────────
  // El 2026-10-08 la web de staging tenía VITE_MP_IS_PROD=true y la public key
  // de producción: cada pago de prueba fallaba con "Card Token not found" (el
  // token de producción no existe para el sandbox) y nada avisaba.
  console.log('\n▸ Public key de Mercado Pago en la web')
  try {
    const html = await (await fetch(`${web}/?v=${Date.now()}`)).text()
    const js = html.match(/assets\/index-[^"']+\.js/)?.[0]
    const bundle = js ? await (await fetch(`${web}/${js}`)).text() : ''
    const claves = [...new Set(bundle.match(/(TEST|APP_USR)-[0-9a-f]{8}-[0-9a-f-]{20,}/g) ?? [])]
    if (!claves.length) mal('no encontré ninguna public key de Mercado Pago en el bundle')
    else if (claves.every(c => c.startsWith(clave))) ok(`usa ${clave}… (${claves.length} clave)`)
    else mal(`la web usa ${claves.map(c => c.slice(0, 16)).join(', ')} — en ${nombre} tiene que ser ${clave}…`)
  } catch (e) {
    mal(`no pude leer la web (${e.message})`)
  }
}

const pedido = process.argv[2]
for (const [nombre, cfg] of Object.entries(ENTORNOS)) {
  if (pedido && pedido !== nombre) continue
  await revisar(nombre, cfg)
}

console.log(fallas === 0
  ? '\n✅ El circuito de pagos está sano.\n'
  : `\n❌ ${fallas} problema(s) en el circuito de pagos. NO cerrar la tarea sin resolverlos.\n`)
process.exit(fallas === 0 ? 0 : 1)
