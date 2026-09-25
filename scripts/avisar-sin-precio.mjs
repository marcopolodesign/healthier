#!/usr/bin/env node
/**
 * Lista a los profesionales verificados y activos sin ningún precio cargado,
 * y — SÓLO con `--enviar` — les manda el mail "precio-pendiente" (migración
 * 176, plantilla `profesionalSinPrecio` en
 * `supabase/functions/_shared/email/templates.ts`) a través de `send-email`.
 *
 *   node scripts/avisar-sin-precio.mjs                     # dry-run, producción
 *   node scripts/avisar-sin-precio.mjs staging              # dry-run, staging
 *   node scripts/avisar-sin-precio.mjs --enviar              # MANDA de verdad, producción
 *   node scripts/avisar-sin-precio.mjs staging --enviar      # MANDA de verdad, staging
 *
 * Sin `--enviar` sólo lista — no manda nada. Es a propósito: a quién avisarle
 * y cuándo lo decide Mateo, no este script solo. El trigger de la migración
 * 176 ya manda este mismo mail automáticamente la PRÓXIMA VEZ que alguien se
 * verifique sin precio; este script es para los que YA están así hoy.
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const leer = (p) => {
  try {
    return Object.fromEntries(
      readFileSync(p, 'utf8').split('\n').map(l => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2]])
    )
  } catch {
    return {}
  }
}

const global_ = leer(join(homedir(), 'Local', '.env'))
// Las credenciales de producción viven en website/.env.test — es el mismo
// archivo que `verificar-produccion.mjs`/`playwright.config.js` usan para
// apuntar a producción (ver CLAUDE.md del proyecto).
const prodEnv = leer(join(process.cwd(), '.env.test'))

const args = process.argv.slice(2)
const enviar = args.includes('--enviar')
const entorno = args.includes('staging') ? 'staging' : 'produccion'

const ENTORNOS = {
  produccion: {
    ref: 'aixjejdoofervrkggbkd',
    url: prodEnv.VITE_SUPABASE_URL,
    serviceKey: prodEnv.SUPABASE_SERVICE_ROLE_KEY,
  },
  staging: {
    ref: 'itjhrvlzuqvyhqtffumc',
    url: global_.HEALTHIER_STAGING_SUPABASE_URL,
    serviceKey: global_.HEALTHIER_STAGING_SUPABASE_SERVICE_ROLE_KEY,
  },
}

const cfg = ENTORNOS[entorno]
if (!cfg.url || !cfg.serviceKey) {
  console.error(
    `Faltan credenciales para ${entorno}. Revisá ${entorno === 'produccion' ? 'website/.env.test (correlo desde website/)' : '~/Local/.env'}.`
  )
  process.exit(1)
}
if (!global_.SUPABASE_ACCESS_TOKEN) {
  console.error('Falta SUPABASE_ACCESS_TOKEN en ~/Local/.env — hace falta para leer el listado.')
  process.exit(1)
}

// Mismo piso que website/src/lib/tarifas.js y las migraciones 142/176.
const MINIMO = 15000
const SQL_VERIFICADOS_SIN_PRECIO = `
  select pp.user_id, p.full_name, p.email, pp.specialty,
         pp.price_video, pp.price_presencial, pp.session_price
    from professional_profiles pp
    join profiles p on p.id = pp.user_id
   where pp.is_verified
     and pp.is_active
     and not (
       (pp.price_video      is not null and pp.price_video      >= ${MINIMO})
       or (pp.price_presencial is not null and pp.price_presencial >= ${MINIMO})
       or (pp.session_price    is not null and pp.session_price    >= ${MINIMO})
     )
   order by p.email
`

async function consultar(ref, query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${global_.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const cuerpo = await r.json()
  if (!Array.isArray(cuerpo)) throw new Error(JSON.stringify(cuerpo).slice(0, 200))
  return cuerpo
}

const filas = await consultar(cfg.ref, SQL_VERIFICADOS_SIN_PRECIO)

console.log(`\n═══ ${entorno.toUpperCase()} — verificados sin precio ═══\n`)
if (!filas.length) {
  console.log('Ninguno. Nada para avisar.')
  process.exit(0)
}
for (const f of filas) {
  console.log(`· ${f.full_name ?? '—'} <${f.email}> (${f.specialty}) — video ${f.price_video ?? '—'} · presencial ${f.price_presencial ?? '—'} · sesión ${f.session_price ?? '—'}`)
}

if (!enviar) {
  console.log(`\n${filas.length} profesional(es). Dry-run — no se mandó nada.`)
  console.log('Agregá --enviar para mandar el mail "precio-pendiente" de verdad.')
  process.exit(0)
}

console.log(`\nMandando el mail "precio-pendiente" a ${filas.length} profesional(es) en ${entorno}...`)
let enviados = 0
for (const f of filas) {
  try {
    const r = await fetch(`${cfg.url}/functions/v1/send-email`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.serviceKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo: 'precio-pendiente', userId: f.user_id }),
    })
    const cuerpo = await r.json().catch(() => ({}))
    if (!r.ok || cuerpo.error) throw new Error(cuerpo.error ?? `HTTP ${r.status}`)
    console.log(`  ✅ ${f.email} — ${JSON.stringify(cuerpo)}`)
    enviados++
  } catch (e) {
    console.log(`  ❌ ${f.email} — ${e.message}`)
  }
}
console.log(`\n${enviados}/${filas.length} mails mandados.`)
