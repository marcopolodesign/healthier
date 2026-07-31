#!/usr/bin/env node
/**
 * Seed de profesionales de PRUEBA para ejercitar el despacho on-demand.
 *
 * Crea 3 de Clínica (`medicina_general`) + 2 de Pediatría (`pediatria`), todos
 * verificados/activos/on-demand, y les copia la conexión de Mercado Pago de
 * Valentina Ortega — misma cuenta vendedora, como si cada uno la hubiera
 * conectado a mano por OAuth. Los tokens de mp_accounts están cifrados a nivel
 * app (`enc:v1:...`), así que se copia el ciphertext tal cual: la misma clave
 * de la Edge Function los descifra igual.
 *
 * Son descartables. Todos comparten el prefijo de email `qa.` y ese es el único
 * criterio de borrado:
 *
 *   node scripts/seed-test-professionals.mjs           # crear
 *   node scripts/seed-test-professionals.mjs --refresh # revivir el latido on-demand
 *   node scripts/seed-test-professionals.mjs --delete  # borrar todo lo qa.*
 *
 * `--refresh` existe por `ON_DEMAND_PRESENCE_TTL_MS` (1 h): el buscador del
 * paciente pasa `onlyLive`, así que un sembrado deja de aparecer en el pool una
 * hora después del alta si nadie abrió su dashboard. Esto reempuja el latido de
 * los cinco de una, sin tener que loguearse como cada uno.
 *
 * Requiere SUPABASE_SERVICE_ROLE_KEY (está en website/.env).
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

// ── env ──────────────────────────────────────────────────────────────────────
const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const SUPABASE_URL = env.VITE_SUPABASE_URL
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) throw new Error('Faltan VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en website/.env')

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

// ── constantes ───────────────────────────────────────────────────────────────
const SOURCE_PRO_ID = 'a0fb6e60-a920-4290-b9fe-d926c5d2f7c3' // Dra. Valentina Ortega
const EMAIL_PREFIX = 'qa.'
const PASSWORD = 'Healthier2026!'

const TEST_PROS = [
  { email: 'qa.clinica1@healthier.app',   fullName: 'Dr. Martín Sosa',        specialty: 'medicina_general', gender: 'masculino', phone: '+54 11 5555-0101', dni: '32111001', license: 'MN 111001', cuit: '20321110019' },
  { email: 'qa.clinica2@healthier.app',   fullName: 'Dra. Camila Ruiz',       specialty: 'medicina_general', gender: 'femenino',  phone: '+54 11 5555-0102', dni: '32111002', license: 'MN 111002', cuit: '27321110022' },
  { email: 'qa.clinica3@healthier.app',   fullName: 'Dr. Nicolás Peña',       specialty: 'medicina_general', gender: 'masculino', phone: '+54 11 5555-0103', dni: '32111003', license: 'MN 111003', cuit: '20321110035' },
  { email: 'qa.pediatria1@healthier.app', fullName: 'Dra. Julieta Márquez',   specialty: 'pediatria',        gender: 'femenino',  phone: '+54 11 5555-0201', dni: '32111004', license: 'MN 111004', cuit: '27321110048' },
  { email: 'qa.pediatria2@healthier.app', fullName: 'Dr. Federico Lugo',      specialty: 'pediatria',        gender: 'masculino', phone: '+54 11 5555-0202', dni: '32111005', license: 'MN 111005', cuit: '20321110051' },
]

// ── helpers ──────────────────────────────────────────────────────────────────
// OJO: `auth.admin.listUsers()` devuelve 500 "Database error finding users" en
// este proyecto (con cualquier perPage) — falla del lado de GoTrue, no del
// script. Por eso los ids se resuelven vía `profiles.email`, que es fiel porque
// profiles.id ES el auth uid. `createUser` y `deleteUser` sí funcionan.
async function findUserIdByEmail(email) {
  const { data, error } = await db.from('profiles').select('id').eq('email', email).maybeSingle()
  if (error) throw error
  return data?.id ?? null
}

// ── borrado ──────────────────────────────────────────────────────────────────
async function remove() {
  const { data: targets, error } = await db
    .from('profiles').select('id, email').like('email', `${EMAIL_PREFIX}%`)
  if (error) throw error
  if (!targets.length) return console.log('No hay usuarios qa.* para borrar.')
  for (const u of targets) {
    // profiles → professional_profiles / mp_accounts caen por ON DELETE CASCADE
    await db.from('mp_accounts').delete().eq('professional_id', u.id)
    await db.from('professional_profiles').delete().eq('user_id', u.id)
    await db.from('profiles').delete().eq('id', u.id)
    const { error: delErr } = await db.auth.admin.deleteUser(u.id)
    console.log(delErr ? `  ✗ ${u.email}: ${delErr.message}` : `  ✓ borrado ${u.email}`)
  }
}

// ── alta ─────────────────────────────────────────────────────────────────────
async function seed() {
  // 1. Plantilla: el perfil profesional y la cuenta MP de Valentina
  const [{ data: src, error: srcErr }, { data: mpSrc, error: mpErr }] = await Promise.all([
    db.from('professional_profiles').select('*').eq('user_id', SOURCE_PRO_ID).single(),
    db.from('mp_accounts').select('*').eq('professional_id', SOURCE_PRO_ID).single(),
  ])
  if (srcErr) throw srcErr
  if (mpErr) throw mpErr
  console.log(`Plantilla MP: ${mpSrc.mp_nickname} · ${mpSrc.mp_email} (mp_user_id ${mpSrc.mp_user_id})\n`)

  for (const pro of TEST_PROS) {
    // 2. auth.users — email ya confirmado para poder loguear sin mail
    let uid = await findUserIdByEmail(pro.email)
    if (uid) {
      console.log(`· ${pro.email} ya existía — se reutiliza`)
    } else {
      const { data, error } = await db.auth.admin.createUser({
        email: pro.email,
        password: PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: pro.fullName, role: 'professional' },
      })
      if (error) throw new Error(`createUser ${pro.email}: ${error.message}`)
      uid = data.user.id
    }

    // 3. profiles
    const { error: pErr } = await db.from('profiles').upsert({
      id: uid,
      email: pro.email,
      full_name: pro.fullName,
      phone: pro.phone,
      role: 'professional',
      gender: pro.gender,
      dni: pro.dni,
    }, { onConflict: 'id' })
    if (pErr) throw new Error(`profiles ${pro.email}: ${pErr.message}`)

    // 4. professional_profiles — verificado a mano, on-demand, con MP conectado.
    //    Zona / dirección / precios se heredan de la plantilla para que el
    //    cálculo de precio por zona y el mapa se comporten igual que con ella.
    const { error: ppErr } = await db.from('professional_profiles').upsert({
      user_id: uid,
      specialty: pro.specialty,
      sub_specialty: '',
      bio: `Profesional de prueba (QA) — ${pro.specialty}. Borrable.`,
      session_price: src.session_price,
      price_video: src.price_video,
      price_presencial: src.price_presencial,
      is_on_demand: true,
      is_verified: true,
      is_active: true,
      is_available_walkin: false,
      license_type: 'MN',
      license_number: pro.license,
      cuit_number: pro.cuit,
      address: src.address,
      latitude: src.latitude,
      longitude: src.longitude,
      zone_id: src.zone_id,
      modality_preference: 'ambas',
      verification_source: 'manual',
      verified_at: new Date().toISOString(),
      submitted_at: new Date().toISOString(),
      mp_connected: true,
      mp_account_label: src.mp_account_label,
      on_demand_since: new Date().toISOString(),
      on_demand_last_seen_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })
    if (ppErr) throw new Error(`professional_profiles ${pro.email}: ${ppErr.message}`)

    // 5. mp_accounts — misma cuenta vendedora que Valentina, ciphertext copiado
    const { error: mpInsErr } = await db.from('mp_accounts').upsert({
      professional_id: uid,
      mp_user_id: mpSrc.mp_user_id,
      access_token: mpSrc.access_token,
      refresh_token: mpSrc.refresh_token,
      public_key: mpSrc.public_key,
      scope: mpSrc.scope,
      expires_at: mpSrc.expires_at,
      live_mode: mpSrc.live_mode,
      active: true,
      connected_at: new Date().toISOString(),
      mp_nickname: mpSrc.mp_nickname,
      mp_email: mpSrc.mp_email,
    }, { onConflict: 'professional_id' })
    if (mpInsErr) throw new Error(`mp_accounts ${pro.email}: ${mpInsErr.message}`)

    console.log(`  ✓ ${pro.fullName.padEnd(22)} ${pro.specialty.padEnd(17)} ${pro.email}`)
  }

  console.log(`\nPassword de todos: ${PASSWORD}`)
}

// ── refresh del latido on-demand ─────────────────────────────────────────────
async function refresh() {
  const { data: ids, error } = await db
    .from('profiles').select('id, full_name').like('email', `${EMAIL_PREFIX}%`)
  if (error) throw error
  if (!ids.length) return console.log('No hay usuarios qa.* — corré el script sin flags primero.')
  const now = new Date().toISOString()
  const { error: upErr } = await db.from('professional_profiles')
    .update({ on_demand_last_seen_at: now, is_on_demand: true })
    .in('user_id', ids.map(u => u.id))
  if (upErr) throw upErr
  console.log(`Latido reempujado para ${ids.length} profesionales — vuelven a estar "en vivo" por 1 h.`)
}

const mode = process.argv.includes('--delete') ? remove
  : process.argv.includes('--refresh') ? refresh
  : seed
await mode()
