#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Farmacia del paciente: reparto de `pharmacy_products.necesidad` (migración
// 246) + fotos del mosaico en el bucket `pharmacy-products/categorias/`.
//
//   node scripts/farmacia-necesidades.mjs staging
//   node scripts/farmacia-necesidades.mjs produccion
//   node scripts/farmacia-necesidades.mjs produccion --verificar   (no escribe)
//
// 🔴 PASO DEL PASE A PRODUCCIÓN, después de las migraciones 246 y 248 y ANTES de
// publicar el front: sin esto el mosaico de prod queda sin fotos y sin
// necesidades (sólo se verían las categorías).
//
// Criterio (Mateo, 2026-11-22): necesidad SÓLO si es obvia por el nombre o la
// droga. Desde la migración 248 la regla vive en la BASE, en un solo lugar:
// la tabla `farmacia_necesidad_reglas` (prefijo de marca → necesidad, con la
// droga anotada) y `farmacia_asignar_necesidades()`. El mismo trigger la
// aplica sola cuando entra un producto nuevo. Este script sólo dispara la
// asignación en bloque para el catálogo que ya existe.
//
// Lo que asigna queda `necesidad_origen = 'auto'`: la farmacia lo ve "a
// revisar" en su Catálogo. Nunca toca lo que la farmacia eligió ('farmacia').
// `--forzar` además corrige lo 'auto' que la regla hoy diría distinto.
//
// Control (lo arreglado no vuelve): `--verificar` falla (exit 1) si una foto
// no responde 200, si una necesidad quedó sin productos, o si un producto que
// la regla asigna quedó sin necesidad sin que la farmacia lo haya decidido.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

/** Las seis necesidades (la lista cerrada de la migración 246). */
const NECESIDADES = ['dolor', 'resfrio', 'piel', 'presion', 'digestion', 'antibioticos']

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
  // La regla la aplica la base (migración 248): un solo lugar para el alta y
  // para este script.
  if (!verificar) {
    const { data: asignados, error: e } = await sb.rpc('farmacia_asignar_necesidades', { p_forzar: forzar })
    if (e) { console.error(`🔴 ${e.message} (¿falta la migración 248?)`); process.exit(1) }
    console.log(`🟢 ${asignados} producto(s) con necesidad asignada (quedan "a revisar" para la farmacia)`)
  }
  const { data: productos, error } = await sb.from('pharmacy_products').select('id, name, necesidad, necesidad_origen')
  if (error) { console.error(`🔴 ${error.message} (¿falta la migración 246/248?)`); process.exit(1) }
  const conteo = Object.fromEntries(NECESIDADES.map(k => [k, 0]))
  let aRevisar = 0
  for (const p of productos) {
    if (p.necesidad) conteo[p.necesidad]++
    if (p.necesidad_origen === 'auto') aRevisar++
    if (!p.necesidad && p.necesidad_origen !== 'farmacia') {
      const { data: regla } = await sb.rpc('farmacia_necesidad_sugerida', { p_nombre: p.name })
      if (regla) { console.log(`🔴 sin necesidad: ${p.name} (debería ser ${regla})`); fallas++ }
    }
  }
  console.log(`${aRevisar} para revisar por la farmacia`)
  const total = Object.values(conteo).reduce((a, b) => a + b, 0)
  for (const [k, n] of Object.entries(conteo)) {
    console.log(`${n ? '🟢' : '🔴'} ${k}: ${n}`)
    if (!n) fallas++
  }
  console.log(`${total} de ${productos.length} productos con necesidad (${entorno})`)
  process.exit(fallas ? 1 : 0)
}

if (import.meta.url === `file://${process.argv[1]}`) main()
