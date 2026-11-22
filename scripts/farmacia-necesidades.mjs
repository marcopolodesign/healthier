#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Farmacia del paciente: reparto de `pharmacy_products.necesidad` (migración
// 246) + fotos del mosaico en el bucket `pharmacy-products/categorias/`.
//
//   node scripts/farmacia-necesidades.mjs staging
//   node scripts/farmacia-necesidades.mjs produccion
//   node scripts/farmacia-necesidades.mjs produccion --verificar   (no escribe)
//
// 🔴 PASO DEL PASE A PRODUCCIÓN, después de la migración 246 y ANTES de
// publicar el front: sin esto el mosaico de prod queda sin fotos y sin
// necesidades (sólo se verían las categorías).
//
// Criterio (Mateo, 2026-11-22): necesidad SÓLO si es obvia por el nombre o la
// droga. La droga de cada marca se sacó del vademécum del servicio de recetas
// (homologación, 2026-11-22) — anotada al lado de cada marca. Lo dudoso queda
// afuera a propósito: estatinas (colesterol), salbutamol, Procto-Metadyne,
// gotas oftálmicas, anticonceptivos, oncológicos, urológicos, ansiolíticos…
// siguen sólo en su categoría.
//
// Idempotente: sólo completa productos SIN necesidad, así no pisa lo que la
// farmacia haya editado desde su panel. `--forzar` reescribe igual.
//
// Control (lo arreglado no vuelve): `--verificar` falla (exit 1) si una foto
// no responde 200, si una necesidad quedó sin productos, o si un producto que
// la regla asigna quedó sin necesidad.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

// Prefijo del nombre (en minúsculas) → necesidad. Comentario = droga.
export const REGLAS = {
  dolor: [
    'diastone',            // diclofenac (+pridinol / +B12)
    'sindol',              // ibuprofeno (Sindol, Sindolito)
    'kemanat',             // ketorolac
    'mell ',               // meloxicam
    'cracox',              // etoricoxib
    'solacil',             // ergotamina + cafeína (migraña)
    'ibuprofeno', 'paracetamol', // genéricos del catálogo demo de staging
  ],
  resfrio: [
    'coris grip',          // paracetamol + pseudoefedrina
    'alergiano',           // loratadina
    'teralmina',           // desloratadina
    'rhinal',              // nafazolina (gotas nasales)
    'funciobron',          // bromhexina / hedera helix (jarabes)
    'loratadina', 'suero fisiológico nasal',
  ],
  piel: [
    'perlivit',            // línea dermocosmética: protector, micelar, sérum, cápsulas
    'medifungol',          // clotrimazol / terbinafina crema
    'dioxis',              // aciclovir crema
    'triplex',             // betametasona + gentamicina + miconazol crema
    'mosqut',              // repelente
    'protector solar',
  ],
  presion: [
    'atenolol',
    'sulocten',            // enalapril (+HCTZ)
    'enromic',             // losartán (+HCTZ)
    'entarsol',            // carvedilol
    'semanar',             // valsartán
    'anexa',               // amlodipina
    'redugluc',            // metformina
    'lomet',               // glimepirida
  ],
  digestion: [
    'oblisec',             // omeprazol
    'pampar',              // pantoprazol
    'relasules',           // esomeprazol
    'custey',              // loperamida
    'rilaquin',            // metoclopramida
    'relopat',             // trimebutina
    'omeprazol',
  ],
  antibioticos: [
    'nobactam',            // amoxicilina (+clavulánico)
    'microsulf',           // ciprofloxacina
    'sinurit',             // cefalexina
    'tanezox',             // azitromicina
    'finasept',            // claritromicina
    'ely diar',            // levofloxacina (no es un antidiarreico)
    'amoxicilina',
  ],
}

export const necesidadDe = (nombre) => {
  const n = String(nombre ?? '').toLowerCase().trim()
  for (const [necesidad, prefijos] of Object.entries(REGLAS)) {
    if (prefijos.some(p => n.startsWith(p))) return necesidad
  }
  return null
}

// Fotos (Unsplash, licencia libre — sin Unsplash+). Las seis de necesidad las
// eligió Felipe (docs/reports/farmacia-2026-11-22/fotos/elegidas.json); las
// cuatro de categoría, con el mismo criterio: luz cálida, personas que no miran
// a cámara, nada de catálogo.
export const FOTOS = {
  dolor:        'photo-1526413232644-8a40f03cc03b', // unsplash.com/photos/f2ar0ltTvaI
  resfrio:      'photo-1602533186068-0ae13d6bde63', // AE2_FndDfAU
  piel:         'photo-1583826198013-28269b3bc786', // HKqTFsaVCV0
  presion:      'photo-1761349319494-e4b8d9d5d62b', // q_knKkWgxqs
  digestion:    'photo-1606841613102-2bfd25e23265', // G3Y8KVjpl1M
  antibioticos: 'photo-1583088580067-16d1109aeacb', // hEX5R8u7gCI
  clinica:      'photo-1733685372591-202f6c6deaf9', // c3KSsftxniw
  pediatria:    'photo-1672266617259-4fd968406d27', // 44yetq2S99M
  nutricion:    'photo-1572532637574-f44e2b82e412', // 6HiQ0yZLHjs
  bienestar:    'photo-1620242736370-bfb4ce9ebf3e', // PG3XeL1uWdU
}
// La de pediatría recorta por caras: con `entropy` se comían las cabezas.
const RECORTE = { pediatria: 'faces' }

function leerEnv(archivo) {
  const env = {}
  for (const linea of readFileSync(archivo, 'utf8').split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(linea)
    if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
  }
  return env
}

async function main() {
  const entorno = process.argv[2]
  const forzar = process.argv.includes('--forzar')
  const verificar = process.argv.includes('--verificar')
  if (!['staging', 'produccion'].includes(entorno)) {
    console.error('uso: node scripts/farmacia-necesidades.mjs <staging|produccion> [--forzar|--verificar]')
    process.exit(1)
  }
  const global = leerEnv(path.join(homedir(), 'Local/.env'))
  let url, key
  if (entorno === 'staging') {
    url = global.HEALTHIER_STAGING_SUPABASE_URL
    key = global.HEALTHIER_STAGING_SUPABASE_SERVICE_ROLE_KEY
  } else {
    const web = leerEnv(path.join(homedir(), 'Local/Healthier/website/.env'))
    url = web.VITE_SUPABASE_URL
    key = web.SUPABASE_SERVICE_ROLE_KEY
  }
  if (!url || !key) { console.error(`faltan credenciales de ${entorno}`); process.exit(1) }
  const sb = createClient(url, key, { auth: { persistSession: false } })
  let fallas = 0

  // ── Fotos ──────────────────────────────────────────────────────────────────
  // Dos tamaños: `<clave>.jpg` (1200×1500, la foto de arriba de la página de
  // la categoría) y `<clave>-640.jpg` (640×800, la tarjeta del mosaico).
  // Y `<clave>-ancha.jpg` (1600×640) para la misma página en pantalla ancha.
  const tamanos = [['', 1200, 1500], ['-640', 640, 800], ['-ancha', 1600, 640]]
  for (const [clave, foto] of Object.entries(FOTOS)) for (const [sufijo, w, h] of tamanos) {
    const destino = `categorias/${clave}${sufijo}.jpg`
    const publica = sb.storage.from('pharmacy-products').getPublicUrl(destino).data.publicUrl
    if (!verificar) {
      const origen = `https://images.unsplash.com/${foto}?w=${w}&h=${h}&fit=crop&crop=${RECORTE[clave] ?? 'entropy'}&q=78&fm=jpg`
      const r = await fetch(origen)
      if (!r.ok) { console.error(`🔴 ${clave}: Unsplash respondió ${r.status}`); fallas++; continue }
      const { error } = await sb.storage.from('pharmacy-products')
        .upload(destino, Buffer.from(await r.arrayBuffer()), { contentType: 'image/jpeg', upsert: true, cacheControl: '31536000' })
      if (error) { console.error(`🔴 ${clave}: ${error.message}`); fallas++; continue }
    }
    const ok = (await fetch(publica, { method: 'HEAD' })).ok
    console.log(`${ok ? '🟢' : '🔴'} foto ${clave}${sufijo}`)
    if (!ok) fallas++
  }

  // ── Necesidades ────────────────────────────────────────────────────────────
  const { data: productos, error } = await sb.from('pharmacy_products').select('id, name, necesidad')
  if (error) { console.error(`🔴 ${error.message} (¿falta la migración 246?)`); process.exit(1) }
  const conteo = Object.fromEntries(Object.keys(REGLAS).map(k => [k, 0]))
  for (const p of productos) {
    const regla = necesidadDe(p.name)
    let actual = p.necesidad
    if (regla && (forzar || !actual) && actual !== regla && !verificar) {
      const { error: e } = await sb.from('pharmacy_products').update({ necesidad: regla }).eq('id', p.id)
      if (e) { console.error(`🔴 ${p.name}: ${e.message}`); fallas++; continue }
      actual = regla
    }
    if (regla && !actual) { console.log(`🔴 sin necesidad: ${p.name} (debería ser ${regla})`); fallas++ }
    if (actual) conteo[actual]++
  }
  const total = Object.values(conteo).reduce((a, b) => a + b, 0)
  for (const [k, n] of Object.entries(conteo)) {
    console.log(`${n ? '🟢' : '🔴'} ${k}: ${n}`)
    if (!n) fallas++
  }
  console.log(`${total} de ${productos.length} productos con necesidad (${entorno})`)
  process.exit(fallas ? 1 : 0)
}

if (import.meta.url === `file://${process.argv[1]}`) main()
