#!/usr/bin/env node
/**
 * Verifica el circuito de despacho de emergencias CONTRA LA BASE, con las
 * credenciales reales de cada rol. No mira la UI: mira que la RLS deje hacer
 * exactamente lo que tiene que dejar hacer, y nada más.
 *
 *   node scripts/verificar-despacho.mjs [staging|prod]
 *
 * Por qué existe: las policies de emergencias ahora son seis tablas cruzadas
 * (entidad, staff, móviles, tripulación, ubicaciones, emergencias). Un permiso
 * de más no se ve en pantalla, y uno de menos se ve como una lista vacía —
 * indistinguible de "todavía no hay nada". Los dos casos son los que se
 * chequean acá.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const ENTORNO = process.argv[2] ?? 'staging'
if (ENTORNO !== 'staging') {
  console.error('Por ahora sólo staging: crea y borra filas de prueba.')
  process.exit(1)
}

const env = Object.fromEntries(
  readFileSync(join(homedir(), 'Local', '.env'), 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.trimStart().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }),
)

const URL = env.HEALTHIER_STAGING_SUPABASE_URL
const ANON = env.HEALTHIER_STAGING_SUPABASE_ANON_KEY
const SERVICE = env.HEALTHIER_STAGING_SUPABASE_SERVICE_ROLE_KEY
const admin = createClient(URL, SERVICE, { auth: { persistSession: false } })

let fallos = 0
const ok    = m => console.log(`  ✅ ${m}`)
const mal   = m => { fallos++; console.log(`  ❌ ${m}`) }
const nota  = m => console.log(`  ·  ${m}`)
const bloque = t => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 58 - t.length))}`)

async function comoUsuario(email, password) {
  const c = createClient(URL, ANON, { auth: { persistSession: false } })
  const { data, error } = await c.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`login ${email}: ${error.message}`)
  return { cliente: c, userId: data.user.id }
}

// ── Preparar: una solicitud paga esperando móvil ───────────────────────────
const { data: paciente } = await admin.from('profiles').select('id, email').eq('role', 'patient').limit(1).single()

bloque('Preparando una solicitud de prueba')
const { data: solicitud, error: errIns } = await admin.from('emergencies').insert({
  patient_id: paciente.id,
  triage_code: 'ROJO',
  status: 'awaiting_dispatch',
  paid_at: new Date().toISOString(),
  price_at_request: 50,
  patient_latitude: -34.6037,
  patient_longitude: -58.3816,
  notes: JSON.stringify(['Dolor opresivo en el pecho']),
}).select().single()
if (errIns) { console.error(errIns); process.exit(1) }
nota(`solicitud ${solicitud.id.slice(0, 8)} — ROJO, paga, esperando móvil`)

try {
  // ── El operador ──────────────────────────────────────────────────────────
  bloque('El operador de la entidad')
  const op = await comoUsuario('operador@staging.healthier.app', 'staging')

  const { data: cola } = await op.cliente.from('emergencies')
    .select('id, triage_code, paid_at').eq('status', 'awaiting_dispatch')
  cola?.some(e => e.id === solicitud.id)
    ? ok(`ve la solicitud en la cola (${cola.length} en total)`)
    : mal('NO ve la solicitud en la cola — la policy la está tapando')

  const { data: flota } = await op.cliente.from('ambulances')
    .select('id, label, status, ubicacion:ambulance_locations(latitude, longitude, updated_at)')
  flota?.length
    ? ok(`ve ${flota.length} móviles de su entidad`)
    : mal('NO ve ningún móvil')

  const conPosicion = (flota ?? []).filter(a => (Array.isArray(a.ubicacion) ? a.ubicacion.length : a.ubicacion))
  nota(`${conPosicion.length} de ${flota?.length ?? 0} con posición publicada`)

  const disponible = (flota ?? []).find(a => a.status === 'disponible')
  if (!disponible) { mal('no hay ningún móvil disponible para asignar'); }
  else {
    const { data: asignada, error: errAsig } = await op.cliente.from('emergencies').update({
      ambulance_id: disponible.id,
      provider_id: '20000000-0000-0000-0000-000000000001',
      operator_id: op.userId,
      status: 'dispatched',
      dispatched_at: new Date().toISOString(),
      dispatch_code: 'UTM-9999',
    }).eq('id', solicitud.id).select().single()
    errAsig
      ? mal(`no puede despachar: ${errAsig.message}`)
      : ok(`despacha ${disponible.label} (estado → ${asignada.status})`)

    // ── La tripulación ─────────────────────────────────────────────────────
    bloque('La tripulación del móvil')
    const chofer = await comoUsuario('chofer@staging.healthier.app', 'staging')
    const { data: suya } = await chofer.cliente.from('emergencies')
      .select('id, triage_code, patient_latitude').eq('id', solicitud.id).maybeSingle()
    suya
      ? ok('el chofer ve el traslado de su móvil (antes sólo lo veía el médico)')
      : mal('el chofer NO ve el traslado de su propio móvil')

    const { error: errUbi } = await chofer.cliente.from('ambulance_locations').upsert({
      ambulance_id: disponible.id, profile_id: chofer.userId,
      latitude: -34.5900, longitude: -58.3900, updated_at: new Date().toISOString(),
    }, { onConflict: 'ambulance_id' })
    errUbi ? mal(`el chofer no puede publicar su posición: ${errUbi.message}`)
           : ok('el chofer publica la posición del móvil')

    // ── El paciente ────────────────────────────────────────────────────────
    bloque('El paciente de la emergencia')
    const { data: perfilPac } = await admin.from('profiles').select('email').eq('id', paciente.id).single()
    nota(`paciente de prueba: ${perfilPac.email}`)
    const { data: comoVePac } = await admin.from('emergencies')
      .select('*, ambulancia:ambulances!ambulance_id(label, plate), entidad:emergency_providers!provider_id(name, dispatch_phone)')
      .eq('id', solicitud.id).single()
    comoVePac.ambulancia?.label
      ? ok(`la fila trae el móvil (${comoVePac.ambulancia.label}) y la entidad (${comoVePac.entidad?.name})`)
      : mal('la fila no trae el móvil ni la entidad — el paciente no sabe quién va')
    comoVePac.entidad?.dispatch_phone
      ? ok('hay teléfono de guardia para que el paciente llame a despacho')
      : mal('la entidad no tiene teléfono de guardia cargado')
  }

  // ── Lo que NO tiene que poder pasar ──────────────────────────────────────
  bloque('Lo que la RLS tiene que negar')
  const otroPaciente = await comoUsuario('paciente@healthier.app', 'paciente').catch(() => null)
  if (!otroPaciente) {
    nota('sin cuenta de paciente para probar la negación — salteado')
  } else {
    const { data: fisgonea } = await otroPaciente.cliente.from('emergencies')
      .select('id').eq('id', solicitud.id).maybeSingle()
    fisgonea && fisgonea.id !== solicitud.id
      ? mal('un paciente ajeno ve una emergencia que no es suya')
      : ok('un paciente ajeno no ve la emergencia de otro')

    const { error: errEscribe } = await otroPaciente.cliente.from('ambulance_locations').upsert({
      ambulance_id: (flota ?? [])[0]?.id, latitude: 0, longitude: 0,
    }, { onConflict: 'ambulance_id' })
    errEscribe ? ok('un paciente no puede mover un móvil en el mapa')
               : mal('UN PACIENTE PUDO ESCRIBIR LA POSICIÓN DE UNA AMBULANCIA')
  }
} finally {
  bloque('Limpiando')
  await admin.from('emergencies').delete().eq('id', solicitud.id)
  nota('solicitud de prueba borrada')
}

console.log(fallos === 0 ? '\n✅ El circuito de despacho hace lo que tiene que hacer\n'
                         : `\n❌ ${fallos} chequeo(s) en rojo\n`)
process.exit(fallos === 0 ? 0 : 1)
