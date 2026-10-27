#!/usr/bin/env node
/**
 * verificar-dominios-login.mjs — que el login con Google vuelva al mismo dominio.
 *
 * Control que dejó el panel de pacientes (2026-10-26): `www.healthier.com.ar`
 * no estaba en la lista de destinos permitidos de Supabase Auth, así que quien
 * entraba con Google desde ahí volvía a `gethealthier.vercel.app` (el site_url).
 * Las UTM de la pauta viven en el localStorage del dominio donde se aterrizó,
 * y en el otro dominio no existen: 14 pacientes de la campaña quedaron "Sin UTM".
 *
 * Falla si a la lista de algún entorno le falta un dominio desde el que se
 * puede entrar. Lee la config por la Management API (`SUPABASE_ACCESS_TOKEN`,
 * del entorno o de ~/Local/.env).
 *
 * Uso: node scripts/verificar-dominios-login.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const ENTORNOS = {
  produccion: { ref: 'aixjejdoofervrkggbkd', dominios: ['https://www.healthier.com.ar', 'https://healthier.com.ar', 'https://gethealthier.vercel.app'] },
  staging: { ref: 'itjhrvlzuqvyhqtffumc', dominios: ['https://staging.healthier.com.ar', 'https://gethealthier-staging.vercel.app'] },
}

function token() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN
  const env = join(homedir(), 'Local', '.env')
  if (!existsSync(env)) return null
  const linea = readFileSync(env, 'utf8').split('\n').find(l => l.startsWith('SUPABASE_ACCESS_TOKEN='))
  return linea?.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '') || null
}

const tk = token()
if (!tk) { console.error('Falta SUPABASE_ACCESS_TOKEN'); process.exit(2) }

let fallas = 0
for (const [nombre, { ref, dominios }] of Object.entries(ENTORNOS)) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, { headers: { Authorization: `Bearer ${tk}` } })
  if (!res.ok) { console.error(`✗ ${nombre}: no pude leer la config (${res.status})`); fallas++; continue }
  const cfg = await res.json()
  // Hace falta el comodín: el login vuelve a `${origin}/login`, y una entrada
  // sin `/**` no cubre esa ruta (Supabase compara como glob).
  const permitidos = (cfg.uri_allow_list || '').split(',').map(p => p.trim()).filter(Boolean)
  for (const d of dominios) {
    const ok = d === cfg.site_url?.replace(/\/$/, '') || permitidos.includes(`${d}/**`)
    console.log(`${ok ? '✓' : '✗'} ${nombre}: ${d}`)
    if (!ok) fallas++
  }
}
if (fallas) { console.error(`\n${fallas} dominio(s) sin habilitar: el login con Google los manda a otro dominio y se pierden las UTM.`); process.exit(1) }
console.log('\nTodos los dominios vuelven a sí mismos después del login.')
