#!/usr/bin/env node
/**
 * Chequeo de la consulta inmediata (on-demand).
 *
 *   node scripts/verificar-ondemand.mjs            # producción + staging
 *   node scripts/verificar-ondemand.mjs produccion # sólo producción
 *   node scripts/verificar-ondemand.mjs staging    # sólo staging
 *
 * **Le hace a la base exactamente la misma pregunta que hace el paciente**: por
 * cada vertical habilitada, ¿cuántos profesionales entran hoy al pool? Si la
 * respuesta es cero, la consulta inmediata está muerta para esa especialidad
 * aunque toda la app esté en verde.
 *
 * **Por qué existe.** El 2026-09-03 el on-demand estaba roto y nada avisaba: el
 * switch del profesional decía "Estás disponible", el build pasaba y no había
 * un solo error en ningún lado. El pool no mira `is_on_demand` (la intención)
 * sino `on_demand_last_seen_at` (la vigencia, 1 hora), y esa nunca se escribía:
 * prender el switch no arrancaba el latido hasta recargar la página. Le pasaba
 * a la cuenta demo y a una profesional real. Peor: como el pool venía siempre
 * vacío, la pantalla del paciente nunca llegaba al checkout y ahí había un
 * segundo bug —un crash de la pantalla entera— que era **inalcanzable** y por
 * eso invisible. Una feature muerta esconde todo lo que está detrás de ella.
 *
 * Por eso este chequeo no pregunta "¿deployó bien?" sino "¿alguien puede usarlo
 * ahora mismo?", y por eso conviene correrlo **todos los días**, no sólo
 * después de un deploy: la vigencia vence sola con el paso del tiempo.
 *
 * Sólo lee. No escribe una sola fila, no toca Mercado Pago, no crea consultas.
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

// Espejo de `professionalService.search({ onDemand: true, onlyLive: true })` +
// `isPayable()` de `lib/onDemandPool.js`. Si allá cambia un filtro, acá también.
const SQL_POOL = `
  select vs.id                                                as vertical,
         vs.ondemand_price                                    as precio,
         count(pp.user_id) filter (
           where pp.is_verified
             and pp.is_active
             and pp.is_on_demand
             and pp.mp_connected
             and pp.on_demand_last_seen_at > now() - interval '1 hour'
         )                                                    as vivos,
         count(pp.user_id) filter (
           where pp.is_verified and pp.is_active and pp.is_on_demand
         )                                                    as declarados,
         count(pp.user_id) filter (
           where pp.is_verified and pp.is_active and pp.is_on_demand
             and pp.on_demand_last_seen_at is null
         )                                                    as sin_latido
    from vertical_settings vs
    left join specialties e on e.vertical_id = vs.id and e.parent_id is null
    left join professional_profiles pp on pp.specialty = e.slug
   where vs.enabled
   group by vs.id, vs.ondemand_price, vs.sort_order
   order by vs.sort_order
`

// El desfasaje que causó el incidente: intención declarada sin vigencia.
const SQL_SIN_VIGENCIA = `
  select p.email, pp.specialty
    from professional_profiles pp
    join profiles p on p.id = pp.user_id
   where pp.is_on_demand
     and pp.is_verified
     and pp.is_active
     and pp.on_demand_last_seen_at is null
   order by p.email
`

let fallas = 0
const ok   = (m) => console.log(`   ✅ ${m}`)
const mal  = (m) => { fallas++; console.log(`   ❌ ${m}`) }
const aviso = (m) => console.log(`   ⚠️  ${m}`)
const nota = (m) => console.log(`   ·  ${m}`)

async function consultar(ref, query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  })
  const cuerpo = await r.json()
  if (!Array.isArray(cuerpo)) throw new Error(JSON.stringify(cuerpo).slice(0, 200))
  return cuerpo
}

async function revisar(nombre, { ref }) {
  console.log(`\n═══ ${nombre.toUpperCase()} ═══`)

  // ── 1) La pregunta del paciente: ¿hay alguien para atenderme? ─────────────
  console.log('\n▸ Pool por vertical (lo que ve el paciente al pedir consulta inmediata)')
  let pool
  try {
    pool = await consultar(ref, SQL_POOL)
  } catch (e) {
    return mal(`no se pudo consultar el pool: ${e.message}`)
  }

  if (!pool.length) {
    aviso('no hay ninguna vertical habilitada para on-demand — nada que ofrecer')
  }

  /*
   * Sólo una de estas tres situaciones es un bug, y la distinción es la razón
   * de ser del script: **un chequeo que está en rojo siempre no lo mira nadie**,
   * que es exactamente cómo se pierden los incidentes que esto viene a evitar.
   *
   *  - Nadie prendió el switch → aviso. Es una decisión de las personas, no una
   *    falla del software. Con un pool de un médico, es lo normal de madrugada.
   *  - Prendido y la vigencia venció hace rato → aviso. El TTL de una hora
   *    funcionando como corresponde.
   *  - Prendido y la vigencia **nunca se escribió** (`NULL`) → ❌ falla. Ése es
   *    el bug del 2026-09-03: el profesional cree que está disponible, y no hay
   *    forma de que el paciente lo vea nunca, ni esperando.
   */
  for (const v of pool) {
    const vivos = Number(v.vivos)
    const declarados = Number(v.declarados)
    const sinLatido = Number(v.sin_latido)
    if (vivos > 0) {
      ok(`${v.vertical}: ${vivos} disponible(s) ahora · $${v.precio ?? '—'}`)
    } else if (sinLatido > 0) {
      mal(`${v.vertical}: ${sinLatido} con el switch prendido y la vigencia SIN ESCRIBIR — ` +
          'creen estar disponibles y el paciente no los va a ver nunca (bug, no espera)')
    } else if (declarados > 0) {
      aviso(`${v.vertical}: 0 ahora — ${declarados} con el switch prendido pero sin abrir la app en la última hora`)
    } else {
      aviso(`${v.vertical}: nadie con el switch prendido — no hay a quién ofrecerle al paciente`)
    }
  }

  // ── 2) El desfasaje que lo causó ──────────────────────────────────────────
  console.log('\n▸ Profesionales con el switch prendido y sin vigencia')
  let huerfanos
  try {
    huerfanos = await consultar(ref, SQL_SIN_VIGENCIA)
  } catch (e) {
    return mal(`no se pudo consultar la vigencia: ${e.message}`)
  }

  if (!huerfanos.length) {
    ok('ninguno — a todos los que dicen estar disponibles se les escribió el latido')
  } else {
    // No suma falla propia: la falla real ya la reporta el pool de arriba. Acá
    // se nombra a quién le está pasando, que es lo accionable.
    aviso(`${huerfanos.length} con "Estás disponible" en su panel y sin latido — invisibles para el paciente:`)
    for (const h of huerfanos) nota(`${h.email} (${h.specialty})`)
    nota('se curan solos la próxima vez que abran su panel con el switch prendido')
  }
}

const pedido = process.argv[2]
for (const [nombre, cfg] of Object.entries(ENTORNOS)) {
  if (pedido && pedido !== nombre) continue
  await revisar(nombre, cfg)
}

console.log(fallas === 0
  ? '\n✅ La consulta inmediata tiene con quién atender.\n'
  : `\n❌ ${fallas} vertical(es) sin profesionales disponibles. La consulta inmediata no funciona ahí.\n`)
process.exit(fallas === 0 ? 0 : 1)
