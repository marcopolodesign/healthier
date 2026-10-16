#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Sube al bucket `verticales` (migración 199) las fotos que ya teníamos de cada
// vertical y las deja cargadas en `vertical_settings.image_url`. Después de esto
// la foto se cambia desde /super-admin/verticales.
//
//   node scripts/sembrar-imagenes-verticales.mjs staging
//   node scripts/sembrar-imagenes-verticales.mjs produccion
//
// Idempotente: sólo toca verticales que todavía no tienen `image_url`. Con
// `--forzar` las reemplaza igual.
//
// Las fotos son las de las landings (public/images/landing), las mismas que el
// website ya usaba desde `src/lib/verticals.js` y la app desde
// `assets/images/verticals/`. Veterinaria y Odontología no tienen: quedan con
// la tarjeta del color.
//
// Control (lo arreglado no vuelve): con `--verificar` no sube nada y falla
// (exit 1) si alguna vertical de la lista quedó sin foto, o si la URL no
// responde 200.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const FOTOS = {
  clinica:    'public/images/landing/esp-medicina.jpg',
  pediatria:  'public/images/landing/esp-pediatria.jpg',
  nutricion:  'public/images/landing/esp-nutricion.jpg',
  mente:      'public/images/landing/esp-psicologia.jpg',
  fisico:     'public/images/landing/esp-entrenamiento.jpg',
  preparador: 'public/images/landing/esp-entrenamiento.jpg',
}

function leerEnv(archivo) {
  const env = {}
  for (const linea of readFileSync(archivo, 'utf8').split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(linea)
    if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
  }
  return env
}

const entorno = process.argv[2]
const forzar = process.argv.includes('--forzar')
const verificar = process.argv.includes('--verificar')
if (!['staging', 'produccion'].includes(entorno)) {
  console.error('uso: node scripts/sembrar-imagenes-verticales.mjs <staging|produccion> [--forzar|--verificar]')
  process.exit(1)
}

const global = leerEnv('/Users/mataldao/Local/.env')
let url, key
if (entorno === 'staging') {
  url = global.HEALTHIER_STAGING_SUPABASE_URL
  key = global.HEALTHIER_STAGING_SUPABASE_SERVICE_ROLE_KEY
} else {
  const web = leerEnv(path.resolve(raiz, '../../../.env'))
  url = web.VITE_SUPABASE_URL
  key = web.SUPABASE_SERVICE_ROLE_KEY
}
if (!url || !key) { console.error(`faltan credenciales de ${entorno}`); process.exit(1) }

const sb = createClient(url, key, { auth: { persistSession: false } })
const { data: filas, error } = await sb.from('vertical_settings').select('id, image_url').eq('tipo', 'vertical')
if (error) { console.error(error.message); process.exit(1) }

let fallas = 0
for (const fila of filas) {
  const archivo = FOTOS[fila.id]
  if (!archivo) continue

  if (verificar) {
    const ok = fila.image_url && (await fetch(fila.image_url, { method: 'HEAD' })).ok
    console.log(`${ok ? '🟢' : '🔴'} ${fila.id} ${fila.image_url ?? '(sin foto)'}`)
    if (!ok) fallas++
    continue
  }

  if (fila.image_url && !forzar) { console.log(`· ${fila.id} ya tiene foto`); continue }
  const destino = `${fila.id}/semilla-${path.basename(archivo)}`
  const { error: errSubida } = await sb.storage.from('verticales')
    .upload(destino, readFileSync(path.resolve(raiz, archivo)), { contentType: 'image/jpeg', upsert: true, cacheControl: '31536000' })
  if (errSubida) { console.error(`🔴 ${fila.id}: ${errSubida.message}`); fallas++; continue }
  const publica = sb.storage.from('verticales').getPublicUrl(destino).data.publicUrl
  const { error: errUpd } = await sb.from('vertical_settings').update({ image_url: publica }).eq('id', fila.id)
  if (errUpd) { console.error(`🔴 ${fila.id}: ${errUpd.message}`); fallas++; continue }
  console.log(`🟢 ${fila.id} → ${publica}`)
}
process.exit(fallas ? 1 : 0)
