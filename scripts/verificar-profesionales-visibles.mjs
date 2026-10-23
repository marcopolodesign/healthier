#!/usr/bin/env node
/**
 * Control: todo profesional verificado tiene que poder reservarse.
 *
 *   node scripts/verificar-profesionales-visibles.mjs [staging|produccion]
 *
 * Sólo lectura. Falla (exit 1) si:
 *  - `sisa-verify` deja de poner `is_active: true` al verificar (chequeo del código), o
 *  - en la base hay un profesional verificado, no dado de baja, con `is_active = false`.
 *
 * Por qué existe: desde el 8/10 la verificación automática por REFEPS marcaba
 * `is_verified` sin `is_active`, y verificado-pero-inactivo es invisible para el
 * paciente (búsqueda, mapa, reserva). 13 profesionales quedaron sin poder
 * recibir turnos hasta el 23/10 y nada avisó.
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const aca = dirname(fileURLToPath(import.meta.url))
const leerEnv = p => Object.fromEntries(
  readFileSync(p, 'utf8').split('\n').map(l => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean)
    .map(m => [m[1], m[2].replace(/^["']|["']$/g, '')]))

const ambiente = process.argv[2] || 'staging'
let url, key
if (ambiente === 'produccion') {
  const e = leerEnv(join(aca, '..', '.env'))
  url = e.VITE_SUPABASE_URL; key = e.SUPABASE_SERVICE_ROLE_KEY
} else {
  const e = leerEnv(join(homedir(), 'Local', '.env'))
  url = e.HEALTHIER_STAGING_SUPABASE_URL; key = e.HEALTHIER_STAGING_SUPABASE_SERVICE_ROLE_KEY
}

let falla = false

const fuente = readFileSync(join(aca, '..', 'supabase', 'functions', 'sisa-verify', 'index.ts'), 'utf8')
if (!/is_active:\s*true/.test(fuente)) {
  console.error('✗ sisa-verify ya no pone is_active: true al verificar')
  falla = true
} else console.log('✓ sisa-verify activa al profesional al verificarlo')

const res = await fetch(`${url}/rest/v1/professional_profiles?select=id,verification_source,profiles!user_id(full_name)&is_verified=eq.true&is_active=eq.false&dado_de_baja=eq.false`,
  { headers: { apikey: key, Authorization: `Bearer ${key}` } })
const filas = await res.json()
if (!res.ok) { console.error('✗ no se pudo leer la base:', filas); process.exit(1) }
if (filas.length) {
  console.error(`✗ ${filas.length} verificados e inactivos en ${ambiente} (invisibles para los pacientes):`)
  for (const f of filas) console.error(`   ${f.profiles?.full_name} (${f.verification_source})`)
  falla = true
} else console.log(`✓ ${ambiente}: ningún verificado inactivo`)

process.exit(falla ? 1 : 0)
