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

// ── El trigger, aislado de la RLS ─────────────────────────────────────────
// La policy del paciente es distinta en staging (estricta) y en producción
// (floja), así que probarlo por PostgREST en staging no prueba el trigger: la
// policy corta antes. Acá se corre como el dueño de la tabla (sin RLS) pero con
// la identidad del paciente en los claims, dentro de una transacción que se
// deshace: lo único que puede frenar es el trigger.
console.log('\n── Trigger proteger_despacho_emergencia (sin RLS, se deshace)')
async function sqlComo(uid, sql) {
  const claims = JSON.stringify({ sub: uid, role: 'authenticated' })
  const query = `begin; select set_config('request.jwt.claims', '${claims}', true); ${sql}; rollback;`
  const r = await fetch(`https://api.supabase.com/v1/projects/${env.HEALTHIER_STAGING_SUPABASE_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const texto = await r.text()
  return r.ok ? null : texto
}
const pac = (await como('paciente.completo@staging.healthier.app')).id
const fila = estado => `insert into emergencies (id, patient_id, triage_code, status, ambulance_id, cierre_sin_atencion)
  values ('00000000-0000-4000-8000-0000000002a1', '${pac}', 'VERDE', '${estado}', '${MOVIL}', 'control')`
// La fila se crea como servicio (claims vacíos) y el cambio con la identidad del paciente.
const comoServicio = sql => `select set_config('request.jwt.claims', '{"role":"service_role"}', true); ${sql}; select set_config('request.jwt.claims', '${JSON.stringify({ sub: pac, role: 'authenticated' })}', true)`
let e = await sqlComo(pac, `${comoServicio(fila('completed'))}; update emergencies set status='in_transit' where id='00000000-0000-4000-8000-0000000002a1'`)
esperar(e?.includes('cambiar el estado'), 'el paciente no reabre un traslado terminado')
e = await sqlComo(pac, `${comoServicio(fila('in_transit'))}; update emergencies set patient_latitude=-34.7 where id='00000000-0000-4000-8000-0000000002a1'`)
esperar(e?.includes('mientras se espera'), 'con el móvil en camino el paciente no mueve el destino')
e = await sqlComo(pac, `${comoServicio(fila('in_transit'))}; update emergencies set status='cancelled' where id='00000000-0000-4000-8000-0000000002a1'`)
esperar(!e, 'el trigger deja cancelar en camino (lo decide la policy de cada entorno)')
e = await sqlComo(pac, `insert into emergencies (patient_id, triage_code, status, ambulance_id) values ('${pac}', 'VERDE', 'dispatched', '${MOVIL}')`)
esperar(e?.includes('venir asignado'), 'el paciente no crea un pedido ya asignado')
e = await sqlComo(pac, `${comoServicio(fila('pending').replace("'control'", 'null'))}; update emergencies set status='awaiting_dispatch', triage_code='ROJO', direccion='Otra 123' where id='00000000-0000-4000-8000-0000000002a1'`)
esperar(!e, 'el paciente confirma el triage y corrige la dirección mientras espera')
const chofer2 = (await como('chofer@staging.healthier.app')).id
e = await sqlComo(chofer2, `${comoServicio(fila('dispatched').replace(`'${pac}'`, `'${pac}'`))}; select set_config('request.jwt.claims', '${JSON.stringify({ sub: chofer2, role: 'authenticated' })}', true); update emergencies set status='in_transit' where id='00000000-0000-4000-8000-0000000002a1'`)
esperar(!e, 'la tripulación del móvil mueve el estado')

console.log(fallos ? `\n❌ ${fallos} fallo(s)` : '\n✅ Todo en orden')
process.exit(fallos ? 1 : 0)
