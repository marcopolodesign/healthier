#!/usr/bin/env node
/**
 * Cuentas propias para probar el llamado del profesional desde el front
 * (hoja "tipo Uber", solicitud completa y cierre) — SÓLO staging.
 *
 *   node scripts/seed-llamado-profesional.mjs            deja las dos cuentas listas
 *   node scripts/seed-llamado-profesional.mjs --pedido   además el paciente pide una
 *                                                         consulta inmediata (como desde la web)
 *   node scripts/seed-llamado-profesional.mjs --apagar   saca al profesional del on-demand
 *                                                         y borra su vendedor simulado
 *
 * Cuentas (password `staging`):
 *   pro.llamado@staging.healthier.app       Clínica, verificado, on-demand prendido
 *   paciente.llamado@staging.healthier.app  paciente exento de pago, onboarding hecho,
 *                                           con edad, sexo y cobertura (la ficha del pedido)
 *
 * El profesional necesita una fila en `mp_accounts` para ser elegible (migración
 * 193); como staging no tiene vendedores por OAuth, se siembra una con el token
 * TEST de la plataforma, igual que `verificar-despacho-ondemand.mjs`.
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
if (!URL || !SERVICE) { console.error('Faltan HEALTHIER_STAGING_* en ~/Local/.env'); process.exit(1) }
if (URL.includes('aixjejdoofervrkggbkd')) { console.error('Esto es producción. Sólo staging.'); process.exit(1) }

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } })
const PASSWORD = 'staging'
const PRO = { email: 'pro.llamado@staging.healthier.app', first: 'Julián', last: 'Ferreyra', role: 'professional' }
const PAC = { email: 'paciente.llamado@staging.healthier.app', first: 'Sofía', last: 'Méndez', role: 'patient' }
const args = new Set(process.argv.slice(2))

async function usuario({ email, first, last, role }) {
  const { data: perfil } = await admin.from('profiles').select('id').eq('email', email).maybeSingle()
  if (perfil) return perfil.id
  const { data, error } = await admin.auth.admin.createUser({
    email, password: PASSWORD, email_confirm: true,
    user_metadata: { role, first_name: first, last_name: last, full_name: `${first} ${last}` },
  })
  if (error) throw new Error(`crear ${email}: ${error.message}`)
  return data.user.id
}

const proId = await usuario(PRO)
const pacId = await usuario(PAC)
const ahora = new Date().toISOString()

if (args.has('--apagar')) {
  await admin.from('professional_profiles').update({ is_on_demand: false }).eq('user_id', proId)
  await admin.from('mp_accounts').delete().eq('professional_id', proId).eq('mp_nickname', 'vendedor-simulado-llamado')
  console.log('Profesional fuera del on-demand y sin vendedor simulado.')
  process.exit(0)
}

// ── Profesional ─────────────────────────────────────────────────────────────
await admin.from('profiles').update({
  role: 'professional', first_name: PRO.first, last_name: PRO.last, full_name: `${PRO.first} ${PRO.last}`,
  phone: '+5491155550101', es_prueba: true, requiere_onboarding: false,
}).eq('id', proId)
const pp = {
  user_id: proId, specialty: 'medicina_general', sub_specialty: '',
  bio: 'Clínica médica. Cuenta de prueba del llamado del profesional.',
  session_price: 18000, price_video: 18000, price_presencial: 22000,
  is_on_demand: true, on_demand_since: ahora, on_demand_last_seen_at: ahora,
  is_verified: true, is_active: true, verified_at: ahora,
  license_type: 'MN', license_number: '990101', modality_preference: 'virtual',
  mp_connected: true, mp_account_label: 'Cuenta de prueba (Mercado Pago)',
  solo_pruebas: true, refes_estado: 'aprobado_manual', dado_de_baja: false,
}
const { data: yaPP } = await admin.from('professional_profiles').select('id').eq('user_id', proId).maybeSingle()
const { error: ePP } = yaPP
  ? await admin.from('professional_profiles').update(pp).eq('user_id', proId)
  : await admin.from('professional_profiles').insert(pp)
if (ePP) throw new Error(`professional_profiles: ${ePP.message}`)

const { data: mp } = await admin.from('mp_accounts').select('id').eq('professional_id', proId).maybeSingle()
if (!mp) {
  const token = env.MP_ACCESS_TOKEN_SANDBOX
  if (!token) throw new Error('Falta MP_ACCESS_TOKEN_SANDBOX para el vendedor simulado')
  const yo = await fetch('https://api.mercadopago.com/users/me', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json())
  const { error } = await admin.from('mp_accounts').insert({
    professional_id: proId, mp_user_id: String(yo.id), access_token: token, active: true, live_mode: false,
    mp_nickname: 'vendedor-simulado-llamado', connected_at: ahora, expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
  })
  if (error) throw new Error(`mp_accounts: ${error.message}`)
}

// ── Paciente ────────────────────────────────────────────────────────────────
const { error: ePac } = await admin.from('profiles').update({
  role: 'patient', first_name: PAC.first, last_name: PAC.last, full_name: `${PAC.first} ${PAC.last}`,
  birth_date: '1990-05-12', gender: 'femenino', dni: '35111222', phone: '+5491155550102',
  coverage_type: 'financiador', insurance_name: 'OSDE', insurance_num: '6100 1234 5678',
  allergies: 'Penicilina', payment_exempt: true, es_prueba: true,
  requiere_onboarding: false, onboarding_completado_at: ahora, consentimiento_at: ahora,
}).eq('id', pacId)
if (ePac) throw new Error(`paciente: ${ePac.message}`)

const { data: elegible } = await admin.rpc('puede_tomar_ondemand', { p_user: proId, p_especialidades: ['medicina_general'] })
console.log(`Profesional ${PRO.email} (${proId}) · elegible: ${elegible}`)
console.log(`Paciente    ${PAC.email} (${pacId})`)

if (args.has('--pedido')) {
  const c = createClient(URL, ANON, { auth: { persistSession: false } })
  const { data: s, error } = await c.auth.signInWithPassword({ email: PAC.email, password: PASSWORD })
  if (error) throw new Error(`login paciente: ${error.message}`)
  await admin.from('ondemand_requests').update({ status: 'cancelled' }).eq('patient_id', pacId).eq('status', 'pending')
  const preconsulta = {
    version: 2,
    symptom: { id: 'fiebre', label: 'Fiebre', icd10_code: 'R50.9', icd10_display: 'Fiebre, no especificada', free_text: null },
    answers: [
      { question_id: 'duracion', question_label: '¿Desde cuándo?', values: ['2-3d'], labels: ['Hace 2 o 3 días'], red_flag: false },
      { question_id: 'temperatura', question_label: '¿Cuánta fiebre tuviste?', values: ['38-39'], labels: ['Entre 38 y 39 °C'], red_flag: false },
      { question_id: 'respirar', question_label: '¿Te cuesta respirar?', values: ['si'], labels: ['Sí'], red_flag: true },
    ],
    medication: { taking: true, detail: 'Ibuprofeno 400 mg cada 8 h' },
    has_red_flags: true,
    main_complaint: 'Fiebre (R50.9)',
    symptoms: '¿Desde cuándo? Hace 2 o 3 días · ¿Cuánta fiebre tuviste? Entre 38 y 39 °C · ¿Te cuesta respirar? Sí',
    current_medications: 'Ibuprofeno 400 mg cada 8 h',
  }
  const res = await fetch(`${URL}/functions/v1/ondemand-despacho`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${s.session.access_token}`, apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'pedir', vertical: 'clinica', preconsulta }),
  })
  const j = await res.json().catch(() => ({}))
  if (!j.data?.requestId) throw new Error(`pedir: ${res.status} ${JSON.stringify(j)}`)
  const { data: fila } = await admin.from('ondemand_requests').select('avisados, estado_pago, expires_at').eq('id', j.data.requestId).single()
  console.log(`Pedido ${j.data.requestId} · avisados=${fila.avisados} · pago=${fila.estado_pago} · vence ${fila.expires_at}`)
}
