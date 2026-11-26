#!/usr/bin/env node
/**
 * Control del turno reprogramado (migración 255) — SÓLO STAGING.
 *
 *   node scripts/verificar-reprogramacion.mjs
 *
 * Lo que tiene que seguir siendo cierto:
 *
 *   1. Si el super admin le cambia la fecha a un turno vivo, sale el mail
 *      `reprogramada` (fila en `email_log` para el paciente y el profesional) y
 *      la sala de video vieja queda limpia (`daily_room_url/name` en NULL).
 *   2. Si el que cambia la fecha es el paciente, no sale ningún mail.
 *   3. Guardar el turno desde el admin sin tocar la fecha (mismo minuto) no
 *      manda nada.
 *
 * Crea una consulta de prueba entre las cuentas demo de staging
 * (paciente@ / profesional@healthier.app), con una sala inventada, y la borra
 * al final junto con sus filas de `email_log`.
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
const esperar = ms => new Promise(r => setTimeout(r, ms))

async function sesion(email) {
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (error) throw new Error(`magic link ${email}: ${error.message}`)
  const c = createClient(URL, ANON, { auth: { persistSession: false } })
  const { data: s, error: e2 } = await c.auth.verifyOtp({ token_hash: data.properties.hashed_token, type: 'magiclink' })
  if (e2) throw new Error(`sesión ${email}: ${e2.message}`)
  return { c, id: s.user.id }
}

/** Mails `reprogramada` de la consulta. Espera hasta `hasta` filas o `ms`. */
async function mails(id, { hasta = 0, ms = 0 } = {}) {
  const fin = Date.now() + ms
  for (;;) {
    const { data } = await admin.from('email_log')
      .select('destinatario, estado, asunto, error')
      .eq('consultation_id', id).eq('tipo', 'reprogramada')
    if ((data?.length ?? 0) >= hasta && hasta > 0) return data
    if (Date.now() >= fin) return data ?? []
    await esperar(1500)
  }
}

// Horario redondo, dentro de unos días (el minuto es lo que compara el trigger).
const enDias = (d, h = 15) => {
  const t = new Date(Date.now() + d * 86400_000)
  t.setUTCHours(h, 0, 0, 0)
  return t.toISOString()
}

let consultaId = null
try {
  const paciente = await sesion('paciente@healthier.app')
  const superadmin = await sesion('superadmin@healthier.app')
  const { data: pro } = await admin.from('profiles').select('id').eq('email', 'profesional@healthier.app').single()

  const { data: c, error } = await admin.from('consultations').insert({
    patient_id: paciente.id,
    professional_id: pro.id,
    status: 'confirmed',
    modality: 'video',
    scheduled_at: enDias(3),
    payment_status: 'exempt',
    daily_room_url: 'https://healthier.daily.co/sala-vieja-de-prueba',
    daily_room_name: 'sala-vieja-de-prueba',
  }).select('id').single()
  if (error) throw new Error(`no se pudo crear la consulta de prueba: ${error.message}`)
  consultaId = c.id
  nota(`consulta de prueba ${consultaId}`)

  // 2 · El paciente cambia la fecha → ningún mail.
  console.log('\n── Paciente cambia la fecha')
  const { data: upd, error: ePac } = await paciente.c.from('consultations')
    .update({ scheduled_at: enDias(4) }).eq('id', consultaId).select('id')
  nota(ePac ? `la base no lo dejó (${ePac.message})` : `filas tocadas: ${upd?.length ?? 0}`)
  const dePaciente = await mails(consultaId, { ms: 8000 })
  dePaciente.length === 0 ? ok('no salió ningún mail') : mal(`salieron ${dePaciente.length} mails reprogramando como paciente`)

  // La sala se vuelve a poner para probar que el admin la limpia.
  await admin.from('consultations').update({
    daily_room_url: 'https://healthier.daily.co/sala-vieja-de-prueba',
    daily_room_name: 'sala-vieja-de-prueba',
  }).eq('id', consultaId)

  // 1 · El super admin cambia la fecha → mail a los dos + sala limpia.
  console.log('\n── Super admin cambia la fecha')
  const nueva = enDias(5, 16)
  const { error: eSa } = await superadmin.c.from('consultations')
    .update({ scheduled_at: nueva }).eq('id', consultaId)
  if (eSa) mal(`el super admin no pudo guardar: ${eSa.message}`)
  const deAdmin = await mails(consultaId, { hasta: 2, ms: 30000 })
  deAdmin.length >= 2
    ? ok(`salieron ${deAdmin.length} mails: ${deAdmin.map(m => `${m.destinatario} (${m.estado})`).join(', ')}`)
    : mal(`se esperaban 2 mails reprogramada, hay ${deAdmin.length}`)
  for (const m of deAdmin) nota(`asunto: ${m.asunto}${m.error ? ` · error de envío: ${m.error}` : ''}`)

  const { data: fila } = await admin.from('consultations')
    .select('daily_room_url, daily_room_name, scheduled_at').eq('id', consultaId).single()
  !fila.daily_room_url && !fila.daily_room_name
    ? ok('la sala vieja quedó limpia')
    : mal(`la sala quedó guardada: ${fila.daily_room_name}`)

  // 3 · Guardar sin tocar la fecha → nada nuevo.
  console.log('\n── Super admin guarda sin cambiar la fecha')
  await superadmin.c.from('consultations')
    .update({ scheduled_at: fila.scheduled_at, payment_status: 'exempt' }).eq('id', consultaId)
  const despues = await mails(consultaId, { ms: 8000 })
  despues.length === deAdmin.length ? ok('no salió un mail de más') : mal(`salieron ${despues.length - deAdmin.length} mails de más`)
} catch (e) {
  mal(e.message)
} finally {
  if (consultaId) {
    await admin.from('email_log').delete().eq('consultation_id', consultaId)
    await admin.from('consultations').delete().eq('id', consultaId)
    nota('consulta de prueba borrada')
  }
}

console.log(fallos ? `\n❌ ${fallos} fallo(s)` : '\n✅ todo bien')
process.exit(fallos ? 1 : 0)
