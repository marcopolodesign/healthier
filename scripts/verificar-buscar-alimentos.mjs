#!/usr/bin/env node
/**
 * Chequeo del buscador de alimentos de NutriPlan.
 *
 *   node scripts/verificar-buscar-alimentos.mjs            # producción + staging
 *   node scripts/verificar-buscar-alimentos.mjs staging    # sólo uno
 *
 * Le pide a la Edge Function `buscar-alimentos` lo mismo que el botón "Buscar en
 * la base online" y falla si no vuelven alimentos con calorías.
 *
 * **Por qué existe.** Entre el 2026-09-04 y el 2026-10-23 el buscador devolvió
 * siempre vacío: FatSecret pedía una lista blanca de IPs que las Edge Functions
 * no pueden cumplir, y como la función contesta 200 con un `motivo` (a propósito,
 * para que el nutricionista siga con el vademécum local), nada se ponía en rojo.
 * Se pasó a Open Food Facts; esto avisa si la fuente vuelve a dejar de responder.
 *
 * Sólo lee. No escribe nada.
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const leerEnv = (ruta) => {
  try {
    return Object.fromEntries(
      readFileSync(ruta, 'utf8').split('\n')
        .map(l => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2]])
    )
  } catch { return {} }
}
const global = leerEnv(join(homedir(), 'Local', '.env'))
const local = leerEnv(join(dirname(fileURLToPath(import.meta.url)), '..', '.env'))

const ENTORNOS = {
  produccion: { url: local.VITE_SUPABASE_URL, anon: local.VITE_SUPABASE_ANON_KEY },
  staging: { url: global.HEALTHIER_STAGING_SUPABASE_URL, anon: global.HEALTHIER_STAGING_SUPABASE_ANON_KEY },
}
const BUSQUEDAS = ['yogur', 'dulce de leche', 'arroz']

const pedidos = process.argv[2] ? [process.argv[2]] : Object.keys(ENTORNOS)
let fallas = 0

for (const nombre of pedidos) {
  const e = ENTORNOS[nombre]
  console.log(`\n▸ ${nombre}`)
  if (!e?.url || !e?.anon) { console.log('   ❌ faltan URL o anon key'); fallas++; continue }
  for (const query of BUSQUEDAS) {
    try {
      const res = await fetch(`${e.url}/functions/v1/buscar-alimentos`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${e.anon}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      })
      const data = await res.json()
      const conKcal = (data.results ?? []).filter(f => f.calories > 0)
      if (res.ok && conKcal.length > 0) {
        console.log(`   ✅ "${query}": ${conKcal.length} alimentos (ej. ${conKcal[0].name}, ${conKcal[0].calories} kcal/100g)`)
      } else {
        console.log(`   ❌ "${query}": ${res.status} ${data.motivo ?? data.message ?? 'sin resultados'}`)
        fallas++
      }
    } catch (err) {
      console.log(`   ❌ "${query}": ${err.message}`)
      fallas++
    }
  }
}

console.log(fallas ? `\n❌ ${fallas} búsqueda(s) fallaron.` : '\n✅ El buscador de alimentos responde.')
process.exit(fallas ? 1 : 0)
