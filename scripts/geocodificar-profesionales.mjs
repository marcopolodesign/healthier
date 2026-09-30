#!/usr/bin/env node
/**
 * Completa `latitude`/`longitude` de los profesionales que tienen dirección
 * cargada y no tienen coordenadas (2026-09-30).
 *
 * Por qué: el mapa del inicio del paciente dibuja a cada profesional en su
 * dirección (virtuales incluidos, decisión de Mateo), y sin coordenadas no
 * aparece. Muchas direcciones se cargaron tipeadas sin elegir una sugerencia
 * —el autocompletado deja lat/lng en null— o las cargó el super admin, que no
 * geocodificaba.
 *
 * Sólo toca `latitude`/`longitude`, sólo de filas que las tienen en null, y
 * sólo a partir de la dirección de esa misma fila. Geocodifica con Nominatim,
 * el mismo servicio que usa la web (`src/lib/geo.js`), a 1 pedido por segundo
 * como pide su política de uso.
 *
 * Uso:
 *   node scripts/geocodificar-profesionales.mjs staging            # en seco
 *   node scripts/geocodificar-profesionales.mjs staging --aplicar
 *   node scripts/geocodificar-profesionales.mjs produccion --aplicar
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { variantesDeDireccion } from '../src/lib/geo.js'

const env = Object.fromEntries(
  readFileSync(join(homedir(), 'Local', '.env'), 'utf8')
    .split('\n').map(l => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2]])
)

const ENTORNOS = {
  produccion: 'aixjejdoofervrkggbkd',
  staging:    'itjhrvlzuqvyhqtffumc',
}

const entorno = process.argv[2]
const aplicar = process.argv.includes('--aplicar')
const ref = ENTORNOS[entorno]
if (!ref) {
  console.error('Uso: node scripts/geocodificar-profesionales.mjs <staging|produccion> [--aplicar]')
  process.exit(1)
}

async function consultar(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const cuerpo = await r.json()
  if (!Array.isArray(cuerpo)) throw new Error(JSON.stringify(cuerpo).slice(0, 300))
  return cuerpo
}

const literal = s => `'${String(s).replace(/'/g, "''")}'`
const esperar = ms => new Promise(r => setTimeout(r, ms))

async function nominatim(q) {
  const params = new URLSearchParams({ q, format: 'json', countrycodes: 'ar', limit: '1' })
  const r = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: { 'User-Agent': 'Healthier-MVP/1.0 (mateoaldao@gmail.com)', 'Accept-Language': 'es' },
  })
  if (!r.ok) return null
  const [primero] = await r.json()
  return primero ? { lat: Number(primero.lat), lng: Number(primero.lon) } : null
}

// Las mismas variantes que prueba la web al guardar (`src/lib/geo.js`).
async function geocodificar(direccion) {
  for (const q of variantesDeDireccion(direccion)) {
    const geo = await nominatim(q)
    await esperar(1100)
    if (geo && Number.isFinite(geo.lat) && Number.isFinite(geo.lng)) return geo
  }
  return null
}

const filas = await consultar(`
  select pp.id, p.email, pp.address, pp.is_verified, pp.is_active
    from professional_profiles pp
    join profiles p on p.id = pp.user_id
   where coalesce(trim(pp.address), '') <> ''
     and (pp.latitude is null or pp.longitude is null)
   order by pp.is_verified desc, p.email
`)

console.log(`\n${entorno.toUpperCase()} — ${filas.length} con dirección y sin coordenadas${aplicar ? '' : ' (en seco)'}\n`)

const resueltos = []
const sinResolver = []
for (const f of filas) {
  const geo = await geocodificar(f.address)
  if (!geo) {
    sinResolver.push(f)
    console.log(`  ✗ ${f.email} — "${f.address}"`)
    continue
  }
  resueltos.push(f)
  console.log(`  ✓ ${f.email} — "${f.address}" → ${geo.lat.toFixed(5)}, ${geo.lng.toFixed(5)}`)
  if (aplicar) {
    await consultar(`
      update professional_profiles
         set latitude = ${geo.lat.toFixed(6)}, longitude = ${geo.lng.toFixed(6)}
       where id = ${literal(f.id)}
         and (latitude is null or longitude is null)
         and address = ${literal(f.address)}
    `)
  }
}

const [resumen] = await consultar(`
  select count(*) filter (where is_verified and is_active)                                         as verificados,
         count(*) filter (where is_verified and is_active and coalesce(trim(address), '') <> '')   as con_direccion,
         count(*) filter (where is_verified and is_active and latitude is not null)                as con_coordenadas,
         count(*) filter (where is_verified and is_active and mp_connected and latitude is not null) as cobrables_en_mapa
    from professional_profiles
`)

console.log(`\n  ${resueltos.length} ${aplicar ? 'geocodificados' : 'se podrían geocodificar'} · ${sinResolver.length} sin resolver`)
console.log(`  Verificados y activos: ${resumen.verificados} · con dirección ${resumen.con_direccion} · con coordenadas ${resumen.con_coordenadas} · cobrables con coordenadas ${resumen.cobrables_en_mapa}\n`)
