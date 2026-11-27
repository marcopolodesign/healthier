#!/usr/bin/env node
/**
 * Control de la migración 257 — mover un turno se valida en la base. SÓLO STAGING.
 *
 *   node scripts/verificar-turno-validado.mjs
 *
 * Intenta, con la sesión real del paciente, los atajos que la base tiene que
 * rechazar, y falla si alguno pasa:
 *   · mover el turno fuera de la agenda, a un minuto que no es slot, al pasado
 *     o encima de otro turno del mismo profesional;
 *   · cambiarle el precio, el profesional, la modalidad o marcarlo inmediata.
 * Y comprueba que lo legítimo siga andando:
 *   · el paciente lo mueve a un horario libre de la agenda;
 *   · guardar el precio sin cambiarlo (un patch completo) no rompe;
 *   · el profesional lo mueve fuera de su grilla (es su agenda) pero no al
 *     pasado ni encima de otro turno;
 *   · el super admin lo mueve a donde quiera.
 *
 * Crea dos consultas de prueba entre las cuentas demo de staging
 * (paciente@ / profesional@healthier.app) y las borra al final.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const leerEnv = (ruta) => {
  try {
    return Object.fromEntries(
      readFileSync(ruta, 'utf8').split('\n')
        .filter(l => l.includes('=') && !l.trimStart().startsWith('#'))
        .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }),
    )
  } catch { return {} }
}
const env = {
  ...leerEnv(join(homedir(), 'Local', 'Healthier', 'website', '.env')),
  ...leerEnv(join(homedir(), 'Local', 'Healthier', '.env')),
  ...leerEnv(join(homedir(), 'Local', '.env')),
}

const URL = env.HEALTHIER_STAGING_SUPABASE_URL
const ANON = env.HEALTHIER_STAGING_SUPABASE_ANON_KEY
const SERVICE = env.HEALTHIER_STAGING_SUPABASE_SERVICE_ROLE_KEY
if (!URL || !SERVICE || !ANON) { console.error('Faltan HEALTHIER_STAGING_* en ~/Local/.env'); process.exit(1) }
if (URL.includes('aixjejdoofervrkggbkd')) { console.error('Esto es producción. Sólo staging.'); process.exit(1) }

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } })

let fallos = 0
const ok = m => console.log(`  ✅ ${m}`)
const mal = m => { fallos++; console.log(`  ❌ ${m}`) }
const nota = m => console.log(`  ·  ${m}`)
const bloque = t => console.log(`\n── ${t}`)

async function sesion(email) {
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (error) throw new Error(`magic link ${email}: ${error.message}`)
  const c = createClient(URL, ANON, { auth: { persistSession: false } })
  const { data: s, error: e2 } = await c.auth.verifyOtp({ token_hash: data.properties.hashed_token, type: 'magiclink' })
  if (e2) throw new Error(`sesión ${email}: ${e2.message}`)
  return { c, id: s.user.id }
}

// Hora de Buenos Aires (UTC-3, sin horario de verano) → ISO.
const ar = (fecha, hhmm) => new Date(`${fecha}T${hhmm}:00-03:00`).toISOString()
const dia = (n) => {
  const d = new Date(Date.now() + n * 86400_000 - 3 * 3600_000)
  return d.toISOString().slice(0, 10)
}
const diaHabil = (desde) => {
  for (let n = desde; ; n++) {
    const dow = new Date(`${dia(n)}T12:00:00-03:00`).getUTCDay()
    if (dow >= 1 && dow <= 5) return dia(n)
  }
}

const creadas = []
try {
  const paciente = await sesion('paciente@healthier.app')
  const profesional = await sesion('profesional@healthier.app')
  const superadmin = await sesion('superadmin@healthier.app')
  const proId = profesional.id
  const { data: otroPro } = await admin.from('profiles').select('id')
    .eq('role', 'professional').neq('id', proId).limit(1).single()

  // Tres slots libres de la agenda (lun–vie 9–13), en un día que no tenga
  // consultas vivas del profesional demo.
  let fecha
  for (let n = 9 + Math.floor(Math.random() * 20); ; n++) {
    fecha = diaHabil(n)
    const { count } = await admin.from('consultations').select('id', { count: 'exact', head: true })
      .eq('professional_id', proId).in('status', ['pending', 'confirmed', 'in_progress'])
      .gte('scheduled_at', ar(fecha, '00:00')).lt('scheduled_at', ar(fecha, '23:59'))
    if (!count) break
  }
  const S1 = ar(fecha, '10:00'), S2 = ar(fecha, '10:15'), S3 = ar(fecha, '11:30')
  nota(`día de prueba ${fecha}`)

  const crear = async (scheduled_at) => {
    const { data, error } = await admin.from('consultations').insert({
      patient_id: paciente.id, professional_id: proId, status: 'confirmed', modality: 'video',
      scheduled_at, payment_status: 'exempt', price_at_booking: 1000,
      mail_reserva_enviado_at: new Date().toISOString(),
    }).select('id').single()
    if (error) throw new Error(`no se pudo crear la consulta de prueba: ${error.message}`)
    creadas.push(data.id)
    return data.id
  }
  const A = await crear(S1)
  await crear(S2) // la que ocupa S2
  const fila = async () => (await admin.from('consultations')
    .select('scheduled_at, price_at_booking, professional_id, modality, is_on_demand').eq('id', A).single()).data
  const antes = await fila()

  /** Un UPDATE que la base tiene que rechazar: error y fila intacta. */
  const rechaza = async (quien, rol, que, patch) => {
    const { data, error } = await quien.c.from('consultations').update(patch).eq('id', A).select('id')
    const despues = await fila()
    const intacta = JSON.stringify(despues) === JSON.stringify(antesDe)
    if (error && intacta) ok(`${rol} · ${que} → rechazado: "${error.message}"`)
    else if (!error && !data?.length && intacta) ok(`${rol} · ${que} → no tocó filas`)
    else mal(`${rol} · ${que} → LA BASE LO ACEPTÓ (${JSON.stringify(despues)})`)
  }
  const acepta = async (quien, rol, que, patch, esperado) => {
    const { error } = await quien.c.from('consultations').update(patch).eq('id', A)
    const despues = await fila()
    if (error) mal(`${rol} · ${que} → rechazado y no debía: ${error.message}`)
    else if (esperado && new Date(despues.scheduled_at).getTime() !== new Date(esperado).getTime()) mal(`${rol} · ${que} → no quedó guardado`)
    else ok(`${rol} · ${que} → aceptado`)
    antesDe = despues
  }
  let antesDe = antes

  bloque('Paciente intenta saltearse la validación')
  await rechaza(paciente, 'paciente', 'fuera de la agenda (03:00)', { scheduled_at: ar(fecha, '03:00') })
  await rechaza(paciente, 'paciente', 'minuto que no es slot (10:07)', { scheduled_at: ar(fecha, '10:07') })
  await rechaza(paciente, 'paciente', 'en el pasado', { scheduled_at: ar(dia(-1), '10:00') })
  await rechaza(paciente, 'paciente', 'encima de otro turno', { scheduled_at: S2 })
  await rechaza(paciente, 'paciente', 'precio a $1', { price_at_booking: 1 })
  await rechaza(paciente, 'paciente', 'otro profesional', { professional_id: otroPro.id })
  await rechaza(paciente, 'paciente', 'marcarla inmediata', { is_on_demand: true })
  await rechaza(paciente, 'paciente', 'cambiar la modalidad', { modality: 'presencial' })

  bloque('Paciente, lo legítimo')
  await acepta(paciente, 'paciente', 'mover a un horario libre de la agenda', { scheduled_at: S3 }, S3)
  await acepta(paciente, 'paciente', 'patch con el precio sin cambiar', { price_at_booking: 1000 })

  bloque('Profesional (dueño de la agenda)')
  const fueraDeGrilla = ar(fecha, '20:00')
  await acepta(profesional, 'profesional', 'mover fuera de su grilla', { scheduled_at: fueraDeGrilla }, fueraDeGrilla)
  await rechaza(profesional, 'profesional', 'encima de otro turno suyo', { scheduled_at: S2 })
  await rechaza(profesional, 'profesional', 'en el pasado', { scheduled_at: ar(dia(-1), '10:00') })
  await rechaza(profesional, 'profesional', 'precio a $1', { price_at_booking: 1 })

  bloque('Super admin')
  const madrugada = ar(fecha, '03:00')
  await acepta(superadmin, 'super admin', 'mover a cualquier hora', { scheduled_at: madrugada }, madrugada)
} catch (e) {
  mal(e.message)
} finally {
  if (creadas.length) {
    await admin.from('email_log').delete().in('consultation_id', creadas)
    await admin.from('consultations').delete().in('id', creadas)
    nota('consultas de prueba borradas')
  }
}

console.log(fallos ? `\n❌ ${fallos} fallo(s)` : '\n✅ todo bien')
process.exit(fallos ? 1 : 0)
