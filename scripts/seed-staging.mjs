#!/usr/bin/env node
/**
 * Seed de la base de STAGING (`healthier-staging`, ref itjhrvlzuqvyhqtffumc).
 *
 * Staging tiene base propia desde el 2026-08-24 — ya no comparte la de
 * producción — así que necesita sus propios datos para servir de
 * pre-producción: sin consultas ni historia clínica no se puede probar nada
 * de lo que importa (la sala, el panel clínico, el recetario, el cierre).
 *
 * Es **idempotente**: todo lo que crea usa UUIDs fijos y se borra antes de
 * volver a insertarse, así que se puede correr las veces que haga falta para
 * dejar staging en un estado conocido cuando se ensucia probando.
 *
 *   node scripts/seed-staging.mjs           # siembra (o resiembra)
 *   node scripts/seed-staging.mjs --limpiar # sólo borra lo sembrado
 *
 * 🔴 NUNCA correrlo contra producción: aborta si la URL no es la de staging.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// ── Credenciales ────────────────────────────────────────────────────────────
// Salen de ~/Local/.env (HEALTHIER_STAGING_*), no del .env del repo: son de
// staging y no tienen por qué estar en el proyecto.
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
// Guarda dura: este script borra filas. Si por lo que sea apunta a otra base
// que no sea staging, no corre.
if (!URL.includes(REF_STAGING)) {
  console.error(`ABORTADO: la URL (${URL}) no es la de staging. Este script borra datos.`)
  process.exit(1)
}

const db = createClient(URL, SERVICE_KEY, { auth: { persistSession: false } })

// Las tablas clínicas tienen triggers `no_delete` (retención de 10 años, Ley
// 26.529 Art. 18): en producción eso está perfecto, pero acá impide dejar
// staging en un estado conocido — cada corrida iba apilando entradas. Se
// desactivan sólo mientras se limpia, y se vuelven a prender siempre (finally).
// Va por la Management API porque PostgREST no ejecuta DDL.
const TABLAS_CLINICAS = ['clinical_entries', 'clinical_allergies', 'clinical_conditions', 'clinical_medications', 'clinical_observations']

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF_STAGING}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const body = await r.json()
  if (body?.message) throw new Error(body.message)
  return body
}

const triggersRetencion = accion =>
  sql(TABLAS_CLINICAS.map(t => `alter table public.${t} ${accion} trigger ${t}_no_delete;`).join('\n'))
const LIMPIAR_SOLO = process.argv.includes('--limpiar')

// ── Identidades fijas ───────────────────────────────────────────────────────
// UUIDs estables para poder borrar y re-sembrar sin dejar huérfanos. El prefijo
// `5eed` (seed) los hace reconocibles de un vistazo en la base.
const PRO = {
  clinica:   { id: '5eed0001-0000-4000-8000-000000000001', email: 'clinica@staging.healthier.app',   nombre: 'Dra. Valentina Ortega',  especialidad: 'medicina_general', matricula: '112233' },
  pediatria: { id: '5eed0002-0000-4000-8000-000000000002', email: 'pediatria@staging.healthier.app', nombre: 'Dr. Bruno Salas',        especialidad: 'pediatria',        matricula: '445566' },
  nutricion: { id: '5eed0003-0000-4000-8000-000000000003', email: 'nutricion@staging.healthier.app', nombre: 'Lic. Carla Ferreyra',    especialidad: 'nutricion',        matricula: '778899' },
  pendiente: { id: '5eed0004-0000-4000-8000-000000000004', email: 'pendiente@staging.healthier.app', nombre: 'Dr. Nicolás Vera',       especialidad: 'medicina_general', matricula: '990011' },
}
const PAC = {
  completo:   { id: '5eed1001-0000-4000-8000-000000000001', email: 'paciente.completo@staging.healthier.app',   nombre: 'Matías Rodríguez' },
  incompleto: { id: '5eed1002-0000-4000-8000-000000000002', email: 'paciente.incompleto@staging.healthier.app', nombre: 'Lucía Fernández' },
}
const CONSULTA = {
  enCurso:     '5eed2001-0000-4000-8000-000000000001',
  masTarde:    '5eed2002-0000-4000-8000-000000000002',
  presencial:  '5eed2003-0000-4000-8000-000000000003',
  completada:  '5eed2004-0000-4000-8000-000000000004',
  noShow:      '5eed2005-0000-4000-8000-000000000005',
  nutricion:   '5eed2006-0000-4000-8000-000000000006',
}
const ENCUENTRO_PREVIO = '5eed3001-0000-4000-8000-000000000001'

const PASSWORD = 'staging'   // igual para todas: es una base de prueba aislada
const TODOS = [...Object.values(PRO), ...Object.values(PAC)]

const hs = (h, m = 0) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.toISOString() }
const dias = n => new Date(Date.now() + n * 86400000).toISOString()
const minutos = n => new Date(Date.now() + n * 60000).toISOString()

// ── Limpieza ────────────────────────────────────────────────────────────────
async function limpiar() {
  const idsConsultas = Object.values(CONSULTA)
  const idsPersonas = TODOS.map(p => p.id)

  // Orden: de las hojas a la raíz, para no chocar contra las foreign keys.
  const idsPacientes = Object.values(PAC).map(p => p.id)
  await triggersRetencion('disable')
  try {
    for (const t of ['clinical_entries', 'clinical_medications', 'clinical_conditions', 'clinical_allergies']) {
      const { error } = await db.from(t).delete().in('patient_id', idsPacientes)
      if (error) throw new Error(`${t}: ${error.message}`)
    }
  } finally {
    await triggersRetencion('enable')
  }
  await db.from('clinical_encounters').delete().in('patient_id', Object.values(PAC).map(p => p.id))
  await db.from('consultation_events').delete().in('consultation_id', idsConsultas)
  await db.from('consultations').delete().in('id', idsConsultas)
  await db.from('professional_schedules').delete().in('professional_id', Object.values(PRO).map(p => p.id))
  await db.from('professional_profiles').delete().in('user_id', Object.values(PRO).map(p => p.id))
  await db.from('profiles').delete().in('id', idsPersonas)

  for (const p of TODOS) {
    const { data } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 })
    const existente = data?.users?.find(u => u.email === p.email)
    if (existente) await db.auth.admin.deleteUser(existente.id)
  }
  console.log('🧹 limpiado')
}

// ── Alta de usuarios ────────────────────────────────────────────────────────
async function crearUsuarios() {
  for (const p of TODOS) {
    const rol = Object.values(PRO).includes(p) ? 'professional' : 'patient'
    const { error } = await db.auth.admin.createUser({
      id: p.id,
      email: p.email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { role: rol, full_name: p.nombre },
    })
    if (error && !/already/i.test(error.message)) throw new Error(`${p.email}: ${error.message}`)
  }
  console.log(`👥 ${TODOS.length} usuarios de auth`)
}

// ── Perfiles ────────────────────────────────────────────────────────────────
async function sembrarPerfiles() {
  // El trigger de alta ya creó la fila en `profiles`; acá se completa con los
  // datos que hacen falta para que los flujos reales funcionen.
  const perfiles = [
    // Paciente COMPLETO: tiene todo lo que la receta electrónica exige (DNI,
    // sexo, fecha de nacimiento) más cobertura con financiador del catálogo.
    { id: PAC.completo.id, email: PAC.completo.email, full_name: PAC.completo.nombre, role: 'patient',
      dni: '35123456', gender: 'masculino', birth_date: '1990-04-12', phone: '+5491155550001',
      blood_type: 'O+', insurance_name: 'Swiss Medical', insurance_num: '99876543',
      coverage_type: 'financiador', financiador_id: 1, height_cm: 178, weight_kg: 81.5,
      emergency_name: 'Ana Rodríguez', emergency_phone: '+5491155550011', emergency_rel: 'Hermana' },
    // Paciente INCOMPLETO: sin DNI ni sexo — sirve para ver el cartel "Falta
    // información para emitir la receta electrónica" y el flujo de cargarlo.
    { id: PAC.incompleto.id, email: PAC.incompleto.email, full_name: PAC.incompleto.nombre, role: 'patient',
      phone: '+5491155550002', coverage_type: 'particular',
      dni: null, gender: null, birth_date: null, blood_type: null, insurance_name: null,
      insurance_num: null, financiador_id: null, height_cm: null, weight_kg: null,
      emergency_name: null, emergency_phone: null, emergency_rel: null },
    ...Object.values(PRO).map(p => ({
      id: p.id, email: p.email, full_name: p.nombre, role: 'professional', phone: '+5491155559999',
      dni: null, gender: null, birth_date: null, blood_type: null, insurance_name: null,
      insurance_num: null, coverage_type: null, financiador_id: null, height_cm: null, weight_kg: null,
      emergency_name: null, emergency_phone: null, emergency_rel: null,
    })),
  ]
  const { error } = await db.from('profiles').upsert(perfiles, { onConflict: 'id' })
  if (error) throw new Error(`profiles: ${error.message}`)
  console.log(`🪪 ${perfiles.length} perfiles`)
}

async function sembrarProfesionales() {
  // Todas las filas tienen que tener EXACTAMENTE las mismas claves: PostgREST
  // arma un solo INSERT con la unión de columnas y a las que le faltan les
  // manda NULL explícito en vez de dejar que tome el default de la tabla
  // (por eso `is_on_demand` reventaba en las filas que no lo declaraban).
  const base = {
    is_active: true, modality_preference: 'ambas', license_type: 'MN',
    mp_connected: true, is_available_walkin: false, is_on_demand: false,
    is_verified: false, submitted_at: null, price_presencial: null,
  }
  const filas = [
    { ...base, user_id: PRO.clinica.id, specialty: 'medicina_general', license_number: PRO.clinica.matricula,
      bio: 'Clínica médica. Atiende consultas generales por videollamada y presencial.',
      session_price: 18000, price_video: 18000, price_presencial: 22000,
      is_verified: true, is_on_demand: true, is_available_walkin: true },
    { ...base, user_id: PRO.pediatria.id, specialty: 'pediatria', license_number: PRO.pediatria.matricula,
      bio: 'Pediatría. Controles de niño sano y consultas de urgencia.',
      session_price: 20000, price_video: 20000, price_presencial: 24000,
      is_verified: true, is_on_demand: true },
    // Nutrición NO puede recetar (catálogo de especialidades, migración 116):
    // sirve para probar que el Recetario le esconde "Recetar medicamentos".
    { ...base, user_id: PRO.nutricion.id, specialty: 'nutricion', license_number: PRO.nutricion.matricula,
      bio: 'Nutrición clínica y deportiva.',
      session_price: 15000, price_video: 15000, is_verified: true },
    // Sin verificar: es el que se ve en la cola de verificación del super admin.
    { ...base, user_id: PRO.pendiente.id, specialty: 'medicina_general', license_number: PRO.pendiente.matricula,
      bio: 'Pendiente de verificación.', session_price: 16000, price_video: 16000,
      submitted_at: dias(-2) },
  ]
  const { error } = await db.from('professional_profiles').upsert(filas, { onConflict: 'user_id' })
  if (error) throw new Error(`professional_profiles: ${error.message}`)

  // Horarios de los verificados: Lun a Vie 09-13 y 15-19, Sábado 09-13.
  const horarios = []
  for (const p of [PRO.clinica, PRO.pediatria, PRO.nutricion]) {
    for (let d = 1; d <= 5; d++) {
      horarios.push({ professional_id: p.id, day_of_week: d, start_time: '09:00', end_time: '13:00' })
      horarios.push({ professional_id: p.id, day_of_week: d, start_time: '15:00', end_time: '19:00' })
    }
    horarios.push({ professional_id: p.id, day_of_week: 6, start_time: '09:00', end_time: '13:00' })
  }
  const { error: e2 } = await db.from('professional_schedules').insert(horarios)
  if (e2) throw new Error(`professional_schedules: ${e2.message}`)
  console.log(`🩺 4 profesionales (3 verificados) · ${horarios.length} franjas horarias`)
}

// ── Consultas ───────────────────────────────────────────────────────────────
async function sembrarConsultas() {
  // Mismas claves en todas las filas (ver la nota en sembrarProfesionales:
  // PostgREST manda NULL explícito a las columnas que le faltan a una fila).
  const comun = {
    payment_status: 'paid', paid_at: hs(8), vertical: 'salud',
    refund_pending: false, is_on_demand: false, reminder_sent: false, reminder_24h_sent: false,
    completed_at: null, closing_notes: null, financiador_id: null, obra_social_name: null,
    affiliate_number: null, preconsulta_data: null, duration_minutes: 30,
  }
  const filas = [
    // La importante: una videollamada confirmada y paga que arranca en 5
    // minutos. Es la que se usa para entrar a la sala y probar el panel
    // clínico, el recetario y el cierre.
    { id: CONSULTA.enCurso, patient_id: PAC.completo.id, professional_id: PRO.clinica.id,
      status: 'confirmed', modality: 'video', scheduled_at: minutos(5), price_at_booking: 18000,
      coverage_type: 'financiador', financiador_id: 1, obra_social_name: 'Swiss Medical', affiliate_number: '99876543',
      preconsulta_data: {
        version: 2,
        motivo: 'Dolor torácico',
        sintomas: ['Dolor en el pecho al hacer esfuerzo', 'Falta de aire'],
        desde: 'hace 3 días',
        medicacion_actual: 'Enalapril 10 mg',
      }, ...comun },
    // Otra videollamada, más tarde: para ver la agenda con más de un turno.
    { id: CONSULTA.masTarde, patient_id: PAC.incompleto.id, professional_id: PRO.clinica.id,
      status: 'confirmed', modality: 'video', scheduled_at: hs(18), price_at_booking: 18000,
      coverage_type: 'particular', ...comun },
    // Presencial mañana.
    { id: CONSULTA.presencial, patient_id: PAC.completo.id, professional_id: PRO.pediatria.id,
      status: 'confirmed', modality: 'presencial', scheduled_at: dias(1), price_at_booking: 24000,
      coverage_type: 'particular', ...comun },
    // Nutrición: para probar el gate del Recetario (no puede recetar).
    { id: CONSULTA.nutricion, patient_id: PAC.completo.id, professional_id: PRO.nutricion.id,
      status: 'confirmed', modality: 'video', scheduled_at: dias(2), price_at_booking: 15000,
      coverage_type: 'particular', ...comun },
    // Una ya cerrada, con historia clínica adjunta (ver sembrarHistoria).
    { id: CONSULTA.completada, patient_id: PAC.completo.id, professional_id: PRO.clinica.id,
      status: 'completed', modality: 'video', scheduled_at: dias(-14), completed_at: dias(-14),
      price_at_booking: 18000, coverage_type: 'financiador', financiador_id: 1,
      closing_notes: 'Paciente evoluciona favorablemente. Control en 15 días.', ...comun },
    // Un no-show, que es un estado real que el profesional ve en su agenda.
    { id: CONSULTA.noShow, patient_id: PAC.incompleto.id, professional_id: PRO.clinica.id,
      status: 'no_show', modality: 'video', scheduled_at: dias(-3), price_at_booking: 18000,
      coverage_type: 'particular', refund_pending: true, ...comun },
  ]
  const { error } = await db.from('consultations').upsert(filas, { onConflict: 'id' })
  if (error) throw new Error(`consultations: ${error.message}`)
  console.log(`📅 ${filas.length} consultas (1 arranca en 5 min)`)
}

// ── Historia clínica ────────────────────────────────────────────────────────
async function sembrarHistoria() {
  const lic = { professional_license_type: 'MN', professional_license_number: PRO.clinica.matricula }

  const { error: eEnc } = await db.from('clinical_encounters').upsert([{
    id: ENCUENTRO_PREVIO, consultation_id: CONSULTA.completada,
    patient_id: PAC.completo.id, professional_id: PRO.clinica.id,
    modality: 'telemedicina', specialty: 'medicina_general', status: 'finished',
    started_at: dias(-14), finished_at: dias(-14), ...lic,
  }], { onConflict: 'id' })
  if (eEnc) throw new Error(`clinical_encounters: ${eEnc.message}`)

  // Entradas de una consulta anterior, incluyendo los tipos nuevos: la entrada
  // unificada de la Consulta Estructurada ('consultation') y una orden de
  // estudios ('order'). Así la Historia Clínica del paciente tiene contenido
  // real para leer y se ve el orden (más nuevo primero).
  const entradas = [
    { entry_type: 'consultation', sequence_number: 1, content:
`Motivo: Dolor torácico

Enfermedad actual: Dolor opresivo retroesternal de 3 días de evolución, aparece con el esfuerzo y cede en reposo. Sin síncope.

Antecedentes: HTA. Tabaquismo: ex fumador.

Síntomas:
- Dolor opresivo + esfuerzo + irradiación (sospecha de SCA) [bandera roja]
- ¿Aparece o empeora con el esfuerzo? [pregunta dirigida]

Vitales: TA 145/92 (elevada) · FC 88 lpm · SatO2 97%

Examen físico: Cardiovascular: normal · Respiratorio: normal

Diagnóstico:
- Angina estable (I20.9)` },
    { entry_type: 'indication', sequence_number: 2, content: 'Reposo relativo. Evitar esfuerzos hasta la evaluación cardiológica. Consultar por guardia ante dolor en reposo.' },
    { entry_type: 'order', sequence_number: 3, content: 'Estudios solicitados: Ergometría, Perfil Lipídico. Indicaciones: En ayunas de 12 horas.',
      data: { source: 'orden_estudios', estudios: [{ nombre: 'Ergometría', codigo: null }, { nombre: 'Perfil Lipídico', codigo: null }], indicaciones: 'En ayunas de 12 horas.' } },
  ].map(e => ({
    ...e, encounter_id: ENCUENTRO_PREVIO, patient_id: PAC.completo.id,
    professional_id: PRO.clinica.id, ...lic,
  }))
  const { error: eEnt } = await db.from('clinical_entries').insert(entradas)
  if (eEnt) throw new Error(`clinical_entries: ${eEnt.message}`)

  // Alergia activa: es lo que dispara la alerta al recetar.
  const { error: eAl } = await db.from('clinical_allergies').insert([{
    patient_id: PAC.completo.id, encounter_id: ENCUENTRO_PREVIO, professional_id: PRO.clinica.id,
    substance: 'Penicilina', category: 'medication', criticality: 'high',
    reaction_description: 'Urticaria y angioedema', clinical_status: 'active', ...lic,
  }])
  if (eAl) throw new Error(`clinical_allergies: ${eAl.message}`)

  const { error: eCond } = await db.from('clinical_conditions').insert([{
    patient_id: PAC.completo.id, encounter_id: ENCUENTRO_PREVIO, professional_id: PRO.clinica.id,
    icd10_code: 'I10', icd10_display: 'Hipertensión esencial',
    clinical_status: 'active', verification_status: 'confirmed', ...lic,
  }])
  if (eCond) throw new Error(`clinical_conditions: ${eCond.message}`)

  const { error: eMed } = await db.from('clinical_medications').insert([{
    patient_id: PAC.completo.id, encounter_id: ENCUENTRO_PREVIO, professional_id: PRO.clinica.id,
    medication_name: 'Enalapril', dosage_text: '10 mg cada 12 h', concentration: '10 mg',
    route: 'Oral', frequency: 'cada 12 h', status: 'active', is_chronic: true, ...lic,
  }])
  if (eMed) throw new Error(`clinical_medications: ${eMed.message}`)

  console.log(`📋 1 encuentro previo · ${entradas.length} entradas · alergia + condición + medicación`)
}

// ── Main ────────────────────────────────────────────────────────────────────
try {
  console.log(`\n🌱 Seed de STAGING (${URL})\n`)
  await limpiar()
  if (LIMPIAR_SOLO) {
    console.log('\nListo: staging quedó sin los datos sembrados.\n')
    process.exit(0)
  }
  await crearUsuarios()
  await sembrarPerfiles()
  await sembrarProfesionales()
  await sembrarConsultas()
  await sembrarHistoria()

  console.log(`
✅ Staging sembrado.

   Entrar con cualquiera de estas (password: ${PASSWORD})
     ${PRO.clinica.email}    → clínica, verificada, con la videollamada que arranca ya
     ${PRO.pediatria.email}  → pediatría (guía clínica también aplica)
     ${PRO.nutricion.email}  → nutrición: NO puede recetar (para probar el gate)
     ${PAC.completo.email}   → paciente con historia clínica y datos completos

   Las cuentas de siempre (paciente/profesional/superadmin@healthier.app) siguen andando.
   Volver a correr esto deja staging en este mismo estado.
`)
} catch (err) {
  console.error('\n❌', err.message, '\n')
  process.exit(1)
}
