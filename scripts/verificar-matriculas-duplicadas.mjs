#!/usr/bin/env node
/**
 * "Lo arreglado no vuelve" — dos cuentas de profesional, activas y
 * verificadas, con la misma matrícula.
 *
 *   node scripts/verificar-matriculas-duplicadas.mjs              # producción + staging
 *   node scripts/verificar-matriculas-duplicadas.mjs produccion
 *   node scripts/verificar-matriculas-duplicadas.mjs staging
 *
 * De dónde sale (Mateo, 2026-09-25): Federico Beber se registró con dos
 * cuentas de Google (fedebeber@gmail.com y federicob.psi@gmail.com), las dos
 * con la matrícula 191860, y el super admin las aprobó a las dos sin que nada
 * lo avisara — es el mismo profesional cobrando dos veces con la misma
 * credencial. El drawer y la lista de `/super-admin/profesionales` ahora
 * marcan "Duplicado" (mismo criterio: matrícula sin espacios/puntos, o el
 * nombre completo sin acentos); este script es el control automático de que
 * la situación no vuelva a pasar sin que nadie se entere.
 *
 * FALLA sólo cuando el par está activo Y verificado de los dos lados — ésa es
 * la combinación peligrosa (los dos pueden cobrar consultas ya mismo).
 * También lista, como información y no como falla, cualquier otro par con la
 * misma matrícula o el mismo nombre — para saber a quién mirar antes de que
 * llegue a ese punto.
 *
 * Sólo lee.
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

// Espejo de `normalizarMatricula()` en src/pages/super-admin/Profesionales.jsx:
// sin espacios ni puntos, sin distinguir mayúsculas — "191.860" y "191 860"
// son la misma matrícula. Si eso cambia allá, cambia acá.
const SQL_MATRICULA_ACTIVOS_VERIFICADOS = `
  select regexp_replace(lower(pp.license_number), '[\\s.]', '', 'g') as matricula,
         array_agg(p.full_name || ' <' || p.email || '>' order by p.email) as cuentas,
         count(*) as cantidad
    from professional_profiles pp
    join profiles p on p.id = pp.user_id
   where pp.license_number is not null and btrim(pp.license_number) <> ''
     and pp.is_verified and pp.is_active
   group by 1
  having count(*) > 1
   order by cantidad desc
`

// Informativo: cualquier par con la misma matrícula (sin exigir activo+verificado)
// o el mismo nombre normalizado — es la misma condición que pinta "Duplicado"
// en la lista del super admin, esté aprobado o no.
const SQL_MATRICULA_TODOS = `
  select regexp_replace(lower(pp.license_number), '[\\s.]', '', 'g') as matricula,
         array_agg(p.full_name || ' <' || p.email || '>' || ' (' ||
           (case when pp.is_verified then 'verificada' else 'sin verificar' end) || ', ' ||
           (case when pp.is_active then 'activa' else 'inactiva' end) || ')'
           order by p.email) as cuentas,
         count(*) as cantidad
    from professional_profiles pp
    join profiles p on p.id = pp.user_id
   where pp.license_number is not null and btrim(pp.license_number) <> ''
   group by 1
  having count(*) > 1
   order by cantidad desc
`

const SQL_NOMBRE_TODOS = `
  select lower(extensions.unaccent(btrim(regexp_replace(p.full_name, '\\s+', ' ', 'g')))) as nombre,
         array_agg(p.full_name || ' <' || p.email || '>' || ' (' ||
           (case when pp.is_verified then 'verificada' else 'sin verificar' end) || ', ' ||
           (case when pp.is_active then 'activa' else 'inactiva' end) || ')'
           order by p.email) as cuentas,
         count(*) as cantidad
    from professional_profiles pp
    join profiles p on p.id = pp.user_id
   where p.full_name is not null and btrim(p.full_name) <> ''
   group by 1
  having count(*) > 1
   order by cantidad desc
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

  console.log('\n▸ Pares ACTIVOS y VERIFICADOS con la misma matrícula (el caso peligroso)')
  let peligrosos
  try {
    peligrosos = await consultar(ref, SQL_MATRICULA_ACTIVOS_VERIFICADOS)
  } catch (e) {
    mal(`no se pudo consultar: ${e.message}`)
    return
  }
  if (peligrosos.length === 0) {
    ok('ninguno')
  } else {
    for (const p of peligrosos) mal(`matrícula "${p.matricula}" × ${p.cantidad}: ${p.cuentas.join(' · ')}`)
  }

  console.log('\n▸ Cualquier par con la misma matrícula (informativo)')
  let matriculas
  try {
    matriculas = await consultar(ref, SQL_MATRICULA_TODOS)
  } catch (e) {
    mal(`no se pudo consultar: ${e.message}`)
    return
  }
  if (matriculas.length === 0) nota('ninguno')
  else for (const p of matriculas) nota(`"${p.matricula}" × ${p.cantidad}: ${p.cuentas.join(' · ')}`)

  console.log('\n▸ Cualquier par con el mismo nombre (informativo)')
  let nombres
  try {
    nombres = await consultar(ref, SQL_NOMBRE_TODOS)
  } catch (e) {
    mal(`no se pudo consultar: ${e.message}`)
    return
  }
  if (nombres.length === 0) nota('ninguno')
  else for (const p of nombres) nota(`"${p.nombre}" × ${p.cantidad}: ${p.cuentas.join(' · ')}`)
}

const pedido = process.argv[2]
for (const [nombre, cfg] of Object.entries(ENTORNOS)) {
  if (pedido && pedido !== nombre) continue
  await revisar(nombre, cfg)
}

console.log(fallas === 0
  ? '\n✅ Ningún par activo y verificado comparte matrícula.\n'
  : `\n❌ ${fallas} par(es) activo(s) y verificado(s) con la misma matrícula.\n`)
process.exit(fallas === 0 ? 0 : 1)
