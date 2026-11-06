#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// ¿cio.people dice lo mismo que la app sobre el registro del paciente?
// (migración 234, pedido de Hyppo 2026-11-06)
//
// Para cada paciente de cio.people que pasa por el registro guiado
// (requiere_onboarding = true) recalcula con completitudPaciente() de
// src/lib/pacienteOnboarding.js —la misma función que usa el wizard— y compara
// signup_completo y signup_paso_faltante. Si alguien cambia los pasos en la app
// y no en la vista (o al revés), esto falla.
//
//   node scripts/verificar-cio-signup.mjs staging
//   node scripts/verificar-cio-signup.mjs produccion
//
// Sólo lee. Exit 1 si hay alguna diferencia.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { completitudPaciente } from '../src/lib/pacienteOnboarding.js'

const env = {}
for (const l of readFileSync(path.join(homedir(), 'Local/.env'), 'utf8').split('\n')) {
  const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l)
  if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
}
const entorno = process.argv[2]
const REF = entorno === 'staging' ? env.HEALTHIER_STAGING_SUPABASE_REF : entorno === 'produccion' ? 'aixjejdoofervrkggbkd' : null
if (!REF) { console.error('uso: verificar-cio-signup.mjs <staging|produccion>'); process.exit(1) }

const query = async sql => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
  return r.json()
}

// Texto de signup_paso_faltante para cada chip de completitudPaciente.
const PASO = {
  'Sin consentimiento': 'aceptar el consentimiento',
  'Sin DNI': 'cargar tu DNI',
  'Sin sexo': 'cargar tu sexo',
  'Sin fecha de nacimiento': 'cargar tu fecha de nacimiento',
  'Sin cobertura': 'cargar tu cobertura médica',
}

const filas = await query(`
  select c.id, c.signup_completo, c.signup_paso_faltante,
         p.dni, p.gender, p.birth_date, p.coverage_type, p.financiador_id, p.consentimiento_at
    from cio.people c join public.profiles p on p.id = c.id
   where c.role = 'patient' and p.requiere_onboarding is true`)

let fallas = 0
for (const f of filas) {
  const c = completitudPaciente({
    dni: f.dni, gender: f.gender, birthDate: f.birth_date, coverageType: f.coverage_type,
    financiadorId: f.financiador_id, consentimientoAt: f.consentimiento_at,
  })
  const completo = c.obligatoriosCompletos
  const paso = completo ? null : PASO[c.faltan[0]]
  if (f.signup_completo !== completo || f.signup_paso_faltante !== paso) {
    fallas++
    console.log(`✗ ${f.id}: vista=${f.signup_completo}/${f.signup_paso_faltante} app=${completo}/${paso}`)
  }
}
console.log(`${filas.length} pacientes del registro guiado en ${entorno} · ${fallas} diferencias`)
process.exit(fallas ? 1 : 0)
