#!/usr/bin/env node
/**
 * Siembra la base de STAGING con datos de prueba para sacar las capturas de la
 * guía de uso por rol (paciente, profesional, farmacia, despacho, chofer,
 * super admin). Sólo staging: aborta si la URL no es la de `healthier-staging`.
 *
 *   node scripts/guia/sembrar.mjs            # siembra (o resiembra)
 *   node scripts/guia/sembrar.mjs --limpiar  # sólo borra lo sembrado
 *
 * Requisitos previos (ya corridos en staging): seed-staging.mjs y
 * seed-despacho.mjs — de ahí salen las cuentas demo, la entidad de despacho y
 * los móviles.
 *
 * ── Cómo garantiza que es idempotente y que no toca lo ajeno ────────────────
 * - Todo lo que crea usa UUIDs fijos con prefijo `a1d0` (ver `uid()`), así que
 *   se borra por prefijo y se vuelve a insertar. Nunca borra por otro criterio.
 * - Las filas de las cuentas demo que ya existían (clinica@, pendiente@, el
 *   Móvil 1, el paciente completo) sólo reciben UPDATE de campos puntuales
 *   (dirección, documentos, estado del móvil); la lista está al final de la
 *   sección "Cuentas demo existentes".
 * - Los inserts van por la Management API con `session_replication_role =
 *   replica`: así NO se disparan los triggers de la base (mails, pushes, avisos,
 *   validaciones de transición) y no se manda nada a nadie ni se generan filas
 *   colaterales sin dueño que después no se puedan borrar. La contracara es que
 *   tampoco se comprueban las foreign keys al insertar, así que el script
 *   arma los ids con cuidado y `--verificar` (abajo) revisa que no queden
 *   huérfanos.
 * - Las tablas clínicas tienen triggers `no_delete` (retención): se apagan sólo
 *   mientras se limpia y se vuelven a prender siempre (finally), igual que
 *   seed-staging.mjs.
 *
 * Datos 100% inventados: nombres de fantasía, teléfonos +54 9 11 5555-xxxx,
 * mails @staging.healthier.app.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// ── Credenciales y guarda dura ──────────────────────────────────────────────
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

if (!URL || !SERVICE_KEY || !env.SUPABASE_ACCESS_TOKEN) {
  console.error('Faltan HEALTHIER_STAGING_SUPABASE_URL / _SERVICE_ROLE_KEY / SUPABASE_ACCESS_TOKEN en ~/Local/.env')
  process.exit(1)
}
if (!URL.includes(REF_STAGING)) {
  console.error(`ABORTADO: la URL (${URL}) no es la de staging. Este script borra datos.`)
  process.exit(1)
}

const db = createClient(URL, SERVICE_KEY, { auth: { persistSession: false } })
const LIMPIAR_SOLO = process.argv.includes('--limpiar')

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

// ── Ids ─────────────────────────────────────────────────────────────────────
// a1d0 + sección (4 dígitos) + contador. Un solo prefijo reconocible: todo lo
// del script se borra con `id::text like 'a1d0%'`.
const SEC = {
  usr: 1, cons: 2, enc: 3, ent: 4, med: 5, cond: 6, pay: 7, ord: 8, item: 9, prod: 10,
  emg: 11, not: 12, rep: 13, plan: 14, pet: 15, dir: 16, cred: 17, mail: 18, fam: 19,
}
const uid = (sec, n) => `a1d0${String(SEC[sec]).padStart(4, '0')}-0000-4000-8000-${String(n).padStart(12, '0')}`
const PREFIJO = "'a1d0%'"

// Cuentas y filas que ya existen (las siembran seed-staging.mjs y seed-despacho.mjs).
const PHARMACY_ID = '10000000-0000-0000-0000-000000000001'
const ENTIDAD_ID = '20000000-0000-0000-0000-000000000001'
const MOVIL_1 = '40000000-0000-0000-0000-000000000001'
const OPERADOR_ID = '30000000-0000-0000-0000-000000000002'
const DESPACHO_ID = '30000000-0000-0000-0000-000000000001'
const CHOFER_ID = '30000000-0000-0000-0000-000000000003'
const MEDICO_MOVIL_1 = '00000001-0000-0000-0000-000000000001' // Dr. Martín López, tripula el Móvil 1
const CLINICA = { id: '5eed0001-0000-4000-8000-000000000001', matricula: '112233' }
const PENDIENTE = '5eed0004-0000-4000-8000-000000000004'
const NUTRICION = '5eed0003-0000-4000-8000-000000000003'
const PAC_C = '5eed1001-0000-4000-8000-000000000001' // paciente.completo (Matías Rodríguez)
const PAC_I = '5eed1002-0000-4000-8000-000000000002' // paciente.incompleto (Lucía Fernández)

// Pacientes demo propios del script (se crean en auth si faltan).
const PASSWORD = 'staging'
const DEMOS = [
  { id: uid('usr', 1), email: 'camila.benitez@staging.healthier.app', first: 'Camila', last: 'Benítez', dni: '38456123', gender: 'femenino', birth: '1994-08-03', phone: '+5491155550101', address: 'Honduras 4800, Palermo, CABA' },
  { id: uid('usr', 2), email: 'tomas.gimenez@staging.healthier.app', first: 'Tomás', last: 'Giménez', dni: '33987654', gender: 'masculino', birth: '1988-11-21', phone: '+5491155550102', address: 'Av. Rivadavia 5200, Caballito, CABA' },
  { id: uid('usr', 3), email: 'julieta.sosa@staging.healthier.app', first: 'Julieta', last: 'Sosa', dni: '41222333', gender: 'femenino', birth: '1998-02-17', phone: '+5491155550103', address: 'Av. Cabildo 2300, Belgrano, CABA' },
]
const [P1, P2, P3] = DEMOS.map(p => p.id)

// ── Tiempo ──────────────────────────────────────────────────────────────────
// Las horas de agenda son de Buenos Aires (-03:00), no de la máquina que corre
// el script: así "hoy 10:00" es 10:00 en el reloj del paciente y del profesional.
const hoyAR = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date())
function en(dias, h, m = 0) {
  const base = new Date(`${hoyAR}T12:00:00-03:00`)
  base.setUTCDate(base.getUTCDate() + dias)
  const ymd = base.toISOString().slice(0, 10)
  return new Date(`${ymd}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00-03:00`).toISOString()
}
const haceHoras = n => new Date(Date.now() - n * 3600000).toISOString()
const haceMin = n => new Date(Date.now() - n * 60000).toISOString()

// ── Lote de SQL ─────────────────────────────────────────────────────────────
// Todo lo que inserta/actualiza se acumula y se ejecuta de una vez, en una sola
// transacción con triggers apagados: o queda todo o no queda nada.
const lote = []
const lit = v => v === null || v === undefined ? 'null'
  : typeof v === 'number' || typeof v === 'boolean' ? String(v)
  : `'${String(v).replace(/'/g, "''")}'`

/** INSERT de filas. Las filas con distintas claves se agrupan solas: a las que no declaran una columna se les deja el default de la tabla. */
function ins(tabla, filas) {
  const grupos = new Map()
  for (const f of filas) {
    const k = Object.keys(f).sort().join(',')
    if (!grupos.has(k)) grupos.set(k, [])
    grupos.get(k).push(f)
  }
  for (const [k, rows] of grupos) {
    const cols = k.split(',').map(c => `"${c}"`).join(', ')
    const json = JSON.stringify(rows)
    if (json.includes('$a1d0$')) throw new Error('el JSON contiene el delimitador')
    lote.push(`insert into public.${tabla} (${cols}) select ${cols} from jsonb_populate_recordset(null::public.${tabla}, $a1d0$${json}$a1d0$::jsonb);`)
  }
}
const upd = (tabla, set, where) =>
  lote.push(`update public.${tabla} set ${Object.entries(set).map(([k, v]) => `"${k}" = ${lit(v)}`).join(', ')} where ${where};`)

const TABLAS_CLINICAS = ['clinical_entries', 'clinical_allergies', 'clinical_conditions', 'clinical_medications', 'clinical_observations']
const triggersRetencion = accion =>
  sql(TABLAS_CLINICAS.map(t => `alter table public.${t} ${accion} trigger ${t}_no_delete;`).join('\n'))

// ── PDFs de prueba ──────────────────────────────────────────────────────────
// Un PDF mínimo y válido, sin dependencias. Sin acentos a propósito: la fuente
// estándar de PDF no los dibuja bien sin declarar la codificación.
function pdfSimple(lineas) {
  const limpio = s => s.replace(/[()\\]/g, '')
  const contenido = 'BT /F1 16 Tf 60 780 Td ' + lineas.map(l => `(${limpio(l)}) Tj 0 -26 Td`).join(' ') + ' ET'
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${contenido.length} >>\nstream\n${contenido}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let out = '%PDF-1.4\n'
  const offs = []
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n` })
  const xref = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return Buffer.from(out, 'latin1')
}

async function subir(bucket, path, buffer) {
  const { error } = await db.storage.from(bucket).upload(path, buffer, { upsert: true, contentType: 'application/pdf' })
  if (error) throw new Error(`storage ${bucket}/${path}: ${error.message}`)
}

// ── Limpieza ────────────────────────────────────────────────────────────────
async function limpiar() {
  // Familiar (modelo de la migración 181): borrar el vínculo no borra el
  // perfil, así que se saca el usuario aparte.
  const FAMILIAR_VINCULO = uid('fam', 1)
  const { data: vinc } = await db.from('family_members').select('familiar_id').eq('id', FAMILIAR_VINCULO).maybeSingle()

  await triggersRetencion('disable')
  try {
    await sql(`
      delete from public.clinical_entries     where id::text like ${PREFIJO};
      delete from public.clinical_medications where id::text like ${PREFIJO};
      delete from public.clinical_conditions  where id::text like ${PREFIJO};
    `)
  } finally {
    await triggersRetencion('enable')
  }

  await sql(`
    delete from public.emergency_tracking where emergency_id::text like ${PREFIJO};
    delete from public.payments           where id::text like ${PREFIJO};
    delete from public.patient_credits    where id::text like ${PREFIJO};
    delete from public.notificaciones     where id::text like ${PREFIJO};
    delete from public.medication_order_delivery_codes where order_id::text like ${PREFIJO};
    delete from public.medication_order_items where id::text like ${PREFIJO};
    delete from public.medication_orders  where id::text like ${PREFIJO};
    delete from public.email_log          where id::text like ${PREFIJO};
    delete from public.clinical_encounters where id::text like ${PREFIJO};
    delete from public.consultation_events where consultation_id::text like ${PREFIJO};
    delete from public.consultations      where id::text like ${PREFIJO};
    delete from public.emergencies        where id::text like ${PREFIJO};
    delete from public.nutrition_plans    where id::text like ${PREFIJO};
    delete from public.diagnostic_reports where id::text like ${PREFIJO};
    delete from public.pets               where id::text like ${PREFIJO};
    delete from public.patient_addresses  where id::text like ${PREFIJO};
    delete from public.pharmacy_products  where id::text like ${PREFIJO};
    delete from public.family_members     where id = '${FAMILIAR_VINCULO}';
    -- El Móvil 1 vuelve a disponible sólo si ningún traslado vivo lo usa.
    update public.ambulances set status = 'disponible'
     where id = '${MOVIL_1}' and status = 'en_servicio'
       and not exists (select 1 from public.emergencies where ambulance_id = '${MOVIL_1}' and status in ('dispatched','in_transit','arrived'));
  `)

  if (vinc?.familiar_id) {
    const { error } = await db.auth.admin.deleteUser(vinc.familiar_id)
    if (error) console.log(`   (aviso) no se pudo borrar el usuario del familiar: ${error.message}`)
  }

  if (LIMPIAR_SOLO) {
    // Con --limpiar también se van los pacientes demo propios y los archivos
    // de prueba. En una corrida normal quedan: re-crearlos dispararía de nuevo
    // el mail de bienvenida.
    for (const p of DEMOS) {
      await sql(`delete from public.profiles where id = '${p.id}';`)
      await db.auth.admin.deleteUser(p.id)
    }
    await db.storage.from('prescriptions').remove(['a1d0/receta-A.pdf', 'a1d0/receta-B.pdf'])
    await db.storage.from('professional-docs').remove(
      ['titulo', 'matricula', 'dni', 'seguro_mala_praxis', 'cuit'].map(n => `${PENDIENTE}/${n}.pdf`))
    // Lo que se les puso a las cuentas demo existentes vuelve a nulo (era nulo).
    await sql(`
      update public.professional_profiles
         set title_document_url = null, license_document_url = null, dni_document_url = null,
             malpractice_insurance_document_url = null, cuit_document_url = null, cuit_number = null
       where user_id = '${PENDIENTE}';
      update public.professional_profiles
         set address = null, latitude = null, longitude = null, mp_account_label = null
       where user_id = '${CLINICA.id}' and address = 'Av. Santa Fe 1234, Recoleta, CABA';
    `)
  }
  console.log('🧹 limpiado')
}

// ── Preflight ───────────────────────────────────────────────────────────────
async function preflight() {
  const necesarios = [CLINICA.id, PENDIENTE, NUTRICION, PAC_C, PAC_I, DESPACHO_ID, OPERADOR_ID, CHOFER_ID, MEDICO_MOVIL_1]
  const { data } = await db.from('profiles').select('id').in('id', necesarios)
  const faltan = necesarios.filter(id => !(data ?? []).some(p => p.id === id))
  if (faltan.length) throw new Error(`Faltan cuentas demo (${faltan.join(', ')}). Corré antes seed-staging.mjs y seed-despacho.mjs.`)
  const { data: ph } = await db.from('pharmacies').select('id').eq('id', PHARMACY_ID).maybeSingle()
  if (!ph) throw new Error('No existe la farmacia demo en staging.')
  const { data: ent } = await db.from('emergency_providers').select('id').eq('id', ENTIDAD_ID).maybeSingle()
  if (!ent) throw new Error('No existe la entidad de despacho (seed-despacho.mjs).')
}

async function crearPacientesDemo() {
  for (const p of DEMOS) {
    const { error } = await db.auth.admin.createUser({
      id: p.id, email: p.email, password: PASSWORD, email_confirm: true,
      user_metadata: { role: 'patient', full_name: `${p.first} ${p.last}` },
    })
    if (error && !/already|registered/i.test(error.message)) throw new Error(`${p.email}: ${error.message}`)
  }
  // El trigger de alta ya creó `profiles`; falta asegurarse de que exista antes
  // de completarla (el UPDATE va en el lote).
  const { data } = await db.from('profiles').select('id').in('id', DEMOS.map(p => p.id))
  if ((data ?? []).length !== DEMOS.length) throw new Error('El trigger de alta no creó los perfiles de los pacientes demo.')
  for (const p of DEMOS) {
    upd('profiles', {
      full_name: `${p.first} ${p.last}`, first_name: p.first, last_name: p.last, role: 'patient',
      dni: p.dni, gender: p.gender, birth_date: p.birth, phone: p.phone, address: p.address,
      coverage_type: 'particular',
    }, `id = '${p.id}'`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. PACIENTE paciente.completo
// ─────────────────────────────────────────────────────────────────────────────
const RESUMEN = {}
const cuenta = (k, n) => { RESUMEN[k] = (RESUMEN[k] ?? 0) + n }

// Consultas (de la clínica). Los ids se usan en pagos, recetas y avisos.
const K = {
  hoyVideo: uid('cons', 1), hoyPres: uid('cons', 2), pendiente: uid('cons', 3),
  done1: uid('cons', 4), done2: uid('cons', 5), done3: uid('cons', 6), done4: uid('cons', 7),
  doneRecetaB: uid('cons', 8), cancelPend: uid('cons', 9), cancelCredito: uid('cons', 10), rechazada: uid('cons', 11),
}
const ENC = { a: uid('enc', 1), b: uid('enc', 2) }
const RECETA = { A: 'A1D0-RCTA-0001', B: 'A1D0-RCTA-0002' }

function sembrarConsultas() {
  const comun = { vertical: 'salud', coverage_type: 'particular', is_on_demand: false }
  const filas = [
    // Agenda de hoy y un turno por confirmar (lo que ve la profesional).
    { id: K.hoyVideo, patient_id: P1, professional_id: CLINICA.id, status: 'confirmed', modality: 'video', scheduled_at: en(0, 10, 0),
      price_at_booking: 18000, payment_status: 'paid', paid_at: en(-1, 20, 5),
      preconsulta_data: { version: 2, motivo: 'Dolor de garganta', sintomas: ['Dolor al tragar', 'Fiebre leve'], desde: 'hace 2 días' }, ...comun },
    { id: K.hoyPres, patient_id: P2, professional_id: CLINICA.id, status: 'confirmed', modality: 'presencial', scheduled_at: en(0, 16, 30),
      price_at_booking: 22000, payment_status: 'paid', paid_at: en(-2, 11, 40), ...comun },
    { id: K.pendiente, patient_id: P3, professional_id: CLINICA.id, status: 'pending', modality: 'video', scheduled_at: en(1, 11, 0),
      price_at_booking: 18000, payment_status: 'paid', paid_at: haceHoras(3), ...comun },
    // Completadas este mes (alimentan Ganancias).
    { id: K.done1, patient_id: P1, professional_id: CLINICA.id, status: 'completed', modality: 'video', scheduled_at: en(-1, 15, 20), completed_at: en(-1, 15, 52),
      price_at_booking: 18000, payment_status: 'paid', paid_at: en(-3, 9, 0),
      closing_notes: 'Cuadro viral de vías aéreas altas. Reposo e hidratación. Control si persiste la fiebre más de 72 h.', ...comun },
    // La que el paciente completo ve con resumen y recetas A.
    { id: K.done2, patient_id: PAC_C, professional_id: CLINICA.id, status: 'completed', modality: 'video', scheduled_at: en(-2, 10, 40), completed_at: en(-2, 11, 14),
      price_at_booking: 18000, payment_status: 'paid', paid_at: en(-4, 18, 30),
      closing_notes: 'Faringitis aguda bacteriana. Se indica tratamiento antibiótico por 7 días y analgésico. Control en 10 días o antes si empeora.', ...comun },
    { id: K.done3, patient_id: P2, professional_id: CLINICA.id, status: 'completed', modality: 'presencial', scheduled_at: en(-3, 17, 10), completed_at: en(-3, 17, 45),
      price_at_booking: 22000, payment_status: 'paid', paid_at: en(-5, 10, 15),
      closing_notes: 'Control de rutina sin hallazgos. Se solicita laboratorio anual.', ...comun },
    { id: K.done4, patient_id: P3, professional_id: CLINICA.id, status: 'completed', modality: 'video', scheduled_at: en(-4, 12, 30), completed_at: en(-4, 13, 0),
      price_at_booking: 18000, payment_status: 'paid', paid_at: en(-6, 8, 45),
      closing_notes: 'Cefalea tensional. Pautas de descanso y analgesia a demanda.', ...comun },
    // Más vieja, con las recetas B (hipertensión y colesterol).
    { id: K.doneRecetaB, patient_id: PAC_C, professional_id: CLINICA.id, status: 'completed', modality: 'video', scheduled_at: en(-20, 11, 15), completed_at: en(-20, 11, 48),
      price_at_booking: 18000, payment_status: 'paid', paid_at: en(-22, 19, 0),
      closing_notes: 'Hipertensión controlada con tratamiento actual. Se suma estatina por perfil lipídico.', ...comun },
    // Cancelada con pedido de devolución pendiente de revisión.
    { id: K.cancelPend, patient_id: PAC_C, professional_id: CLINICA.id, status: 'cancelled', modality: 'video', scheduled_at: en(-1, 9, 50),
      price_at_booking: 18000, payment_status: 'paid', paid_at: en(-3, 14, 0), cancelled_at: en(-2, 16, 20), cancelled_by: PAC_C,
      cancel_reason: 'No puedo asistir por un imprevisto laboral', ...comun },
    // Cancelada y devuelta como Healthy Credits.
    { id: K.cancelCredito, patient_id: PAC_C, professional_id: CLINICA.id, status: 'cancelled', modality: 'video', scheduled_at: en(-9, 14, 40),
      price_at_booking: 18000, payment_status: 'refunded', paid_at: en(-14, 10, 0), cancelled_at: en(-12, 9, 30), cancelled_by: PAC_C,
      cancel_reason: 'Cambio de horario', ...comun },
    // Pago rechazado: la reserva no se concretó.
    { id: K.rechazada, patient_id: PAC_I, professional_id: CLINICA.id, status: 'cancelled', modality: 'video', scheduled_at: en(-6, 16, 50),
      price_at_booking: 18000, payment_status: 'rejected', cancelled_at: en(-6, 12, 0), cancelled_by: PAC_I,
      cancel_reason: 'El pago fue rechazado', ...comun },
  ]
  ins('consultations', filas)
  cuenta('consultas', filas.length)
}

const COMISION = 0.22
const MP_FEE = 0.0799
function filaPago(n, extra) {
  const bruto = extra.gross_amount
  const comision = Math.round(bruto * COMISION)
  const mp = Math.round(bruto * MP_FEE)
  return {
    id: uid('pay', n), method: 'card', gross_amount: bruto, credits_used: 0, charged_amount: bruto,
    platform_fee: comision, mp_fee_estimated: mp, net_to_professional: bruto - comision - mp,
    currency: 'ARS', ...extra,
  }
}

function sembrarPagosDeConsultas() {
  const aprobado = (n, consulta, paciente, bruto, creado) => filaPago(n, {
    consultation_id: consulta, patient_id: paciente, professional_id: CLINICA.id, gross_amount: bruto,
    status: 'approved', mp_payment_id: `a1d0-mp-${String(n).padStart(4, '0')}`, created_at: creado,
    authorized_at: creado, captured_at: creado,
  })
  const filas = [
    aprobado(1, K.hoyVideo, P1, 18000, en(-1, 20, 5)),
    aprobado(2, K.hoyPres, P2, 22000, en(-2, 11, 40)),
    aprobado(3, K.pendiente, P3, 18000, haceHoras(3)),
    aprobado(4, K.done1, P1, 18000, en(-3, 9, 0)),
    aprobado(5, K.done2, PAC_C, 18000, en(-4, 18, 30)),
    aprobado(6, K.done3, P2, 22000, en(-5, 10, 15)),
    aprobado(7, K.done4, P3, 18000, en(-6, 8, 45)),
    aprobado(8, K.doneRecetaB, PAC_C, 18000, en(-22, 19, 0)),
    // Devolución pendiente de revisión: lo que muestran las tarjetas de /super-admin/pagos.
    { ...aprobado(9, K.cancelPend, PAC_C, 18000, en(-3, 14, 0)),
      refund_request_status: 'pending', refund_requested_at: en(-2, 16, 25),
      refund_request_reason: 'No puedo asistir por un imprevisto laboral' },
    // Devuelta como Healthy Credits (aprobada por el super admin).
    { ...aprobado(10, K.cancelCredito, PAC_C, 18000, en(-14, 10, 0)),
      status: 'refunded', refund_type: 'credit', refunded_at: en(-12, 11, 0), refund_reason: 'Cancelación del paciente con más de 48 h',
      refund_request_status: 'approved', refund_requested_at: en(-12, 9, 35), refund_reviewed_at: en(-12, 11, 0) },
    // Rechazado por el medio de pago.
    filaPago(11, {
      consultation_id: K.rechazada, patient_id: PAC_I, professional_id: CLINICA.id, gross_amount: 18000,
      status: 'rejected', status_detail: 'cc_rejected_insufficient_amount', created_at: en(-6, 12, 0),
    }),
  ]
  ins('payments', filas)
  cuenta('pagos de consultas', filas.length)

  // Healthy Credits: el saldo del paciente sale de este libro.
  ins('patient_credits', [{
    id: uid('cred', 1), patient_id: PAC_C, amount: 18000, reason: 'refund', consultation_id: K.cancelCredito,
    payment_id: uid('pay', 10), note: 'Devolución por cancelación de la consulta', created_at: en(-12, 11, 0),
  }])
  cuenta('movimientos de Healthy Credits', 1)
}

function sembrarHistoriaYRecetas(urlPdf) {
  const lic = { professional_license_type: 'MN', professional_license_number: CLINICA.matricula }

  ins('clinical_encounters', [
    { id: ENC.a, consultation_id: K.done2, patient_id: PAC_C, professional_id: CLINICA.id, modality: 'telemedicina', specialty: 'medicina_general',
      status: 'finished', started_at: en(-2, 10, 40), finished_at: en(-2, 11, 14), ...lic },
    { id: ENC.b, consultation_id: K.doneRecetaB, patient_id: PAC_C, professional_id: CLINICA.id, modality: 'telemedicina', specialty: 'medicina_general',
      status: 'finished', started_at: en(-20, 11, 15), finished_at: en(-20, 11, 48), ...lic },
  ])

  const entrada = (n, enc, tipo, seq, content) => ({
    id: uid('ent', n), encounter_id: enc, patient_id: PAC_C, professional_id: CLINICA.id, entry_type: tipo,
    sequence_number: seq, content, ...lic,
  })
  ins('clinical_entries', [
    entrada(1, ENC.a, 'consultation', 1,
`Motivo: Dolor de garganta

Enfermedad actual: Odinofagia de 3 días de evolución con fiebre de hasta 38,3 °C, sin tos ni dificultad respiratoria.

Vitales: TA 120/78 · FC 84 lpm · SatO2 98% · Temp 37,9 °C

Examen físico: Orofaringe hiperémica con exudado tonsilar. Adenopatías cervicales dolorosas.

Diagnóstico:
- Faringitis aguda (J02.9)`),
    entrada(2, ENC.a, 'indication', 2, 'Reposo relativo e hidratación abundante. Completar el antibiótico aunque mejoren los síntomas. Consultar por guardia ante dificultad para respirar o para tragar saliva.'),
    entrada(3, ENC.b, 'consultation', 1,
`Motivo: Control de hipertensión

Enfermedad actual: Paciente con hipertensión en tratamiento. Refiere buena adherencia, sin cefaleas ni mareos.

Vitales: TA 128/82 · FC 74 lpm

Diagnóstico:
- Hipertensión esencial (I10)
- Dislipemia (E78.5)`),
  ])

  ins('clinical_conditions', [
    { id: uid('cond', 1), patient_id: PAC_C, encounter_id: ENC.a, professional_id: CLINICA.id, icd10_code: 'J02.9', icd10_display: 'Faringitis aguda, no especificada',
      clinical_status: 'active', verification_status: 'confirmed', ...lic },
    { id: uid('cond', 2), patient_id: PAC_C, encounter_id: ENC.b, professional_id: CLINICA.id, icd10_code: 'E78.5', icd10_display: 'Hiperlipidemia, no especificada',
      clinical_status: 'active', verification_status: 'confirmed', ...lic },
  ])

  // Recetas electrónicas: la fila de la base es el MEDICAMENTO; la receta es el
  // `rcta_prescription_id` compartido (ver historiaClinicaService.getIssuedPrescriptions).
  const med = (n, enc, receta, emitida, m) => ({
    id: uid('med', n), patient_id: PAC_C, encounter_id: enc, professional_id: CLINICA.id, status: 'active', priority: 'routine',
    rcta_prescription_id: receta, rcta_status: 'issued', rcta_issued_at: emitida, rcta_pdf_url: urlPdf[receta],
    rcta_transaction_id: `A1D0TX${n}`, rcta_verificador: `A1D0V${n}`, created_at: emitida, route: 'Oral', ...lic, ...m,
  })
  ins('clinical_medications', [
    med(1, ENC.a, RECETA.A, en(-2, 11, 10), { medication_name: 'Ibuprofeno 600 mg', nombre_droga: 'Ibuprofeno', presentation: 'Comprimidos x 30', concentration: '600 mg',
      dosage_text: '1 comprimido cada 8 horas con las comidas', frequency: 'cada 8 h', duration_days: 5, quantity: '1 caja', is_chronic: false, cie10_code: 'J02.9', cie10_display: 'Faringitis aguda' }),
    med(2, ENC.a, RECETA.A, en(-2, 11, 10), { medication_name: 'Amoxicilina 500 mg', nombre_droga: 'Amoxicilina', presentation: 'Comprimidos x 21', concentration: '500 mg',
      dosage_text: '1 comprimido cada 8 horas durante 7 días', frequency: 'cada 8 h', duration_days: 7, quantity: '1 caja', is_chronic: false, cie10_code: 'J02.9', cie10_display: 'Faringitis aguda' }),
    med(3, ENC.b, RECETA.B, en(-20, 11, 45), { medication_name: 'Enalapril 10 mg', nombre_droga: 'Enalapril', presentation: 'Comprimidos x 30', concentration: '10 mg',
      dosage_text: '1 comprimido cada 12 horas', frequency: 'cada 12 h', duration_days: 30, quantity: '1 caja', is_chronic: true, cie10_code: 'I10', cie10_display: 'Hipertensión esencial' }),
    med(4, ENC.b, RECETA.B, en(-20, 11, 45), { medication_name: 'Atorvastatina 20 mg', nombre_droga: 'Atorvastatina', presentation: 'Comprimidos x 30', concentration: '20 mg',
      dosage_text: '1 comprimido por la noche', frequency: 'cada 24 h', duration_days: 30, quantity: '1 caja', is_chronic: true, cie10_code: 'E78.5', cie10_display: 'Dislipemia' }),
  ])
  cuenta('encuentros clínicos', 2)
  cuenta('entradas de historia', 3)
  cuenta('recetas emitidas (4 medicamentos)', 2)
}

// Plan nutricional: mismo formato que arma el NutriPlan del profesional.
function sembrarPlanNutricional(yaHayPlan) {
  if (yaHayPlan) { RESUMEN['plan nutricional'] = 'ya existía uno activo (no se toca)'; return }
  const meals = [
    { id: 'm1', name: 'Desayuno', time: '08:00' }, { id: 'm2', name: 'Almuerzo', time: '12:30' },
    { id: 'm3', name: 'Merienda', time: '16:30' }, { id: 'm4', name: 'Cena', time: '20:30' },
  ]
  // [id, nombre, categoría, kcal, prot, carb, grasa, fibra] por cada 100 g
  const base = [
    ['l101', 'Avena arrollada', 'Cereales', 379, 13.2, 67.7, 6.5, 10.1],
    ['l074', 'Yogur griego', 'Lácteos', 59, 10, 3.6, 0.4, 0],
    ['l110', 'Banana', 'Frutas', 89, 1.1, 22.8, 0.3, 2.6],
    ['l060', 'Huevo entero', 'Huevos', 143, 12.5, 0.7, 9.5, 0],
    ['l020', 'Pechuga de pollo sin piel', 'Aves', 120, 23, 0, 2.5, 0],
    ['l130', 'Arroz integral cocido', 'Cereales', 111, 2.6, 23, 0.9, 1.8],
    ['l140', 'Ensalada mixta', 'Verduras', 20, 1.3, 3.7, 0.2, 1.8],
    ['l190', 'Palta', 'Frutas', 160, 2, 8.5, 14.7, 6.7],
    ['l170', 'Manzana', 'Frutas', 52, 0.3, 14, 0.2, 2.4],
    ['l180', 'Nueces', 'Frutos secos', 654, 15, 14, 65, 6.7],
    ['l150', 'Salmón rosado', 'Pescados', 208, 20, 0, 13, 0],
    ['l160', 'Batata hervida', 'Verduras', 86, 1.6, 20, 0.1, 3],
  ]
  // gramos por comida
  const dist = {
    l101: { m1: 50 }, l074: { m1: 170, m3: 125 }, l110: { m1: 120 }, l060: { m1: 120 },
    l020: { m2: 180 }, l130: { m2: 150 }, l140: { m2: 150, m4: 150 }, l190: { m2: 60 },
    l170: { m3: 180 }, l180: { m3: 25 }, l150: { m4: 140 }, l160: { m4: 200 },
  }
  const r1 = n => Math.round(n * 10) / 10
  const foods = base.map(([id, name, category, calories, protein, carbs, fat, fiber]) => {
    const q = Object.values(dist[id]).reduce((a, g) => a + g, 0)
    const f = q / 100
    return { id, name, category, calories, protein, carbs, fat, fiber,
      consumedQuantity: q, consumedCalories: Math.round(calories * f), consumedProtein: r1(protein * f),
      consumedCarbs: r1(carbs * f), consumedFat: r1(fat * f), consumedFiber: r1(fiber * f) }
  })
  // Mismo cálculo que calculateNutrition (Mifflin-St Jeor, déficit de 500 kcal).
  const peso = 81.5, alto = 178, edad = 36, act = 1.55
  const bmr = 10 * peso + 6.25 * alto - 5 * edad + 5
  const tdee = bmr * act
  const kcal = tdee - 500
  const pG = peso * 2.2, fG = peso * 0.8
  const cG = Math.max(0, (kcal - pG * 4 - fG * 9) / 4)
  ins('nutrition_plans', [{
    id: uid('plan', 1), patient_id: PAC_C, professional_id: NUTRICION, status: 'active', gender: 'male', age: edad,
    weight_kg: peso, height_cm: alto, activity_level: act, diet_type: 'hypocaloric',
    target_calories: Math.round(kcal), target_protein_g: Math.round(pG), target_carbs_g: Math.round(cG), target_fat_g: Math.round(fG),
    target_fiber_g: Math.round(kcal / 1000 * 14), bmr: Math.round(bmr), tdee: Math.round(tdee), bmi: r1(peso / ((alto / 100) ** 2)),
    meals, foods, food_distribution: dist,
    notes: 'Plan de descenso gradual. Priorizar proteínas en cada comida, tomar 2 litros de agua por día y moderar los ultraprocesados.',
  }])
  cuenta('plan nutricional', 1)
}

function sembrarEstudios() {
  const p = (i, name, unit, value, min, max) => ({ id: String(i), name, unit, value, min, max })
  const antiguo = [
    p(0, 'Hemoglobina', 'g/dL', 13.1, 13.5, 17.5), p(1, 'Glucemia en ayunas', 'mg/dL', 104, 70, 99),
    p(2, 'Colesterol total', 'mg/dL', 228, 0, 200), p(3, 'LDL Colesterol', 'mg/dL', 148, 0, 100),
    p(4, 'HDL Colesterol', 'mg/dL', 38, 40, 0), p(5, 'Triglicéridos', 'mg/dL', 176, 0, 150),
    p(6, 'TSH', 'uUI/mL', 2.4, 0.4, 4), p(7, 'Creatinina', 'mg/dL', 0.9, 0.7, 1.3),
  ]
  const reciente = [
    p(0, 'Hemoglobina', 'g/dL', 14.2, 13.5, 17.5), p(1, 'Glucemia en ayunas', 'mg/dL', 94, 70, 99),
    p(2, 'Colesterol total', 'mg/dL', 192, 0, 200), p(3, 'LDL Colesterol', 'mg/dL', 112, 0, 100),
    p(4, 'HDL Colesterol', 'mg/dL', 44, 40, 0), p(5, 'Triglicéridos', 'mg/dL', 138, 0, 150),
    p(6, 'TSH', 'uUI/mL', 2.1, 0.4, 4), p(7, 'Creatinina', 'mg/dL', 0.9, 0.7, 1.3),
  ]
  const dia = n => en(n, 9, 0).slice(0, 10)
  ins('diagnostic_reports', [
    { id: uid('rep', 1), patient_id: PAC_C, report_date: dia(-75), study_type: 'Laboratorio general', parameters: antiguo, created_at: en(-74, 10, 0) },
    { id: uid('rep', 2), patient_id: PAC_C, report_date: dia(-12), study_type: 'Laboratorio general', parameters: reciente, created_at: en(-11, 10, 0) },
  ])
  cuenta('estudios BioVisor (8 parámetros c/u)', 2)
}

function sembrarPerfilDelPaciente() {
  ins('pets', [
    { id: uid('pet', 1), owner_id: PAC_C, nombre: 'Mora', especie: 'perro', raza: 'Labrador', fecha_nacimiento: '2019-05-10', peso_kg: 28.5, notas: 'Vacunas al día.' },
    { id: uid('pet', 2), owner_id: PAC_C, nombre: 'Simón', especie: 'gato', raza: 'Siamés', fecha_nacimiento: '2021-09-02', peso_kg: 4.2 },
  ])
  ins('patient_addresses', [
    { id: uid('dir', 1), patient_id: PAC_C, etiqueta: 'Casa', direccion: 'Av. Cabildo 2040, CABA', piso_depto: '5° B',
      referencias: 'Timbre 5B. Portería de 8 a 20.', lat: -34.5617, lng: -58.4569, principal: true },
    // Direcciones de los pacientes demo (despacho y farmacia).
    ...DEMOS.map((d, i) => ({ id: uid('dir', 10 + i), patient_id: d.id, etiqueta: 'Casa', direccion: d.address, principal: true })),
  ])
  cuenta('mascotas', 2)
  cuenta('direcciones', 1 + DEMOS.length)
}

function sembrarNotificaciones() {
  const n = (i, tipo, titulo, cuerpo, url, creada, leida) => ({
    id: uid('not', i), user_id: PAC_C, tipo, titulo, cuerpo, url, created_at: creada, leida_at: leida ? creada : null,
  })
  ins('notificaciones', [
    n(1, 'receta-emitida', 'Tenés una receta nueva', 'La Dra. Valentina Ortega te emitió una receta electrónica.', '/paciente/recetas', haceHoras(2), false),
    n(2, 'pedido-en-camino', 'Tu pedido está en camino', 'Mostrá el código de entrega cuando llegue el repartidor.', `/paciente/farmacia/pedido/${uid('ord', 4)}`, haceHoras(5), false),
    n(3, 'turno-confirmado', 'Turno confirmado', 'Tu consulta con la Dra. Valentina Ortega quedó confirmada.', '/paciente/consultas', en(-4, 18, 31), true),
    n(4, 'post-consulta', 'Tu consulta terminó', 'Ya podés ver el resumen y tus recetas.', `/paciente/consulta/resumen/${K.done2}`, en(-2, 11, 16), true),
    n(5, 'consulta-cancelada', 'Cancelaste tu consulta', 'Pediste la devolución del importe. La estamos revisando.', '/paciente/consultas', en(-2, 16, 21), true),
    n(6, 'devolucion-hecha', 'Te devolvimos el importe', 'Acreditamos $18.000 en tus Healthy Credits.', '/paciente/comprobantes', en(-12, 11, 1), true),
  ])
  cuenta('notificaciones (2 sin leer)', 6)
}

// El familiar sigue el modelo de la migración 181: el INSERT en family_members
// dispara el trigger que crea su usuario y su perfil, por eso va por PostgREST
// (con triggers) y no por el lote.
async function sembrarFamiliar() {
  const { data, error } = await db.from('family_members')
    .insert({ id: uid('fam', 1), patient_id: PAC_C, full_name: 'Benjamín Rodríguez', relationship: 'Hijo', dni: '56234981' })
    .select().single()
  if (error) throw new Error(`family_members: ${error.message}`)
  if (!data?.familiar_id) throw new Error('el vínculo no trajo familiar_id (¿falló el trigger?)')
  const { error: e2 } = await db.from('profiles').update({
    birth_date: '2018-03-14', gender: 'masculino', first_name: 'Benjamín', last_name: 'Rodríguez',
  }).eq('id', data.familiar_id)
  if (e2) throw new Error(`perfil del familiar: ${e2.message}`)
  cuenta('familiares (Benjamín, 8 años, con DNI y nacimiento)', 1)
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. FARMACIA
// ─────────────────────────────────────────────────────────────────────────────
const ORD = { o1: uid('ord', 1), o2: uid('ord', 2), o3: uid('ord', 3), o4: uid('ord', 4), o5: uid('ord', 5), o6: uid('ord', 6) }
const PROD = {
  atorva: uid('prod', 1), enalapril: uid('prod', 2), omeprazolAgotado: uid('prod', 3), vitD: uid('prod', 4),
}

async function sembrarFarmacia() {
  const productos = [
    { id: PROD.atorva, name: 'Atorvastatina 20 mg x 30', description: 'Comprimidos recubiertos. Venta bajo receta.', category: 'clinica', price: 12400,
      in_stock: true, featured: false, medication_match: 'atorvastatina', sku: 'A1D0-001', presentation: 'Caja x 30', stock_quantity: 18,
      pharmacy_id: PHARMACY_ID, prescription_type: 'receta' },
    { id: PROD.enalapril, name: 'Enalapril 10 mg x 30', description: 'Comprimidos. Venta bajo receta.', category: 'clinica', price: 5300,
      in_stock: true, featured: false, medication_match: 'enalapril', sku: 'A1D0-002', presentation: 'Caja x 30', stock_quantity: 25,
      pharmacy_id: PHARMACY_ID, prescription_type: 'receta' },
    // Agotado: sirve para mostrar la marca "Sin stock" del catálogo.
    { id: PROD.omeprazolAgotado, name: 'Omeprazol 40 mg x 14', description: 'Cápsulas de liberación retardada.', category: 'clinica', price: 6900,
      in_stock: false, featured: false, medication_match: 'omeprazol 40', sku: 'A1D0-003', presentation: 'Caja x 14', stock_quantity: 0,
      pharmacy_id: PHARMACY_ID, prescription_type: 'venta_libre' },
    { id: PROD.vitD, name: 'Vitamina D3 2000 UI x 60', description: 'Suplemento dietario.', category: 'bienestar', price: 8700,
      in_stock: true, featured: true, medication_match: null, sku: 'A1D0-004', presentation: 'Frasco x 60 cápsulas', stock_quantity: 40,
      pharmacy_id: PHARMACY_ID, prescription_type: 'venta_libre' },
  ]
  ins('pharmacy_products', productos)

  // Productos que ya existen en el catálogo (se leen, no se tocan).
  const nombres = ['Ibuprofeno 600mg x 30', 'Amoxicilina 500mg x 21', 'Omeprazol 20mg x 14', 'Ibuprofeno pediátrico jarabe']
  const { data: existentes, error } = await db.from('pharmacy_products').select('id, name, price, prescription_type')
    .eq('pharmacy_id', PHARMACY_ID).in('name', nombres).eq('in_stock', true)
  if (error) throw new Error(`catálogo: ${error.message}`)
  const por = n => {
    const fila = (existentes ?? []).find(p => p.name === n)
    if (!fila) throw new Error(`Falta el producto "${n}" en el catálogo de staging.`)
    return fila
  }
  const ibu = por(nombres[0]), amox = por(nombres[1]), ome = por(nombres[2]), ibuPed = por(nombres[3])
  const dePropio = (id, nombre, precio, receta) => ({ id, name: nombre, price: precio, prescription_type: receta ? 'receta' : 'venta_libre' })
  const atorva = dePropio(PROD.atorva, 'Atorvastatina 20 mg x 30', 12400, true)
  const enal = dePropio(PROD.enalapril, 'Enalapril 10 mg x 30', 5300, true)
  const vit = dePropio(PROD.vitD, 'Vitamina D3 2000 UI x 60', 8700, false)

  // Pedidos en estados mezclados.
  const pedidos = [
    { n: 1, id: ORD.o1, paciente: P1, estado: 'pendiente', pago: 'pagado', creado: haceMin(40), dir: DEMOS[0].address,
      items: [[ibu, 2], [ome, 1]] },
    { n: 2, id: ORD.o2, paciente: P2, estado: 'pendiente', pago: 'exento', creado: haceMin(75), dir: DEMOS[1].address,
      items: [[ibuPed, 1], [vit, 1]] },
    { n: 3, id: ORD.o3, paciente: P3, estado: 'en_preparacion', pago: 'pagado', creado: haceHoras(3), dir: DEMOS[2].address,
      items: [[amox, 1], [ibu, 1]] },
    // El que ve el paciente completo con seguimiento y código de entrega.
    { n: 4, id: ORD.o4, paciente: PAC_C, estado: 'enviado', pago: 'pagado', creado: haceHoras(6), dir: 'Av. Cabildo 2040, 5° B, CABA',
      rcta: RECETA.B, items: [[enal, 1], [atorva, 1]] },
    { n: 5, id: ORD.o5, paciente: PAC_I, estado: 'entregado', pago: 'pagado', creado: en(-2, 12, 0), dir: 'Av. Santa Fe 1234, CABA',
      items: [[ome, 1], [vit, 2]] },
    { n: 6, id: ORD.o6, paciente: P1, estado: 'cancelado', pago: 'no_pagado', creado: en(-1, 17, 30), dir: DEMOS[0].address,
      motivo: 'Sin stock del medicamento solicitado. Te avisamos cuando vuelva a estar disponible.', items: [[amox, 1]] },
  ]
  let item = 0
  const filasPedido = [], filasItem = [], filasPago = []
  for (const p of pedidos) {
    const subtotal = p.items.reduce((a, [prod, q]) => a + Number(prod.price) * q, 0)
    filasPedido.push({
      id: p.id, patient_id: p.paciente, pharmacy_id: PHARMACY_ID, status: p.estado, payment_status: p.pago,
      delivery_address: p.dir, subtotal, total: subtotal, created_at: p.creado, updated_at: p.creado,
      cancellation_reason: p.motivo ?? null, rcta_prescription_id: p.rcta ?? null,
    })
    for (const [prod, q] of p.items) {
      item += 1
      filasItem.push({
        id: uid('item', item), order_id: p.id, pharmacy_product_id: prod.id, medication_name: prod.name, quantity: q,
        unit_price: Number(prod.price), requires_prescription: prod.prescription_type === 'receta', created_at: p.creado,
      })
    }
    if (p.pago === 'pagado') {
      const comision = Math.round(subtotal * 0.1)
      filasPago.push({
        id: uid('pay', 100 + p.n), order_id: p.id, pharmacy_id: PHARMACY_ID, patient_id: p.paciente, method: 'card',
        gross_amount: subtotal, credits_used: 0, charged_amount: subtotal, platform_fee: comision, mp_fee_estimated: Math.round(subtotal * MP_FEE),
        net_to_professional: subtotal - comision - Math.round(subtotal * MP_FEE), currency: 'ARS', status: 'approved',
        mp_payment_id: `a1d0-mp-p${p.n}`, created_at: p.creado, authorized_at: p.creado, captured_at: p.creado,
      })
    }
  }
  ins('medication_orders', filasPedido)
  ins('medication_order_items', filasItem)
  ins('payments', filasPago)
  // El código de entrega lo genera un trigger en producción; con los triggers
  // apagados se escribe a mano. El entregado lo tiene verificado.
  ins('medication_order_delivery_codes', [
    { order_id: ORD.o4, code: '4827', attempts: 0, created_at: haceHoras(6) },
    { order_id: ORD.o5, code: '3915', attempts: 1, verified_at: en(-2, 14, 10), created_at: en(-2, 12, 0) },
  ])
  cuenta('productos nuevos en el catálogo (1 agotado, todos sin foto)', productos.length)
  cuenta('pedidos de farmacia', pedidos.length)
  cuenta('pagos de pedidos', filasPago.length)
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. EMERGENCIAS
// ─────────────────────────────────────────────────────────────────────────────
const EMG = { rojo: uid('emg', 1), amarillo: uid('emg', 2), enCurso: uid('emg', 3) }

function sembrarEmergencias() {
  const filas = [
    { id: EMG.rojo, patient_id: P1, triage_code: 'ROJO', status: 'awaiting_dispatch', notes: JSON.stringify(['Dolor opresivo en el pecho', 'Dificultad para respirar']),
      patient_latitude: -34.5889, patient_longitude: -58.4306, price_at_request: 45000, paid_at: haceMin(6), preauth_id: 'a1d0-preauth-1', created_at: haceMin(8) },
    { id: EMG.amarillo, patient_id: P2, triage_code: 'AMARILLO', status: 'awaiting_dispatch', notes: JSON.stringify(['Fiebre alta persistente', 'Vómitos']),
      patient_latitude: -34.6186, patient_longitude: -58.4433, price_at_request: 45000, paid_at: haceMin(14), preauth_id: 'a1d0-preauth-2', created_at: haceMin(16) },
    // En curso: asignada al Móvil 1 (tripulan el chofer@ y un médico).
    { id: EMG.enCurso, patient_id: P3, triage_code: 'ROJO', status: 'in_transit', notes: JSON.stringify(['Caída con posible fractura', 'Dolor intenso en la pierna']),
      patient_latitude: -34.5627, patient_longitude: -58.4564, price_at_request: 45000, paid_at: haceMin(24), preauth_id: 'a1d0-preauth-3',
      created_at: haceMin(26), provider_id: ENTIDAD_ID, ambulance_id: MOVIL_1, operator_id: OPERADOR_ID, professional_id: MEDICO_MOVIL_1,
      dispatched_at: haceMin(20), dispatch_code: 'UTM-4821' },
  ]
  ins('emergencies', filas)

  ins('emergency_tracking', [{
    emergency_id: EMG.enCurso, professional_id: MEDICO_MOVIL_1, patient_id: P3, latitude: -34.5752, longitude: -58.4431,
    eta_minutes: 6, distance_meters: 2100, travel_mode: 'driving', status: 'en_camino', started_at: haceMin(18), updated_at: haceMin(0),
  }])

  // El cobro de la emergencia es una pre-autorización (se captura al cerrar).
  ins('payments', [EMG.rojo, EMG.amarillo, EMG.enCurso].map((emergencia, i) => ({
    id: uid('pay', 200 + i), emergency_id: emergencia, provider_id: ENTIDAD_ID, patient_id: [P1, P2, P3][i], method: 'card',
    gross_amount: 45000, credits_used: 0, charged_amount: 45000, platform_fee: 0, net_to_professional: 45000, currency: 'ARS',
    status: 'authorized', mp_payment_id: `a1d0-mp-e${i + 1}`, created_at: haceMin(25 - i * 8), authorized_at: haceMin(25 - i * 8),
  })))

  // El Móvil 1 pasa a ocupado (queda el 2 disponible para despachar desde la cola).
  upd('ambulances', { status: 'en_servicio' }, `id = '${MOVIL_1}'`)
  // Coordinador de ambulancias: si el super admin no eligió ninguno, queda la
  // cuenta de despacho (mecanismo de la migración 179: `es_coordinador`).
  lote.push(`update public.emergency_provider_staff set es_coordinador = true
    where provider_id = '${ENTIDAD_ID}' and profile_id = '${DESPACHO_ID}'
      and not exists (select 1 from public.emergency_provider_staff where es_coordinador and active);`)
  cuenta('emergencias (ROJO + AMARILLO esperando móvil, 1 en camino al Móvil 1)', 3)
}

// ─────────────────────────────────────────────────────────────────────────────
// 4 y 5. SUPER ADMIN y PROFESIONAL
// ─────────────────────────────────────────────────────────────────────────────
async function sembrarCuentasDemo() {
  // Documentos del profesional pendiente: PDFs de prueba en `professional-docs`,
  // con el nombre lógico que usa uploadDocument() (titulo, matricula, dni…).
  const docs = {
    titulo: ['Titulo universitario - documento de ejemplo', 'title_document_url'],
    matricula: ['Matricula profesional - documento de ejemplo', 'license_document_url'],
    dni: ['DNI - documento de ejemplo', 'dni_document_url'],
    seguro_mala_praxis: ['Seguro de mala praxis - documento de ejemplo', 'malpractice_insurance_document_url'],
    cuit: ['Constancia de CUIT - documento de ejemplo', 'cuit_document_url'],
  }
  const set = { cuit_number: '20112233445' }
  for (const [nombre, [titulo, columna]] of Object.entries(docs)) {
    const path = `${PENDIENTE}/${nombre}.pdf`
    await subir('professional-docs', path, pdfSimple([titulo, 'Dr. Nicolas Vera', 'Dato ficticio para la guia de uso']))
    set[columna] = db.storage.from('professional-docs').getPublicUrl(path).data.publicUrl
  }
  upd('professional_profiles', set, `user_id = '${PENDIENTE}'`)

  // clinica@: dirección (la receta la exige y el mapa la usa), firma y Mercado
  // Pago. mp_connected ya es una bandera de la base (no hace falta OAuth real):
  // staging ya la tiene en true, se reafirma con un rótulo de cuenta de prueba.
  upd('professional_profiles', {
    address: 'Av. Santa Fe 1234, Recoleta, CABA', latitude: -34.5953, longitude: -58.3996,
    mp_connected: true, mp_account_label: 'Cuenta de prueba (Mercado Pago)', has_signature: true,
  }, `user_id = '${CLINICA.id}'`)

  // Nombre y apellido por separado, sólo si están vacíos.
  upd('profiles', { first_name: 'Matías', last_name: 'Rodríguez' }, `id = '${PAC_C}' and first_name is null`)
  upd('profiles', { first_name: 'Valentina', last_name: 'Ortega' }, `id = '${CLINICA.id}' and first_name is null`)

  // Log de mails de /super-admin/mails.
  const msg403 = '403 {"statusCode":403,"name":"validation_error","message":"You can only send testing emails to your own email address. To send emails to other recipients, please verify a domain at resend.com/domains."}'
  const mail = (i, tipo, dest, asunto, estado, creado, extra = {}) => ({
    id: uid('mail', i), tipo, destinatario: dest, asunto, estado, resend_id: estado === 'enviado' ? `a1d0-resend-${i}` : null,
    error: estado === 'error' ? msg403 : null, created_at: creado, ...extra,
  })
  ins('email_log', [
    mail(1, 'reserva', 'paciente.completo@staging.healthier.app', 'Tu turno con la Dra. Valentina Ortega está confirmado', 'enviado', en(-4, 18, 31), { usuario_id: PAC_C, consultation_id: K.done2 }),
    mail(2, 'recordatorio', 'camila.benitez@staging.healthier.app', 'Recordatorio: tu consulta es hoy a las 10:00', 'enviado', haceHoras(2), { usuario_id: P1, consultation_id: K.hoyVideo }),
    mail(3, 'receta', 'paciente.completo@staging.healthier.app', 'Tu receta electrónica ya está disponible', 'enviado', en(-2, 11, 12), { usuario_id: PAC_C, consultation_id: K.done2 }),
    mail(4, 'pedido-estado', 'paciente.completo@staging.healthier.app', 'Tu pedido salió de la farmacia', 'enviado', haceHoras(6), { usuario_id: PAC_C, order_id: ORD.o4 }),
    mail(5, 'post-consulta', 'tomas.gimenez@staging.healthier.app', 'Gracias por tu consulta. Contanos cómo te fue', 'enviado', en(-3, 17, 50), { usuario_id: P2, consultation_id: K.done3 }),
    mail(6, 'cancelada', 'paciente.incompleto@staging.healthier.app', 'Tu consulta fue cancelada', 'error', en(-6, 12, 1), { usuario_id: PAC_I, consultation_id: K.rechazada }),
  ])
  cuenta('filas de log de mails (1 con error)', 6)
}

// ── Verificación posterior ──────────────────────────────────────────────────
// Con las foreign keys sin comprobar durante el insert, esto es lo que cierra
// el círculo: ninguna fila sembrada puede apuntar a algo que no existe.
async function verificarHuerfanos() {
  const chequeos = [
    ['consultations → pacientes', `select count(*) n from public.consultations c where c.id::text like ${PREFIJO} and not exists (select 1 from public.profiles p where p.id = c.patient_id)`],
    ['consultations → profesional', `select count(*) n from public.consultations c where c.id::text like ${PREFIJO} and not exists (select 1 from public.profiles p where p.id = c.professional_id)`],
    ['payments → consultas/pedidos/emergencias', `select count(*) n from public.payments x where x.id::text like ${PREFIJO} and ((x.consultation_id is not null and not exists (select 1 from public.consultations c where c.id = x.consultation_id)) or (x.order_id is not null and not exists (select 1 from public.medication_orders o where o.id = x.order_id)) or (x.emergency_id is not null and not exists (select 1 from public.emergencies e where e.id = x.emergency_id)))`],
    ['clinical_medications → encuentros', `select count(*) n from public.clinical_medications m where m.id::text like ${PREFIJO} and not exists (select 1 from public.clinical_encounters e where e.id = m.encounter_id)`],
    ['medication_order_items → pedidos y productos', `select count(*) n from public.medication_order_items i where i.id::text like ${PREFIJO} and (not exists (select 1 from public.medication_orders o where o.id = i.order_id) or not exists (select 1 from public.pharmacy_products p where p.id = i.pharmacy_product_id))`],
    ['emergencies → ambulancia/entidad/operador/médico', `select count(*) n from public.emergencies e where e.id::text like ${PREFIJO} and ((e.ambulance_id is not null and not exists (select 1 from public.ambulances a where a.id = e.ambulance_id)) or (e.provider_id is not null and not exists (select 1 from public.emergency_providers p where p.id = e.provider_id)) or (e.operator_id is not null and not exists (select 1 from public.profiles p where p.id = e.operator_id)) or (e.professional_id is not null and not exists (select 1 from public.profiles p where p.id = e.professional_id)))`],
    ['notificaciones/mascotas/direcciones → dueños', `select (select count(*) from public.notificaciones where id::text like ${PREFIJO} and user_id not in (select id from public.profiles)) + (select count(*) from public.pets where id::text like ${PREFIJO} and owner_id not in (select id from public.profiles)) + (select count(*) from public.patient_addresses where id::text like ${PREFIJO} and patient_id not in (select id from public.profiles)) n`],
  ]
  let mal = 0
  for (const [nombre, q] of chequeos) {
    const [{ n }] = await sql(q)
    if (Number(n) > 0) { mal += Number(n); console.log(`   ⚠️  huérfanos en ${nombre}: ${n}`) }
  }
  if (mal) throw new Error('Quedaron filas apuntando a ids que no existen (ver arriba).')
  console.log('🔗 sin huérfanos')
}

// ── Main ────────────────────────────────────────────────────────────────────
try {
  console.log(`\n🌱 Datos para la guía en STAGING (${URL})\n`)
  await preflight()
  await limpiar()
  if (LIMPIAR_SOLO) {
    console.log('\nListo: staging quedó sin los datos de la guía.\n')
    process.exit(0)
  }

  await crearPacientesDemo()

  // PDF de las recetas: bucket privado `prescriptions`, URL firmada por un año
  // (la pantalla sólo abre el link en otra pestaña).
  const urlPdf = {}
  for (const [clave, receta] of Object.entries(RECETA)) {
    const path = `a1d0/receta-${clave}.pdf`
    await subir('prescriptions', path, pdfSimple([
      'RECETA ELECTRONICA - EJEMPLO PARA LA GUIA DE USO', `Receta ${receta}`, 'Paciente: Matias Rodriguez (dato ficticio)',
      'Profesional: Dra. Valentina Ortega', 'Documento sin validez legal.',
    ]))
    const { data, error } = await db.storage.from('prescriptions').createSignedUrl(path, 60 * 60 * 24 * 365)
    if (error) throw new Error(`url firmada: ${error.message}`)
    urlPdf[receta] = data.signedUrl
  }

  const { data: planes } = await db.from('nutrition_plans').select('id')
    .eq('patient_id', PAC_C).eq('professional_id', NUTRICION).eq('status', 'active')
  const yaHayPlan = (planes ?? []).some(p => !String(p.id).startsWith('a1d0'))

  sembrarConsultas()
  sembrarPagosDeConsultas()
  sembrarHistoriaYRecetas(urlPdf)
  sembrarPlanNutricional(yaHayPlan)
  sembrarEstudios()
  sembrarPerfilDelPaciente()
  sembrarNotificaciones()
  await sembrarFarmacia()
  sembrarEmergencias()
  await sembrarCuentasDemo()

  // Todo el lote junto, en una transacción y con los triggers apagados.
  await sql(`begin;\nset local session_replication_role = replica;\n${lote.join('\n')}\ncommit;`)

  // Con triggers (los necesita): el vínculo del familiar.
  await sembrarFamiliar()
  await verificarHuerfanos()

  console.log('\n✅ Staging listo para las capturas:\n')
  for (const [k, v] of Object.entries(RESUMEN)) console.log(`   · ${k}: ${v}`)
  console.log(`
   Entradas (password: ${PASSWORD})
     paciente.completo@staging.healthier.app    → recetas, plan, estudios, mascotas, dirección, avisos, familiar, pedido enviado
     clinica@staging.healthier.app              → agenda de hoy, turno por confirmar, ganancias, MP conectado
     farmacia@staging.healthier.app             → catálogo + 6 pedidos en estados mezclados
     despacho@ / operador@ / chofer@staging.healthier.app → cola con ROJO + AMARILLO; el chofer ve su emergencia asignada
     superadmin@healthier.app                   → pagos con devolución pendiente, profesional pendiente con documentos, mails
`)
} catch (err) {
  console.error('\n❌', err.message, '\n')
  process.exit(1)
} finally {
  // Por si algo cortó la limpieza a la mitad: los triggers de retención
  // SIEMPRE tienen que quedar prendidos.
  try { await triggersRetencion('enable') } catch { /* ya reportado arriba */ }
}
