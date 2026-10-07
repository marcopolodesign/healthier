#!/usr/bin/env node
/**
 * Ninguna FK de la historia clínica hacia `profiles` puede volver a CASCADE o
 * SET NULL (migración 188).
 *
 *   node scripts/verificar-fk-de-profiles.mjs            # producción + staging
 *   node scripts/verificar-fk-de-profiles.mjs staging
 *   node scripts/verificar-fk-de-profiles.mjs produccion
 *
 * **Por qué existe.** Hasta el 2026-10-06 "Eliminar" en el super admin hacía
 * `profiles.delete()`, y las FK en CASCADE se llevaban consultas, notas,
 * documentos, planes y reseñas: parte de la historia clínica que la Ley 26.529
 * obliga a conservar 10 años. Ahora la baja es lógica y esas FK están en
 * RESTRICT, así que un DELETE de un perfil con HC falla en vez de borrarla.
 *
 * Falla (exit 1) si:
 *   1. Alguna de las FK de la lista no es RESTRICT o NO ACTION.
 *   2. Alguna FK de las tablas `clinical_*`, `payments` o `medication_orders`
 *      hacia `profiles` es CASCADE o SET NULL.
 *   3. Falta la tabla `bajas_de_usuarios`, sus funciones, o alguna quedó
 *      ejecutable por `anon`/`authenticated`.
 *
 * Sólo lee.
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const env = Object.fromEntries(
  readFileSync(join(homedir(), 'Local', '.env'), 'utf8')
    .split('\n').map(l => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2].replace(/^["']|["']$/g, '')])
)

const ENTORNOS = {
  produccion: 'aixjejdoofervrkggbkd',
  staging: 'itjhrvlzuqvyhqtffumc',
}

// Las que la 188 pasó a RESTRICT.
const PROTEGIDAS = [
  'consultations.patient_id', 'consultations.professional_id',
  'clinical_notes.patient_id', 'clinical_notes.professional_id',
  'medical_documents.patient_id',
  'diagnostic_reports.patient_id',
  'patient_followups.patient_id', 'patient_followups.professional_id',
  'nutrition_plans.patient_id', 'nutrition_plans.professional_id',
  'nutrition_plan_adherence.patient_id',
  'activity_plans.patient_id', 'activity_plans.professional_id',
  'emergencies.patient_id',
  'consultation_arrivals.patient_id', 'consultation_arrivals.professional_id',
  'emergency_tracking.patient_id', 'emergency_tracking.professional_id',
  'family_members.patient_id', 'family_members.familiar_id',
  'reviews.patient_id', 'reviews.professional_id',
  'rcta_issue_log.patient_id', 'rcta_issue_log.professional_id',
]
// Tablas enteras que tampoco pueden borrar ni anular nada.
const TABLAS_PROTEGIDAS = /^(clinical_.*|payments|medication_orders)$/

const NOMBRE = { a: 'NO ACTION', r: 'RESTRICT', c: 'CASCADE', n: 'SET NULL', d: 'SET DEFAULT' }

async function sql(ref, query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`${r.status}: ${text}`)
  return JSON.parse(text)
}

async function verificar(entorno, ref) {
  const fallas = []
  const fks = await sql(ref, `
    select c.conrelid::regclass::text as tabla, a.attname as columna, c.confdeltype as accion
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
     where c.contype = 'f' and c.confrelid = 'public.profiles'::regclass`)
  const porClave = new Map(fks.map(f => [`${f.tabla}.${f.columna}`, f.accion]))

  for (const clave of PROTEGIDAS) {
    const accion = porClave.get(clave)
    if (accion === undefined) fallas.push(`${clave}: no hay FK hacia profiles`)
    else if (!['r', 'a'].includes(accion)) fallas.push(`${clave}: ${NOMBRE[accion]} (tiene que ser RESTRICT)`)
  }
  for (const f of fks) {
    if (TABLAS_PROTEGIDAS.test(f.tabla) && ['c', 'n', 'd'].includes(f.accion)) {
      fallas.push(`${f.tabla}.${f.columna}: ${NOMBRE[f.accion]} (la historia clínica no se borra ni se anula)`)
    }
  }

  const [estructura] = await sql(ref, `
    select
      to_regclass('public.bajas_de_usuarios') is not null as tabla,
      (select relrowsecurity from pg_class where oid = to_regclass('public.bajas_de_usuarios')) as rls,
      (select count(*) from pg_policies where schemaname = 'public' and tablename = 'bajas_de_usuarios') as policies,
      has_table_privilege('authenticated', 'public.bajas_de_usuarios', 'select') as lee_authenticated,
      has_table_privilege('anon', 'public.bajas_de_usuarios', 'select') as lee_anon,
      has_function_privilege('authenticated', 'public.dar_de_baja_perfil(uuid, uuid)', 'execute') as baja_authenticated,
      has_function_privilege('anon', 'public.reactivar_perfil(uuid)', 'execute') as reactivar_anon,
      has_function_privilege('authenticated', 'public.reactivar_perfil(uuid)', 'execute') as reactivar_authenticated,
      has_function_privilege('authenticated', 'public.auth_user_por_email(text)', 'execute') as email_authenticated,
      exists (select 1 from pg_policies where tablename = 'professional_profiles'
                and policyname = 'professional_profiles_sin_bajas' and permissive = 'RESTRICTIVE') as policy_pros
  `).catch(e => [{ error: e.message }])

  if (estructura.error) fallas.push(`estructura de la 188: ${estructura.error}`)
  else {
    if (!estructura.tabla) fallas.push('falta la tabla bajas_de_usuarios')
    if (!estructura.rls) fallas.push('bajas_de_usuarios sin RLS')
    if (Number(estructura.policies) > 0) fallas.push('bajas_de_usuarios tiene policies: sólo la tiene que leer el service role')
    if (estructura.lee_authenticated || estructura.lee_anon) fallas.push('bajas_de_usuarios la puede leer un cliente')
    if (estructura.baja_authenticated || estructura.reactivar_anon || estructura.reactivar_authenticated || estructura.email_authenticated)
      fallas.push('alguna función de la 188 la puede ejecutar un cliente')
    if (!estructura.policy_pros) fallas.push('falta la policy restrictiva professional_profiles_sin_bajas')
  }

  console.log(`\n${fallas.length ? '❌' : '✅'} ${entorno}: ${PROTEGIDAS.length} FK protegidas, ${fks.length} FK hacia profiles en total`)
  for (const f of fallas) console.log(`   · ${f}`)
  return fallas.length === 0
}

const pedidos = process.argv[2] ? [process.argv[2]] : Object.keys(ENTORNOS)
let ok = true
for (const e of pedidos) {
  if (!ENTORNOS[e]) { console.error(`entorno desconocido: ${e}`); process.exit(2) }
  ok = (await verificar(e, ENTORNOS[e])) && ok
}
process.exit(ok ? 0 : 1)
