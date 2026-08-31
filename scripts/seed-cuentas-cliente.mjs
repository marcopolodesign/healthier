#!/usr/bin/env node
/**
 * Las tres cuentas que se le pasan al CLIENTE para que recorra la app desde el
 * punto de vista del profesional, una por vertical:
 *
 *   profesional@healthier.app  · Dra. Valentina Ortega   · Clínica médica
 *   nutricion@healthier.app    · Lic. Camila Duarte      · Nutrición
 *   psicologia@healthier.app   · Lic. Tomás Ibarra       · Psicología
 *
 * Las tres comparten la password que ya tenía `profesional@healthier.app` en
 * staging (`DEMO_STAGING_CLINICA_PASSWORD` en `~/Local/Healthier/.env`): una
 * sola clave para las tres, y sin rotarle la suya a nadie — esa cuenta está
 * documentada y compartida entre sesiones, cambiársela rompe a quien la esté
 * usando en paralelo.
 *
 * Por qué un script aparte de `seed-staging.mjs`: aquél deja la base en un
 * estado conocido **borrando** lo que sembró (UUIDs `5eed…`) y sus cuentas son
 * `@staging.healthier.app`. Éstas son las que ya conoce el cliente, viven en el
 * dominio `@healthier.app` y no tienen que desaparecer cuando se resiembra
 * staging. Los UUIDs llevan prefijo `c11e` (cliente) para reconocerlas.
 *
 * Es idempotente: se puede correr las veces que haga falta.
 *
 *   node scripts/seed-cuentas-cliente.mjs
 *
 * 🔴 Sólo staging: aborta si la URL no es la de la base de staging.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// ── Credenciales ────────────────────────────────────────────────────────────
function leerEnvGlobal() {
  const txt = readFileSync(join(homedir(), 'Local', '.env'), 'utf8')
  const out = {}
  for (const linea of txt.split('\n')) {
    const m = linea.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) out[m[1]] = m[2]
  }
  return out
}

const env = leerEnvGlobal()
const URL = env.HEALTHIER_STAGING_SUPABASE_URL
const SERVICE_KEY = env.HEALTHIER_STAGING_SUPABASE_SERVICE_ROLE_KEY
const REF_STAGING = 'itjhrvlzuqvyhqtffumc'

if (!URL || !SERVICE_KEY) {
  console.error('Faltan HEALTHIER_STAGING_SUPABASE_URL / _SERVICE_ROLE_KEY en ~/Local/.env')
  process.exit(1)
}
if (!URL.includes(REF_STAGING)) {
  console.error(`ABORTADO: la URL (${URL}) no es la de staging.`)
  process.exit(1)
}

const db = createClient(URL, SERVICE_KEY, { auth: { persistSession: false } })

// La password de las tres. Sale del .env del proyecto (no versionado) para no
// dejarla escrita en el repo.
function leerEnvProyecto() {
  const txt = readFileSync(join(homedir(), 'Local', 'Healthier', '.env'), 'utf8')
  const out = {}
  for (const linea of txt.split('\n')) {
    const m = linea.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) out[m[1]] = m[2]
  }
  return out
}
const PASSWORD = leerEnvProyecto().DEMO_STAGING_CLINICA_PASSWORD
if (!PASSWORD) {
  console.error('Falta DEMO_STAGING_CLINICA_PASSWORD en ~/Local/Healthier/.env')
  process.exit(1)
}

// ── Identidades ─────────────────────────────────────────────────────────────
// `profesional@` no lleva id fijo: ya existe en staging desde antes y se busca
// por email. Las dos nuevas sí, para poder re-correr sin duplicar.
const CUENTAS = [
  {
    email: 'profesional@healthier.app',
    nombre: 'Dra. Valentina Ortega',
    especialidad: 'medicina_general',
    matricula: '112233',
    bio: 'Clínica médica. Consultas generales por videollamada y presenciales.',
    precioVideo: 18000,
    precioPresencial: 22000,
    onDemand: true,
    tocarPassword: false,
  },
  {
    id: 'c11e0001-0000-4000-8000-000000000001',
    email: 'nutricion@healthier.app',
    nombre: 'Lic. Camila Duarte',
    especialidad: 'nutricion',
    matricula: '445511',
    bio: 'Nutrición clínica y deportiva. Planes de alimentación y seguimiento.',
    precioVideo: 15000,
    precioPresencial: 18000,
    onDemand: false,
    tocarPassword: true,
  },
  {
    id: 'c11e0002-0000-4000-8000-000000000002',
    email: 'psicologia@healthier.app',
    nombre: 'Lic. Tomás Ibarra',
    especialidad: 'psicologia',
    matricula: '778822',
    bio: 'Psicología clínica. Terapia individual, enfoque cognitivo-conductual.',
    precioVideo: 16000,
    precioPresencial: null,
    onDemand: false,
    tocarPassword: true,
  },
]

const PACIENTE_COMPLETO   = '5eed1001-0000-4000-8000-000000000001' // Matías Rodríguez
const PACIENTE_INCOMPLETO = '5eed1002-0000-4000-8000-000000000002' // Lucía Fernández

const CONSULTA = {
  nutricionProxima:   'c11e2001-0000-4000-8000-000000000001',
  nutricionCerrada:   'c11e2002-0000-4000-8000-000000000002',
  psicologiaProxima:  'c11e2003-0000-4000-8000-000000000003',
  psicologiaCerrada:  'c11e2004-0000-4000-8000-000000000004',
}

const dias    = n => new Date(Date.now() + n * 86400000).toISOString()
const minutos = n => new Date(Date.now() + n * 60000).toISOString()

// ── 1 · Usuarios de auth ────────────────────────────────────────────────────
async function asegurarUsuarios() {
  for (const c of CUENTAS) {
    const { data: lista } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 })
    const existente = lista?.users?.find(u => u.email === c.email)

    if (existente) {
      c.userId = existente.id
      // Sólo para las cuentas nuevas: dejar la password en el valor documentado.
      // Correr esto sobre `profesional@` sería rotarle la clave a todo el que la
      // esté usando en otra sesión.
      if (c.tocarPassword) {
        const { error } = await db.auth.admin.updateUserById(existente.id, { password: PASSWORD })
        if (error) throw new Error(`${c.email}: ${error.message}`)
      }
      continue
    }

    const { data, error } = await db.auth.admin.createUser({
      id: c.id,
      email: c.email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { role: 'professional', full_name: c.nombre },
    })
    if (error) throw new Error(`${c.email}: ${error.message}`)
    c.userId = data.user.id
  }
  console.log(`👥 ${CUENTAS.length} usuarios de auth`)
}

// ── 2 · profiles ────────────────────────────────────────────────────────────
async function sembrarPerfiles() {
  const filas = CUENTAS.map(c => ({
    id: c.userId, email: c.email, full_name: c.nombre, role: 'professional',
    phone: '+5491155559999',
  }))
  const { error } = await db.from('profiles').upsert(filas, { onConflict: 'id' })
  if (error) throw new Error(`profiles: ${error.message}`)
  console.log(`🪪 ${filas.length} perfiles`)
}

// ── 3 · professional_profiles ───────────────────────────────────────────────
async function sembrarProfesionales() {
  // Todas las filas con EXACTAMENTE las mismas claves: PostgREST arma un solo
  // INSERT con la unión de columnas y le manda NULL explícito a las que le
  // faltan a una fila, pisando el default de la tabla.
  const filas = CUENTAS.map(c => ({
    user_id: c.userId,
    specialty: c.especialidad,
    license_type: 'MN',
    license_number: c.matricula,
    bio: c.bio,
    session_price: c.precioVideo,
    price_video: c.precioVideo,
    price_presencial: c.precioPresencial,
    modality_preference: c.precioPresencial ? 'ambas' : 'virtual',
    // Verificadas y activas: el cliente tiene que ver el panel completo, no la
    // pantalla de "tu perfil está en revisión".
    is_verified: true,
    is_active: true,
    verification_source: 'manual',
    verified_at: new Date().toISOString(),
    rejection_reason: null,
    rejected_at: null,
    rejection_type: null,
    // Sin Mercado Pago no aparecen en la búsqueda del paciente
    // (`buscar_profesionales_cobrables`, migración 079).
    mp_connected: true,
    is_on_demand: c.onDemand,
    is_available_walkin: false,
    submitted_at: null,
  }))
  const { error } = await db.from('professional_profiles').upsert(filas, { onConflict: 'user_id' })
  if (error) throw new Error(`professional_profiles: ${error.message}`)

  // Horarios: Lun a Vie 09-13 y 15-19, Sábado 09-13. Se borran primero porque
  // `professional_schedules` no tiene clave natural sobre la que hacer upsert.
  const ids = CUENTAS.map(c => c.userId)
  await db.from('professional_schedules').delete().in('professional_id', ids)
  const horarios = []
  for (const id of ids) {
    for (let d = 1; d <= 5; d++) {
      horarios.push({ professional_id: id, day_of_week: d, start_time: '09:00', end_time: '13:00' })
      horarios.push({ professional_id: id, day_of_week: d, start_time: '15:00', end_time: '19:00' })
    }
    horarios.push({ professional_id: id, day_of_week: 6, start_time: '09:00', end_time: '13:00' })
  }
  const { error: e2 } = await db.from('professional_schedules').insert(horarios)
  if (e2) throw new Error(`professional_schedules: ${e2.message}`)
  console.log(`🩺 ${filas.length} perfiles profesionales verificados · ${horarios.length} franjas horarias`)
}

// ── 4 · Consultas de las dos verticales nuevas ──────────────────────────────
// Para que la agenda y el historial no estén vacíos cuando el cliente entra.
// `profesional@` ya tiene las suyas de antes; no se le tocan.
async function sembrarConsultas() {
  const nutri = CUENTAS.find(c => c.email === 'nutricion@healthier.app')
  const psico = CUENTAS.find(c => c.email === 'psicologia@healthier.app')

  const comun = {
    payment_status: 'paid', paid_at: dias(-1), vertical: 'salud',
    refund_pending: false, is_on_demand: false, reminder_sent: false, reminder_24h_sent: false,
    duration_minutes: 30, coverage_type: 'particular', financiador_id: null,
    obra_social_name: null, affiliate_number: null, preconsulta_data: null,
    completed_at: null, closing_notes: null,
  }
  const filas = [
    { id: CONSULTA.nutricionProxima, patient_id: PACIENTE_COMPLETO, professional_id: nutri.userId,
      status: 'confirmed', modality: 'video', scheduled_at: minutos(30), price_at_booking: 15000, ...comun },
    { id: CONSULTA.nutricionCerrada, patient_id: PACIENTE_INCOMPLETO, professional_id: nutri.userId,
      status: 'completed', modality: 'video', scheduled_at: dias(-7), completed_at: dias(-7),
      price_at_booking: 15000, closing_notes: 'Se ajusta el plan alimentario. Control en 3 semanas.', ...comun },
    { id: CONSULTA.psicologiaProxima, patient_id: PACIENTE_INCOMPLETO, professional_id: psico.userId,
      status: 'confirmed', modality: 'video', scheduled_at: dias(1), price_at_booking: 16000, ...comun },
    { id: CONSULTA.psicologiaCerrada, patient_id: PACIENTE_COMPLETO, professional_id: psico.userId,
      status: 'completed', modality: 'video', scheduled_at: dias(-10), completed_at: dias(-10),
      price_at_booking: 16000, closing_notes: 'Continúa con sesiones semanales.', ...comun },
  ]
  const { error } = await db.from('consultations').upsert(filas, { onConflict: 'id' })
  if (error) throw new Error(`consultations: ${error.message}`)
  console.log(`📅 ${filas.length} consultas (nutrición y psicología)`)
}

// ── 5 · Habilitar las verticales en staging ─────────────────────────────────
// `nutricion` y `mente` estaban en `enabled: false`: con eso el profesional
// entra igual, pero el paciente no puede reservarle nada y la vertical no se
// ve en el mapa ni en la búsqueda — o sea, el recorrido que el cliente quiere
// mirar queda a medias. Se prenden sólo en staging; producción no se toca.
async function habilitarVerticales() {
  const { error } = await db.from('vertical_settings')
    .update({ enabled: true, ondemand_price: 1000 })
    .in('id', ['nutricion', 'mente'])
  if (error) throw new Error(`vertical_settings: ${error.message}`)
  console.log('🎛  verticales `nutricion` y `mente` habilitadas')
}

// ── Main ────────────────────────────────────────────────────────────────────
await asegurarUsuarios()
await sembrarPerfiles()
await sembrarProfesionales()
await sembrarConsultas()
await habilitarVerticales()

console.log(`
✅ Listo. Cuentas para el cliente (https://gethealthier-staging.vercel.app):

   profesional@healthier.app  → Clínica médica
   nutricion@healthier.app    → Nutrición
   psicologia@healthier.app   → Psicología

   Password (las tres): DEMO_STAGING_CLINICA_PASSWORD de ~/Local/Healthier/.env
`)
