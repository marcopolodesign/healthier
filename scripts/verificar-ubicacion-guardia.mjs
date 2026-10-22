#!/usr/bin/env node
/**
 * Control de la migración 211 (S.O.S.: dirección escrita + ubicación de la
 * flota de guardia), CONTRA LA BASE DE STAGING y con la sesión real de cada rol.
 *
 *   node scripts/verificar-ubicacion-guardia.mjs
 *
 * Chequea lo que no se ve en pantalla:
 *  1. Un tripulante publica la posición de SU móvil mientras está de guardia.
 *  2. Fuera de servicio, la base la rechaza (aunque la app vieja la mande).
 *  3. Nadie publica la de un móvil que no tripula, ni a nombre de otro.
 *  4. La hora la pone la base: un `updated_at` del futuro no pasa.
 *  5. El paciente guarda la dirección al crear el pedido y la corrige mientras
 *     espera; el despacho la lee.
 *
 * Deja todo como estaba (móvil, posición y pedido de prueba).
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const env = Object.fromEntries(
  readFileSync(join(homedir(), 'Local', '.env'), 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.trimStart().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }),
)
const URL = env.HEALTHIER_STAGING_SUPABASE_URL
const ANON = env.HEALTHIER_STAGING_SUPABASE_ANON_KEY
const admin = createClient(URL, env.HEALTHIER_STAGING_SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

let fallos = 0
const ok = m => console.log(`  ✅ ${m}`)
const mal = m => { fallos++; console.log(`  ❌ ${m}`) }
const esperar = (cond, m) => (cond ? ok(m) : mal(m))
const nota = m => console.log(`  ·  ${m}`)

async function como(email, password = 'staging') {
  const c = createClient(URL, ANON, { auth: { persistSession: false } })
  const { data, error } = await c.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`login ${email}: ${error.message}`)
  return { c, id: data.user.id }
}

const MOVIL = '40000000-0000-0000-0000-000000000003' // Móvil 3: tripula chofer@staging

const { data: antes } = await admin.from('ambulances').select('status').eq('id', MOVIL).single()
const { data: posAntes } = await admin.from('ambulance_locations').select('*').eq('ambulance_id', MOVIL).maybeSingle()

const chofer = await como('chofer@staging.healthier.app')
const clinica = await como('clinica@staging.healthier.app')
const pos = (id, extra = {}) => ({ ambulance_id: id, latitude: -34.58, longitude: -58.42, ...extra })

try {
  console.log('\n── Ubicación de la flota')
  await admin.from('ambulances').update({ status: 'disponible' }).eq('id', MOVIL)
  let r = await chofer.c.from('ambulance_locations').upsert(pos(MOVIL, { profile_id: chofer.id }), { onConflict: 'ambulance_id' })
  esperar(!r.error, `tripulante publica su móvil Disponible ${r.error ? `(${r.error.message})` : ''}`)

  r = await chofer.c.from('ambulance_locations')
    .upsert(pos(MOVIL, { profile_id: chofer.id, updated_at: '2099-01-01T00:00:00Z' }), { onConflict: 'ambulance_id' })
    .select('updated_at').single()
  esperar(!r.error && new Date(r.data.updated_at).getFullYear() < 2099, 'la hora de la posición la pone la base')

  r = await chofer.c.from('ambulance_locations').upsert(pos(MOVIL, { profile_id: clinica.id }), { onConflict: 'ambulance_id' })
  esperar(!!r.error, 'no se publica a nombre de otro tripulante')

  await admin.from('ambulances').update({ status: 'fuera_de_servicio' }).eq('id', MOVIL)
  r = await chofer.c.from('ambulance_locations').upsert(pos(MOVIL, { profile_id: chofer.id }), { onConflict: 'ambulance_id' })
  esperar(!!r.error, 'fuera de servicio la base rechaza la posición')

  const { data: crewOtro } = await admin.from('ambulance_crew').select('profile_id').eq('ambulance_id', MOVIL).eq('profile_id', clinica.id).eq('active', true)
  if (!crewOtro?.length) {
    await admin.from('ambulances').update({ status: 'disponible' }).eq('id', MOVIL)
    r = await clinica.c.from('ambulance_locations').upsert(pos(MOVIL, { profile_id: clinica.id }), { onConflict: 'ambulance_id' })
    esperar(!!r.error, 'quien no tripula el móvil no publica su posición')
  }

  console.log('\n── Dirección escrita del pedido')
  const paciente = await como('paciente.completo@staging.healthier.app')
  r = await paciente.c.from('emergencies').insert({
    patient_id: paciente.id, triage_code: 'VERDE', status: 'pending',
    patient_latitude: -34.5628, patient_longitude: -58.4566,
    direccion: 'Av. Cabildo 2040, Belgrano', direccion_piso: '4 B', direccion_referencias: 'Timbre 4B',
    gps_latitude: -34.5429, gps_longitude: -58.4618, ubicacion_origen: 'direccion',
  }).select('id').single()
  esperar(!r.error, `el paciente crea el pedido con la dirección ${r.error ? `(${r.error.message})` : ''}`)
  const id = r.data?.id
  if (id) {
    r = await paciente.c.from('emergencies').update({ direccion_piso: '5 C' }).eq('id', id).select('direccion_piso').single()
    esperar(r.data?.direccion_piso === '5 C', 'la corrige mientras espera')
    r = await paciente.c.from('emergencies').insert({
      patient_id: paciente.id, triage_code: 'VERDE', status: 'pending', ubicacion_origen: 'otro',
    })
    esperar(!!r.error, 'ubicacion_origen sólo acepta gps/direccion')
    r = await paciente.c.from('emergencies').insert({
      patient_id: paciente.id, triage_code: 'VERDE', status: 'pending', direccion_referencias: 'x'.repeat(501),
    })
    esperar(!!r.error, 'las referencias tienen tope de 500 caracteres')
    // Revisión de seguridad: el paciente no se asigna un móvil para seguirlo.
    r = await paciente.c.from('emergencies').update({ ambulance_id: MOVIL }).eq('id', id).select('id')
    esperar(!!r.error || !r.data?.length, 'el paciente no se asigna un móvil en su pedido')
    r = await paciente.c.from('emergencies').insert({
      patient_id: paciente.id, triage_code: 'VERDE', status: 'in_transit', ambulance_id: MOVIL,
    })
    esperar(!!r.error, 'el paciente no crea un pedido ya despachado con un móvil')
    if (!r.error) await admin.from('emergencies').delete().eq('patient_id', paciente.id).eq('status', 'in_transit')
    // Un traslado suyo terminado no se reabre, y en camino no se mueve el destino.
    const { data: viejo } = await admin.from('emergencies').insert({
      patient_id: paciente.id, triage_code: 'VERDE', status: 'completed', ambulance_id: MOVIL,
      cierre_sin_atencion: 'control verificar-ubicacion-guardia',
    }).select('id').single()
    r = await paciente.c.from('emergencies').update({ status: 'in_transit' }).eq('id', viejo.id).select('id')
    esperar(!!r.error || !r.data?.length, 'el paciente no reabre un traslado terminado')
    await admin.from('emergencies').update({ status: 'in_transit' }).eq('id', viejo.id)
    r = await paciente.c.from('emergencies').update({ patient_latitude: -34.7 }).eq('id', viejo.id).select('id')
    esperar(!!r.error || !r.data?.length, 'con el móvil en camino el paciente no mueve el destino')
    r = await paciente.c.from('emergencies').update({ status: 'cancelled' }).eq('id', viejo.id).select('id')
    nota(`cancelar en camino: ${r.error || !r.data?.length ? 'no' : 'sí'} (lo decide la policy de cada entorno)`)
    await admin.from('emergencies').delete().eq('id', viejo.id)
    const despacho = await como('despacho@staging.healthier.app')
    r = await despacho.c.from('emergencies').select('direccion, direccion_piso').eq('id', id).maybeSingle()
    esperar(r.data?.direccion === 'Av. Cabildo 2040, Belgrano', 'el despacho lee la dirección')
    await admin.from('emergencies').delete().eq('id', id)
  }
} finally {
  await admin.from('ambulances').update({ status: antes.status }).eq('id', MOVIL)
  if (posAntes) {
    await admin.from('ambulance_locations').upsert(posAntes, { onConflict: 'ambulance_id' })
  } else {
    await admin.from('ambulance_locations').delete().eq('ambulance_id', MOVIL)
  }
}

console.log(fallos ? `\n❌ ${fallos} fallo(s)` : '\n✅ Todo en orden')
process.exit(fallos ? 1 : 0)
