// El teléfono se normaliza en DOS lugares: `cio.to_e164_ar()` en la base
// (migración 166), que es lo que lee el Data Warehouse Sync de Customer.io, y
// `toE164Ar()` en `src/utils/customerio.js`, que es lo que empujan los eventos
// de la app. Si se separan, el mismo teléfono llega distinto según por qué
// camino entró — y eso no lo avisa nadie: el WhatsApp simplemente no llega.
//
// Este script corre los MISMOS casos del test de SQL contra la versión JS, así
// que la sincronización deja de depender de que alguien lea un comentario.
//
//   node scripts/verificar-e164-js.mjs          # la mitad JS
//   bash scripts/correr-test.sh cio_e164 staging  # la mitad SQL
//
import fs from 'fs'
const src = fs.readFileSync('src/utils/customerio.js', 'utf8')
const mod = await import('data:text/javascript;base64,' + Buffer.from(
  src.slice(src.indexOf('export function toE164Ar'), src.indexOf('function toUnixSeconds'))
).toString('base64'))
const sql = fs.readFileSync('supabase/tests/cio_e164.sql', 'utf8')
const casos = [...sql.matchAll(/\('([^']*)',\s*(?:'([^']*)'|null),\s*(?:'([^']*)'|null)\)/g)]
  .map(m => ({ caso: m[1], entrada: m[2] ?? null, esperado: m[3] ?? null }))
let malas = 0
for (const c of casos) {
  const got = mod.toE164Ar(c.entrada)
  const ok = (got ?? null) === c.esperado
  if (!ok) { malas++; console.log('  FALLA:', c.caso, '→', got, '!=', c.esperado) }
}
console.log(`${casos.length - malas}/${casos.length} ok (JS)`)
