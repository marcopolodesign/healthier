#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// ¿Lo que corre en la base es lo que dicen los archivos de migración? Compara,
// función por función, el cuerpo de `pg_get_functiondef` contra el ÚLTIMO
// archivo de supabase/migrations que la define (revisión pre-prod de
// verticales, 2026-10-17: hubo migraciones editadas después de aplicarse).
//
//   node scripts/comparar-funciones-verticales.mjs staging
//   node scripts/comparar-funciones-verticales.mjs produccion
//
// Sólo lee. Exit 1 si alguna difiere o falta.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const FUNCIONES = ['crear_vertical', 'mover_vertical', 'validar_consulta_derivada', 'profesional_puede_recetar']
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const env = {}
for (const l of readFileSync(path.join(homedir(), 'Local/.env'), 'utf8').split('\n')) {
  const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l)
  if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
}
const entorno = process.argv[2]
const REF = entorno === 'staging' ? env.HEALTHIER_STAGING_SUPABASE_REF : entorno === 'produccion' ? 'aixjejdoofervrkggbkd' : null
if (!REF) { console.error('uso: comparar-funciones-verticales.mjs <staging|produccion>'); process.exit(1) }

const cuerpo = sql => {
  const m = /AS\s+(\$[a-z_]*\$)([\s\S]*?)\1/i.exec(sql)
  return m ? m[2].replace(/\s+/g, ' ').trim() : null
}

const dir = path.join(raiz, 'supabase/migrations')
const archivos = readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
let fallas = 0
for (const fn of FUNCIONES) {
  let enArchivo = null, cual = null
  for (const f of archivos) {
    const txt = readFileSync(path.join(dir, f), 'utf8')
    const defs = txt.match(new RegExp(`create or replace function public\\.${fn}\\b[\\s\\S]*?(\\$[a-z_]*\\$)[\\s\\S]*?\\1`, 'gi'))
    if (defs?.length) { enArchivo = defs[defs.length - 1]; cual = f }
  }
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: `select pg_get_functiondef('public.${fn}'::regproc) as def` }),
  })
  const filas = await r.json().catch(() => null)
  const enBase = Array.isArray(filas) ? filas[0]?.def : null
  const igual = enArchivo && enBase && cuerpo(enArchivo) === cuerpo(enBase)
  console.log(`${igual ? '🟢' : '🔴'} ${fn} — ${cual ?? 'sin archivo'}${enBase ? '' : ' (no está en la base)'}`)
  if (!igual) fallas++
}
process.exit(fallas ? 1 : 0)
