#!/usr/bin/env node
/**
 * "Lo arreglado no vuelve" — el profesional verificado sin ningún precio
 * cargado no puede volver a aparecer en la búsqueda del paciente.
 *
 *   node scripts/verificar-sin-precio.mjs              # producción + staging
 *   node scripts/verificar-sin-precio.mjs produccion
 *   node scripts/verificar-sin-precio.mjs staging
 *
 * Le hace a la base la MISMA pregunta que hace `buscar_profesionales_cobrables`
 * (la RPC que usa el buscador del paciente, migración 176) y falla si aparece
 * alguien sin precio válido. También lista, como información y NO como falla,
 * a los verificados sin precio — es el estado correcto mientras no lo cargan
 * (Mateo, 2026-09-25), y es la lista que usa `scripts/avisar-sin-precio.mjs`
 * para saber a quién avisarle.
 *
 * Sólo lee. No escribe ni manda nada.
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const env = Object.fromEntries(
  readFileSync(join(homedir(), 'Local', '.env'), 'utf8')
    .split('\n').map(l => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2]])
)

const ENTORNOS = {
  produccion: { ref: 'aixjejdoofervrkggbkd' },
  staging:    { ref: 'itjhrvlzuqvyhqtffumc' },
}

// El mismo piso que `website/src/lib/tarifas.js` (PRECIO_MINIMO) y las
// migraciones 142/176 — si cambia allá, cambia acá.
const MINIMO = 15000
const CONDICION_SIN_PRECIO = `
  not (
    (pp.price_video      is not null and pp.price_video      >= ${MINIMO})
    or (pp.price_presencial is not null and pp.price_presencial >= ${MINIMO})
    or (pp.session_price    is not null and pp.session_price    >= ${MINIMO})
  )
`

// Le pregunta a la RPC de verdad, no a una copia de su WHERE: una copia de la
// condición da positivo con sólo que existan profesionales sin precio (que es
// un estado válido), y no se entera si alguien cambia la función. Lo que
// importa es qué devuelve el buscador.
const SQL_COBRABLES_SIN_PRECIO = `
  select e->'profiles'->>'email' as email, e->'profiles'->>'full_name' as full_name,
         e->>'specialty' as specialty, e->>'price_video' as price_video,
         e->>'price_presencial' as price_presencial, e->>'session_price' as session_price
    from jsonb_array_elements(public.buscar_profesionales_cobrables(null, null)) e
   where not (
     coalesce((e->>'price_video')::numeric, 0)      >= ${MINIMO}
     or coalesce((e->>'price_presencial')::numeric, 0) >= ${MINIMO}
     or coalesce((e->>'session_price')::numeric, 0)    >= ${MINIMO}
   )
`

// Informativo: a quién hay que avisarle. Verificado + activo alcanza — no
// hace falta MP conectado para que esto aplique, porque `professionalService
// .search()`/`getDashboardPool()` tampoco lo exigen (a diferencia de la RPC).
const SQL_VERIFICADOS_SIN_PRECIO = `
  select p.email, p.full_name, pp.specialty, pp.mp_connected
    from professional_profiles pp
    join profiles p on p.id = pp.user_id
   where pp.is_verified
     and pp.is_active
     and ${CONDICION_SIN_PRECIO}
   order by p.email
`

let fallas = 0
const ok   = (m) => console.log(`   ✅ ${m}`)
const mal  = (m) => { fallas++; console.log(`   ❌ ${m}`) }
const nota = (m) => console.log(`   ·  ${m}`)

async function consultar(ref, query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const cuerpo = await r.json()
  if (!Array.isArray(cuerpo)) throw new Error(JSON.stringify(cuerpo).slice(0, 200))
  return cuerpo
}

async function revisar(nombre, { ref }) {
  console.log(`\n═══ ${nombre.toUpperCase()} ═══`)

  console.log('\n▸ ¿Alguien sin precio pasa como "cobrable" (lo que devuelve el buscador)?')
  let cobrablesSinPrecio
  try {
    cobrablesSinPrecio = await consultar(ref, SQL_COBRABLES_SIN_PRECIO)
  } catch (e) {
    mal(`no se pudo consultar: ${e.message}`)
    return
  }
  if (cobrablesSinPrecio.length === 0) {
    ok('nadie — el piso de precio se respeta en buscar_profesionales_cobrables')
  } else {
    mal(`${cobrablesSinPrecio.length} profesional(es) verificado(s), activo(s), con MP conectado y SIN precio válido — volvieron a ser "cobrables":`)
    for (const p of cobrablesSinPrecio) {
      nota(`${p.full_name ?? '—'} <${p.email}> (${p.specialty}) — video ${p.price_video ?? '—'} · presencial ${p.price_presencial ?? '—'} · sesión ${p.session_price ?? '—'}`)
    }
  }

  console.log('\n▸ Verificados sin precio (informativo — no es una falla, es a quién avisarle)')
  let sinPrecio
  try {
    sinPrecio = await consultar(ref, SQL_VERIFICADOS_SIN_PRECIO)
  } catch (e) {
    mal(`no se pudo consultar: ${e.message}`)
    return
  }
  if (sinPrecio.length === 0) {
    nota('ninguno')
  } else {
    nota(`${sinPrecio.length}:`)
    for (const p of sinPrecio) nota(`${p.full_name ?? '—'} · ${p.email} (${p.specialty}) — MP ${p.mp_connected ? 'conectado' : 'sin conectar'}`)
  }
}

const pedido = process.argv[2]
for (const [nombre, cfg] of Object.entries(ENTORNOS)) {
  if (pedido && pedido !== nombre) continue
  await revisar(nombre, cfg)
}

console.log(fallas === 0
  ? '\n✅ El piso de precio se respeta: nadie sin precio aparece como cobrable.\n'
  : `\n❌ ${fallas} problema(s) — alguien sin precio volvió a ser visible en la búsqueda.\n`)
process.exit(fallas === 0 ? 0 : 1)
