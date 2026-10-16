#!/usr/bin/env node
/**
 * Chequeo de `profiles.es_extranjero` (migración 201).
 *
 *   node scripts/verificar-es-extranjero.mjs            # staging + producción
 *   node scripts/verificar-es-extranjero.mjs staging    # sólo staging
 *   node scripts/verificar-es-extranjero.mjs produccion # sólo producción
 *
 * Qué controla (sólo lee, no escribe nada):
 *   1. La regla, con casos fijos: DNI > 90.000.000 → true; argentino → false;
 *      sin documento o largo raro → NULL (no false); separadores y el prefijo
 *      "DNI" no cambian nada; CUIT/CUIL se mira por el DNI del medio.
 *   2. Que la columna sea GENERADA (si alguien la cambia a una columna común,
 *      vuelve a depender del front y se desfasa en silencio).
 *   3. Que ninguna fila quedó con un valor viejo (pasa si se cambia la función
 *      sin recalcular — ver el comentario de la 201).
 *   4. Que Customer.io (`cio.people`) reciba `es_extranjero` y que
 *      `documento_extranjero` diga lo mismo.
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const env = Object.fromEntries(
  readFileSync(join(homedir(), 'Local', '.env'), 'utf8')
    .split('\n').map(l => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2]])
)

const ENTORNOS = {
  staging:    { ref: 'itjhrvlzuqvyhqtffumc' },
  produccion: { ref: 'aixjejdoofervrkggbkd' },
}

const CASOS = [
  [null, null], ['', null], ['   ', null],
  ['12345678', false], ['12.345.678', false], ['90000000', false],
  ['90000001', true], ['94.123.456', true], ['95 123 456', true],
  ['AB123456', true], ['12,345,678', false], ['DNI 12345678', false],
  ['20-12345678-9', false], ['20-94123456-3', true],
  ['123456789', null], ['123.456.789-09', null],
]

async function sql(ref, query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const body = await r.json()
  if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(body)}`)
  return body
}

const lit = v => (v === null ? 'null' : `'${v.replace(/'/g, "''")}'`)

async function chequear(nombre, { ref }) {
  const fallas = []

  const valores = CASOS.map(([dni]) => `${lit(dni)}::text`).join(',')
  const filas = await sql(ref, `
    select public.documento_es_extranjero(d) as r
      from unnest(array[${valores}]) with ordinality v(d, ord)
     order by ord`)
  CASOS.forEach(([dni, esperado], i) => {
    if (filas[i]?.r !== esperado) fallas.push(`regla: ${JSON.stringify(dni)} dio ${filas[i]?.r}, se esperaba ${esperado}`)
  })

  const [col] = await sql(ref, `
    select is_generated from information_schema.columns
     where table_schema = 'public' and table_name = 'profiles' and column_name = 'es_extranjero'`)
  if (!col) fallas.push('falta la columna profiles.es_extranjero')
  else if (col.is_generated !== 'ALWAYS') fallas.push('profiles.es_extranjero dejó de ser columna generada')

  const [viejas] = await sql(ref, `
    select count(*)::int as n from public.profiles
     where es_extranjero is distinct from public.documento_es_extranjero(dni)`)
  if (viejas.n > 0) fallas.push(`${viejas.n} filas con es_extranjero desactualizado (correr: update public.profiles set es_extranjero = default where dni is not null — nunca set dni = dni)`)

  // Lo que lee Customer.io: la columna existe, cio_reader la puede leer, y
  // trae lo mismo que profiles (que la vista no la saque de otro lado).
  const [cio] = await sql(ref, `
    select has_column_privilege('cio_reader', 'cio.people', 'es_extranjero', 'select') as puede,
           (select count(*)::int from cio.people c join public.profiles p using (id)
             where c.es_extranjero is distinct from p.es_extranjero
                or c.documento_extranjero is distinct from p.es_extranjero) as distintas`)
    .catch(e => [{ error: e.message }])
  if (cio.error) fallas.push(`cio.people sin es_extranjero: ${cio.error.slice(0, 120)}`)
  else if (!cio.puede) fallas.push('cio_reader no puede leer cio.people.es_extranjero')
  else if (cio.distintas > 0) fallas.push(`cio.people: ${cio.distintas} filas que no coinciden con profiles.es_extranjero`)

  console.log(fallas.length ? `✗ ${nombre}` : `✓ ${nombre} — regla, columna generada, filas al día y cio.people`)
  fallas.forEach(f => console.log(`   · ${f}`))
  return fallas.length === 0
}

const pedidos = process.argv[2] ? [process.argv[2]] : Object.keys(ENTORNOS)
let ok = true
for (const n of pedidos) {
  if (!ENTORNOS[n]) { console.error(`Entorno desconocido: ${n}`); process.exit(2) }
  const bien = await chequear(n, ENTORNOS[n]).catch(e => {
    console.log(`✗ ${n} — ${e.message.includes('does not exist') ? 'la migración 201 no está aplicada' : e.message.slice(0, 200)}`)
    return false
  })
  ok = bien && ok
}
process.exit(ok ? 0 : 1)
