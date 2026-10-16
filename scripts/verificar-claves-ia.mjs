#!/usr/bin/env node
/**
 * verificar-claves-ia.mjs — que ninguna clave de IA vuelva al cliente.
 *
 * Control que dejó el pendiente del RENAPER (2026-10-16): Gemini se llamaba
 * desde el navegador (`VITE_GEMINI_API_KEY`) y desde la app
 * (`EXPO_PUBLIC_GEMINI_API_KEY`). Ahora va sólo por Edge Functions con el
 * secret `GEMINI_API_KEY`. Este script falla si reaparece.
 *
 * Chequea tres cosas:
 *   1. El código fuente (website/src y, si existe, mobile/app + mobile/src) no
 *      llama a Gemini ni lee una clave de IA de un env público.
 *   2. El bundle publicado (por defecto staging) no tiene la URL de Gemini ni
 *      algo con forma de clave de Google (`AIza…`).
 *   3. Las funciones de IA rechazan a quien no tiene sesión (401).
 *
 * Uso:
 *   node scripts/verificar-claves-ia.mjs                       # staging
 *   node scripts/verificar-claves-ia.mjs --entorno produccion
 *   node scripts/verificar-claves-ia.mjs --mobile ../mobile    # otra ruta de la app
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const aqui = dirname(fileURLToPath(import.meta.url))
const raizWeb = resolve(aqui, '..')
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d }

const ENTORNOS = {
  staging: { web: 'https://staging.healthier.com.ar', supabase: 'https://itjhrvlzuqvyhqtffumc.supabase.co' },
  produccion: { web: 'https://www.healthier.com.ar', supabase: 'https://aixjejdoofervrkggbkd.supabase.co' },
}
const entorno = ENTORNOS[arg('--entorno', 'staging')]
if (!entorno) { console.error('--entorno staging|produccion'); process.exit(2) }
const rutaMobile = resolve(arg('--mobile', join(raizWeb, '..', 'mobile')))

const PATRONES_FUENTE = [/generativelanguage\.googleapis\.com/, /(VITE|EXPO_PUBLIC)_[A-Z_]*(GEMINI|OPENAI|ANTHROPIC)[A-Z_]*/]
const PATRONES_BUNDLE = [/(VITE|EXPO_PUBLIC)_[A-Z_]*GEMINI/, /generativelanguage\.googleapis\.com/, /AIza[0-9A-Za-z_-]{35}/]
const FUNCIONES_IA = ['biovisor-extract', 'nutriplan-receta']

let fallas = 0
const mal = (m) => { fallas++; console.log(`  🔴 ${m}`) }
const bien = (m) => console.log(`  🟢 ${m}`)

function* archivos(dir) {
  if (!existsSync(dir)) return
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n.startsWith('.')) continue
    const p = join(dir, n)
    if (statSync(p).isDirectory()) yield* archivos(p)
    else if (/\.(jsx?|tsx?|mjs)$/.test(n)) yield p
  }
}

console.log('1 · Código fuente')
const dirs = [join(raizWeb, 'src'), join(rutaMobile, 'app'), join(rutaMobile, 'src')]
for (const d of dirs) {
  if (!existsSync(d)) { console.log(`  ·  ${d} no existe, se saltea`); continue }
  let hits = 0
  for (const f of archivos(d)) {
    // Se miran sólo las líneas de código: los comentarios que cuentan la
    // historia ("vivía en VITE_GEMINI_API_KEY") no son una fuga.
    readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
      const t = l.trim()
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return
      if (PATRONES_FUENTE.some(r => r.test(l))) { hits++; mal(`${f}:${i + 1}  ${t.slice(0, 120)}`) }
    })
  }
  if (!hits) bien(`${d} sin claves de IA ni llamadas directas a Gemini`)
}

console.log(`2 · Bundle publicado (${entorno.web})`)
try {
  const html = await (await fetch(entorno.web)).text()
  const scripts = [...html.matchAll(/<script[^>]+src="([^"]+\.js)"/g)].map(m => new URL(m[1], entorno.web).href)
  // El chunk de entrada importa los demás: se siguen los imports de assets.
  const vistos = new Set()
  const cola = [...scripts]
  while (cola.length && vistos.size < 400) {
    const u = cola.shift()
    if (vistos.has(u)) continue
    vistos.add(u)
    const js = await (await fetch(u)).text()
    for (const r of PATRONES_BUNDLE) if (r.test(js)) mal(`${u} contiene ${r}`)
    // Vite referencia los chunks como "assets/X.js" (desde la raíz) o "./X.js"
    // (relativo al chunk que los importa).
    for (const m of js.matchAll(/["'`]\/?(assets\/[\w.-]+\.js)["'`]/g)) cola.push(new URL('/' + m[1], entorno.web).href)
    for (const m of js.matchAll(/["'`](\.\/[\w.-]+\.js)["'`]/g)) cola.push(new URL(m[1], u).href)
  }
  if (!vistos.size) mal('no se encontró ningún script en el HTML')
  else bien(`${vistos.size} archivos JS revisados`)
} catch (e) { mal(`no se pudo bajar el bundle: ${e.message}`) }

console.log('3 · Funciones de IA sin sesión')
for (const fn of FUNCIONES_IA) {
  try {
    const r = await fetch(`${entorno.supabase}/functions/v1/${fn}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    })
    if (r.status === 401) bien(`${fn} → 401`)
    else mal(`${fn} → ${r.status} (tenía que ser 401)`)
  } catch (e) { mal(`${fn}: ${e.message}`) }
}

console.log(fallas ? `\n🔴 ${fallas} problema(s)` : '\n🟢 Todo en orden')
process.exit(fallas ? 1 : 0)
