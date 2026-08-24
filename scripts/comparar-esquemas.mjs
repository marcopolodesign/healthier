#!/usr/bin/env node
/**
 * Compara el esquema de PRODUCCIÓN contra el de STAGING y lista las
 * diferencias: tablas, columnas, funciones, policies y triggers.
 *
 *   node scripts/comparar-esquemas.mjs
 *
 * **Por qué existe.** El 2026-08-24, al levantar la base de staging desde cero,
 * aparecieron dos objetos que vivían SÓLO en producción, creados a mano y nunca
 * versionados: la función `get_my_role()` (de la que depende todo el RLS) y la
 * policy `profiles_read_own` en su versión no recursiva. Sin ellos, la base
 * reconstruida desde el repo tenía el login roto — y nada avisaba.
 * `check-migraciones-huerfanas.sh` no los detectaba porque compara MIGRACIONES,
 * no el esquema real.
 *
 * Correrlo cada tanto (y sobre todo después de tocar algo en el dashboard de
 * Supabase). Lo esperado hoy es que la única diferencia sea la rama de
 * farmacia, que está sin mergear a propósito: si aparece cualquier otra cosa,
 * es drift nuevo y hay que capturarlo en una migración.
 *
 * Sólo lee. No modifica ninguna de las dos bases.
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const REF_PROD = 'aixjejdoofervrkggbkd'
const REF_STAGING = 'itjhrvlzuqvyhqtffumc'
// Todo lo de la rama `feature/farmacia-medicamentos` (migraciones 103-107 y
// 111), aplicada en producción pero no en `main`. Es la única diferencia
// legítima; cuando la rama se mergee (o se descarte), sacar este filtro.
const PATRON_FARMACIA = /medication_order|pharmac/
// La 107 (`payments_polymorphic`) además le cuelga estas dos cosas a `payments`,
// que por el nombre no se delatan como de farmacia.
const EXTRAS_FARMACIA = new Set([
  'columna:payments.order_id',
  'policy:payments.payments_select_pharmacy_staff',
])

const env = Object.fromEntries(
  readFileSync(join(homedir(), 'Local', '.env'), 'utf8')
    .split('\n').map(l => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean)
    .map(m => [m[1], m[2]])
)

const SQL = `
select 'tabla:'||table_name k from information_schema.tables where table_schema='public'
union all select 'columna:'||table_name||'.'||column_name from information_schema.columns where table_schema='public'
union all select 'función:'||p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
union all select 'policy:'||tablename||'.'||policyname from pg_policies where schemaname='public'
union all select 'trigger:'||c.relname||'.'||t.tgname from pg_trigger t
  join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
  where not t.tgisinternal and n.nspname='public';`

async function esquema(ref) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: SQL }),
  })
  const body = await r.json()
  if (body?.message) throw new Error(`${ref}: ${body.message}`)
  return new Set(body.map(x => x.k))
}

const esFarmacia = k => PATRON_FARMACIA.test(k) || EXTRAS_FARMACIA.has(k)

function listar(titulo, conjunto) {
  const items = [...conjunto].sort()
  const farmacia = items.filter(esFarmacia)
  const resto = items.filter(k => !esFarmacia(k))
  console.log(`\n${titulo}`)
  if (!items.length) return console.log('   (nada)')
  if (farmacia.length) console.log(`   ${farmacia.length} de la rama de farmacia (esperado, sin mergear)`)
  if (!resto.length) return
  console.log(`   ⚠️  ${resto.length} SIN explicación — probable drift nuevo, capturarlo en una migración:`)
  for (const k of resto) console.log('      ·', k)
  return resto.length
}

const [prod, staging] = await Promise.all([esquema(REF_PROD), esquema(REF_STAGING)])
console.log(`Producción: ${prod.size} objetos · Staging: ${staging.size} objetos`)

const soloProd = new Set([...prod].filter(k => !staging.has(k)))
const soloStaging = new Set([...staging].filter(k => !prod.has(k)))

const a = listar('▸ Sólo en PRODUCCIÓN (el repo no lo reproduce):', soloProd) || 0
const b = listar('▸ Sólo en STAGING (está en el repo pero no en producción):', soloStaging) || 0

console.log(a + b === 0
  ? '\n✅ Sin drift: todo lo que hay en producción sale del repo.\n'
  : `\n❌ ${a + b} diferencias sin explicar. Ver arriba.\n`)
process.exit(a + b === 0 ? 0 : 1)
