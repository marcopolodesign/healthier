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
 * Sólo lee: no toca ninguna base, ni ninguna función, ni Mercado Pago.
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const env = Object.fromEntries(
  readFileSync(join(homedir(), 'Local', '.env'), 'utf8')
    .split('\n').map(l => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2]])
)

const ENTORNOS = {
  produccion: { ref: 'aixjejdoofervrkggbkd', url: 'https://aixjejdoofervrkggbkd.supabase.co' },
  staging:    { ref: 'itjhrvlzuqvyhqtffumc', url: 'https://itjhrvlzuqvyhqtffumc.supabase.co' },
}

// Las tres que tienen que ser PÚBLICAS (verify_jwt=false): a ninguna le puede
// llegar un JWT de Supabase. Validan por su cuenta — HMAC en el `state` del
// OAuth, firma del webhook.
const PUBLICAS = ['mp-connect', 'mp-webhook', 'pharmacy-mp-connect', 'mp-refresh-tokens']

let fallas = 0
const ok   = (m) => console.log(`   ✅ ${m}`)
const mal  = (m) => { fallas++; console.log(`   ❌ ${m}`) }
const nota = (m) => console.log(`   ·  ${m}`)

async function revisar(nombre, { ref, url }) {
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

  // ── 2) El profesional puede arrancar el vínculo ───────────────────────────
  console.log('\n▸ Vínculo de Mercado Pago (lo que hace el browser del profesional)')
  const authRes = await fetch(
    `${url}/functions/v1/mp-connect?action=authorize&professionalId=00000000-0000-0000-0000-000000000001`,
    { redirect: 'manual' },
  )
  const destino = authRes.headers.get('location') ?? ''
  if (authRes.status === 401) {
    mal(`401 del gateway — ES EL BUG DEL 2026-08-07. El profesional ve "Missing authorization header".`)
  } else if (destino.includes('auth.mercadopago.com')) {
    ok('redirige a Mercado Pago')
    const cid = new URL(destino).searchParams.get('client_id')
    if (!cid || cid === 'undefined') mal(`client_id=${cid} — falta MP_CLIENT_ID_* en los secrets de este entorno`)
    else ok(`client_id presente (${cid})`)
    if (!new URL(destino).searchParams.get('state')?.includes('.')) mal('el state no viene firmado (HMAC)')
    else ok('el state viaja firmado')
  } else {
    mal(`no redirige a Mercado Pago (HTTP ${authRes.status})`)
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
