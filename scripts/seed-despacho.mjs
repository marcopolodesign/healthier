#!/usr/bin/env node
/**
 * Siembra el despacho de emergencias en STAGING: la entidad, sus dos cuentas
 * (admin y operador), una flota de tres móviles con tripulación, y una
 * posición para cada uno alrededor de Buenos Aires.
 *
 * Sin esto la consola de despacho abre vacía y no hay forma de probar el
 * circuito completo — que es justamente lo que hay que mirar antes de mandarlo
 * a producción.
 *
 *   node scripts/seed-despacho.mjs
 *
 * 🔴 Sólo staging. Las cuentas son de prueba y la password es la misma que el
 * resto de las de staging ('staging'), que es una base aislada.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

function leerEnvGlobal() {
  const txt = readFileSync(join(homedir(), 'Local', '.env'), 'utf8')
  return Object.fromEntries(
    txt.split('\n')
      .filter(l => l.includes('=') && !l.trimStart().startsWith('#'))
      .map(l => {
        const i = l.indexOf('=')
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
      }),
  )
}

const env = leerEnvGlobal()
const db = createClient(
  env.HEALTHIER_STAGING_SUPABASE_URL,
  env.HEALTHIER_STAGING_SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
)

const PASSWORD = 'staging'
const ENTIDAD_ID = '20000000-0000-0000-0000-000000000001'

const CUENTAS = [
  { id: '30000000-0000-0000-0000-000000000001', email: 'despacho@staging.healthier.app',  nombre: 'Macarena Despacho', role: 'emergency_admin' },
  { id: '30000000-0000-0000-0000-000000000002', email: 'operador@staging.healthier.app',  nombre: 'Operador de Guardia', role: 'emergency_operator' },
  // El chofer no es un profesional con matrícula, pero sí es quien lleva el
  // teléfono que reporta dónde está el móvil. Por eso tiene cuenta, y por eso
  // tiene rol propio (`emergency_crew`, migración 160): con rol 'patient' el
  // despacho no podía ni ver su nombre en la tripulación.
  { id: '30000000-0000-0000-0000-000000000003', email: 'chofer@staging.healthier.app',    nombre: 'Rubén Chofer',      role: 'emergency_crew' },
]

// Posiciones reales de referencia en CABA — no sirve que estén todas juntas:
// lo que hay que poder mirar es justamente que una está lejos.
const MOVILES = [
  { id: '40000000-0000-0000-0000-000000000001', label: 'Móvil 1', plate: 'AE 123 BC', unit_type: 'uti_movil',    status: 'disponible',  lat: -34.5875, lng: -58.3974 }, // Recoleta
  { id: '40000000-0000-0000-0000-000000000002', label: 'Móvil 2', plate: 'AF 456 DE', unit_type: 'movil_medico', status: 'disponible',  lat: -34.6083, lng: -58.3712 }, // Puerto Madero
  { id: '40000000-0000-0000-0000-000000000003', label: 'Móvil 3', plate: 'AG 789 FG', unit_type: 'traslado',     status: 'fuera_de_servicio', lat: -34.6534, lng: -58.4821 }, // Mataderos
]

async function crearCuentas() {
  for (const c of CUENTAS) {
    const { error } = await db.auth.admin.createUser({
      id: c.id,
      email: c.email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { role: c.role, full_name: c.nombre },
    })
    if (error && !/already/i.test(error.message)) throw new Error(`${c.email}: ${error.message}`)

    // El trigger de alta escribe `profiles` con role 'patient': el rol real se
    // pisa acá, igual que hace seed-staging con los profesionales.
    const { error: perfilErr } = await db.from('profiles')
      .upsert({ id: c.id, email: c.email, full_name: c.nombre, role: c.role }, { onConflict: 'id' })
    if (perfilErr) throw new Error(`perfil ${c.email}: ${perfilErr.message}`)
  }
  console.log(`👥 ${CUENTAS.length} cuentas de despacho`)
}

async function sembrarEntidad() {
  const { error } = await db.from('emergency_providers').upsert({
    id: ENTIDAD_ID,
    name: 'Emergencias Healthier',
    legal_name: 'Emergencias Healthier MVP',
    color: '#DC2626',
    dispatch_phone: '+541155550100',
    phone: '+541155550100',
    address: 'Av. Santa Fe 1234, CABA',
    active: true,
  }, { onConflict: 'id' })
  if (error) throw new Error(`entidad: ${error.message}`)

  for (const c of CUENTAS.filter(c => c.role.startsWith('emergency_'))) {
    const { error: staffErr } = await db.from('emergency_provider_staff')
      .upsert({ provider_id: ENTIDAD_ID, profile_id: c.id, active: true }, { onConflict: 'provider_id,profile_id' })
    if (staffErr) throw new Error(`staff ${c.email}: ${staffErr.message}`)
  }
  console.log('🏥 entidad + staff')
}

async function sembrarFlota() {
  // Un médico de verdad para tripular: el que ya siembra seed-staging.
  const { data: medicos } = await db.from('profiles')
    .select('id, full_name').eq('role', 'professional').limit(2)

  for (const [i, m] of MOVILES.entries()) {
    const { error } = await db.from('ambulances').upsert({
      id: m.id, provider_id: ENTIDAD_ID, label: m.label, plate: m.plate,
      unit_type: m.unit_type, status: m.status, active: true,
    }, { onConflict: 'id' })
    if (error) throw new Error(`${m.label}: ${error.message}`)

    // Tripulación: un médico (si hay) en los dos primeros, y el chofer en todos.
    const tripulantes = []
    const medico = medicos?.[i]
    if (medico) tripulantes.push({ profile_id: medico.id, crew_role: 'medico' })
    tripulantes.push({ profile_id: CUENTAS[2].id, crew_role: 'chofer' })

    for (const t of tripulantes) {
      const { data: ya } = await db.from('ambulance_crew')
        .select('id').eq('ambulance_id', m.id).eq('profile_id', t.profile_id).eq('active', true).maybeSingle()
      if (ya) continue
      const { error: crewErr } = await db.from('ambulance_crew')
        .insert({ ambulance_id: m.id, ...t })
      if (crewErr) throw new Error(`tripulación ${m.label}: ${crewErr.message}`)
    }

    // El Móvil 3 queda SIN posición a propósito: es el caso que hay que poder
    // ver en el mapa como "sin posición reciente" y no como un punto en vivo.
    if (m.status !== 'fuera_de_servicio') {
      const { error: locErr } = await db.from('ambulance_locations').upsert({
        ambulance_id: m.id, profile_id: CUENTAS[2].id,
        latitude: m.lat, longitude: m.lng, updated_at: new Date().toISOString(),
      }, { onConflict: 'ambulance_id' })
      if (locErr) throw new Error(`ubicación ${m.label}: ${locErr.message}`)
    }
  }
  console.log(`🚑 ${MOVILES.length} móviles con tripulación`)
}

await crearCuentas()
await sembrarEntidad()
await sembrarFlota()

console.log('\n✅ Despacho sembrado en staging')
for (const c of CUENTAS) console.log(`   ${c.email} / ${PASSWORD}  (${c.role})`)
