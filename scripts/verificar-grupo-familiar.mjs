#!/usr/bin/env node
/**
 * "Lo arreglado no vuelve" — grupo familiar con perfiles propios (migración 181).
 *
 *   node scripts/verificar-grupo-familiar.mjs                        # staging
 *   node scripts/verificar-grupo-familiar.mjs --entorno produccion   # sin consulta
 *
 * Arma un titular y un tercero de prueba (casilla sumidero de Resend), y prueba:
 *   1. Dar de alta un familiar crea su perfil y su usuario sin contraseña.
 *   2. Nadie puede vincularse a un perfil ajeno pasando `familiar_id`.
 *   3. El titular reserva PARA el familiar: la consulta es del familiar y
 *      `solicitado_por` es el titular. (Sólo staging: en producción el aviso
 *      le llegaría a un profesional real.)
 *   4. El profesional de esa consulta ve al familiar y NO al titular.
 *   5. El titular lee la historia clínica del familiar y sube un estudio a su
 *      carpeta; un tercero no ve ni sube nada.
 *   6. PIN: sólo el titular lo genera; canjearlo abre la sesión del familiar;
 *      no se puede usar dos veces; uno vencido no sirve.
 * Al final borra todo lo que creó, aunque algo falle.
 *
 * No cobra nada: la consulta queda en `pending_payment` y nunca pasa por
 * Mercado Pago.
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const leerEnv = (ruta) => {
  try {
    return Object.fromEntries(readFileSync(ruta, 'utf8').split('\n')
      .map(l => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2].replace(/^["']|["']$/g, '')]))
  } catch { return {} }
}
const aqui = dirname(fileURLToPath(import.meta.url))
const env = { ...leerEnv(join(aqui, '..', '.env')), ...leerEnv(join(homedir(), 'Local', 'Healthier', 'website', '.env')), ...leerEnv(join(homedir(), 'Local', '.env')) }

const entorno = process.argv.includes('--entorno') ? process.argv[process.argv.indexOf('--entorno') + 1] : 'staging'
const PROD = entorno === 'produccion'
const URL = PROD ? 'https://aixjejdoofervrkggbkd.supabase.co' : env.HEALTHIER_STAGING_SUPABASE_URL
const SERVICE = PROD ? env.SUPABASE_SERVICE_ROLE_KEY : env.HEALTHIER_STAGING_SUPABASE_SERVICE_ROLE_KEY
const ANON = PROD ? env.VITE_SUPABASE_ANON_KEY : env.HEALTHIER_STAGING_SUPABASE_ANON_KEY
const PROFESIONAL = PROD ? 'profesional@healthier.app' : 'clinica@staging.healthier.app'
if (!URL || !SERVICE || !ANON) { console.error('Faltan credenciales para', entorno); process.exit(2) }

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } })
const nuevo = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })

let fallas = 0
const ok = (m) => console.log(`   ✅ ${m}`)
const mal = (m) => { fallas++; console.log(`   ❌ ${m}`) }
const check = (cond, m, detalle = '') => (cond ? ok(m) : mal(m + (detalle ? ` — ${detalle}` : '')))

// Sesión sin contraseña: magic link generado por el Admin API, canjeado acá.
async function sesionDe(email) {
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (error) throw error
  const c = nuevo()
  const { error: e2 } = await c.auth.verifyOtp({ token_hash: data.properties.hashed_token, type: 'magiclink' })
  if (e2) throw e2
  return c
}

const creados = { usuarios: [], consultas: [], archivos: [] }
const sello = Date.now()

async function crearPaciente(nombre) {
  const email = `delivered+familia-${nombre}-${sello}@resend.dev`
  const { data, error } = await admin.auth.admin.createUser({
    email, email_confirm: true, password: crypto.randomUUID(),
    user_metadata: { role: 'patient', full_name: `Verificación ${nombre}` },
  })
  if (error) throw error
  creados.usuarios.push(data.user.id)
  return { id: data.user.id, email, cliente: await sesionDe(email) }
}

async function main() {
  console.log(`\n═══ GRUPO FAMILIAR — ${entorno.toUpperCase()} ═══`)
  const titular = await crearPaciente('titular')
  const tercero = await crearPaciente('tercero')

  // 1 ─ alta del familiar
  console.log('\n1. Alta del familiar')
  const { data: vinculo, error: eAlta } = await titular.cliente.from('family_members')
    .insert({ patient_id: titular.id, full_name: 'Nieto Verificación', relationship: 'Hijo/a', dni: '99888777' })
    .select().single()
  if (eAlta) throw eAlta
  const familiarId = vinculo.familiar_id
  if (familiarId) creados.usuarios.push(familiarId)
  check(Boolean(familiarId), 'el vínculo trae familiar_id')
  const { data: perfilFam } = await admin.from('profiles').select('role, titular_id, full_name, dni, email').eq('id', familiarId).single()
  check(perfilFam?.role === 'patient' && perfilFam?.titular_id === titular.id, 'el familiar es un paciente con titular_id')
  check(perfilFam?.dni === '99888777', 'el DNI del formulario quedó en su perfil')
  check(perfilFam?.email === titular.email, 'los mails del familiar van al titular')
  const { data: usuarioFam } = await admin.auth.admin.getUserById(familiarId)
  check(/@familia\.healthier\.app$/.test(usuarioFam?.user?.email ?? ''), 'su usuario de auth tiene mail interno', usuarioFam?.user?.email)

  // Editar el vínculo actualiza el perfil.
  await titular.cliente.from('family_members').update({ full_name: 'Nieto Verificado' }).eq('id', vinculo.id)
  const { data: perfilEditado } = await admin.from('profiles').select('full_name').eq('id', familiarId).single()
  check(perfilEditado?.full_name === 'Nieto Verificado', 'editar el familiar actualiza su perfil')

  // 2 ─ nadie se vincula a un perfil ajeno
  console.log('\n2. Vincularse a un perfil ajeno')
  const { data: intruso } = await titular.cliente.from('family_members')
    .insert({ patient_id: titular.id, full_name: 'Intento', familiar_id: tercero.id }).select().single()
  if (intruso?.familiar_id) creados.usuarios.push(intruso.familiar_id)
  check(intruso && intruso.familiar_id !== tercero.id, 'pasar familiar_id de otro no lo vincula (se crea un perfil nuevo)')
  if (intruso) await titular.cliente.from('family_members').delete().eq('id', intruso.id)
  const { data: robo } = await titular.cliente.from('profiles').select('id').eq('id', tercero.id)
  check((robo ?? []).length === 0, 'el titular no puede leer el perfil del tercero')

  // 3 ─ reservar para el familiar
  const { data: pro } = await admin.from('profiles').select('id').eq('email', PROFESIONAL).is('titular_id', null).single()
  let consultaId = null
  if (!PROD) {
    console.log('\n3. Reservar para el familiar')
    const { data: consulta, error: eCons } = await titular.cliente.from('consultations').insert({
      patient_id: familiarId, professional_id: pro.id, modality: 'video', vertical: 'clinica',
      status: 'pending', payment_status: 'pending_payment', price_at_booking: 15000,
      scheduled_at: new Date(Date.now() + 3 * 864e5).toISOString(),
    }).select().single()
    if (eCons) { mal(`el titular no pudo reservar para el familiar: ${eCons.message}`) } else {
      consultaId = consulta.id
      creados.consultas.push(consultaId)
      check(consulta.patient_id === familiarId, 'la consulta es del familiar')
      check(consulta.solicitado_por === titular.id, 'solicitado_por es el titular')
    }
    const { error: eAjena } = await tercero.cliente.from('consultations').insert({
      patient_id: familiarId, professional_id: pro.id, modality: 'video', status: 'pending',
      payment_status: 'pending_payment', scheduled_at: new Date(Date.now() + 864e5).toISOString(),
    })
    check(Boolean(eAjena), 'un tercero no puede reservar para ese familiar')

    // 4 ─ lo que ve el profesional
    console.log('\n4. El profesional')
    const cPro = await sesionDe(PROFESIONAL)
    const { data: vista } = await cPro.from('consultations')
      .select('patient_id, patient:profiles!patient_id(full_name, dni)').eq('id', consultaId).maybeSingle()
    check(vista?.patient_id === familiarId && vista?.patient?.full_name === 'Nieto Verificado', 've la consulta a nombre del familiar')
    const { data: titularVisto } = await cPro.from('profiles').select('id').eq('id', titular.id)
    check((titularVisto ?? []).length === 0, 'no ve el perfil del titular')

    // El titular puede cerrar su lado de la consulta.
    const { error: eFin } = await titular.cliente.rpc('finalize_consultation', { p_consultation_id: consultaId, p_role: 'patient' })
    check(!eFin, 'el titular puede terminar la consulta del familiar (finalize_consultation)', eFin?.message)
  } else {
    console.log('\n3–4. Consulta: se saltea en producción (avisaría a un profesional real)')
  }

  // 5 ─ historia clínica y estudios
  console.log('\n5. Historia clínica y estudios')
  // Una nota "external" de la HC: las tablas clínicas no se pueden borrar
  // (block_clinical_delete) y esta prueba tiene que limpiar lo que crea.
  const { data: pro2 } = await admin.from('profiles').select('id').eq('email', PROFESIONAL).is('titular_id', null).single()
  const { error: eCond } = await admin.from('clinical_notes').insert({
    patient_id: familiarId, professional_id: pro2.id, specialty: 'clinica', note_type: 'external',
    title: 'Verificación', content: 'Bronquiolitis resuelta (verificación)',
  })
  if (eCond) mal(`no se pudo sembrar la HC: ${eCond.message}`)
  const { data: hcTitular } = await titular.cliente.from('clinical_notes').select('id').eq('patient_id', familiarId)
  check((hcTitular ?? []).length === 1, 'el titular lee la HC del familiar')
  const { data: hcTercero } = await tercero.cliente.from('clinical_notes').select('id').eq('patient_id', familiarId)
  check((hcTercero ?? []).length === 0, 'un tercero no la lee')
  const { data: hcPropia } = await titular.cliente.from('clinical_notes').select('id').eq('patient_id', titular.id)
  check((hcPropia ?? []).length === 0, 'la HC del familiar no aparece en la del titular')

  const ruta = `${familiarId}/biovisor/${sello}_verificacion.pdf`
  const { error: eSube } = await titular.cliente.storage.from('patient-docs').upload(ruta, new Blob(['%PDF-1.4 verificación'], { type: 'application/pdf' }), { contentType: 'application/pdf' })
  if (!eSube) creados.archivos.push(ruta)
  check(!eSube, 'el titular sube un estudio a la carpeta del familiar', eSube?.message)
  const { error: eEstudio } = await titular.cliente.from('diagnostic_reports')
    .insert({ patient_id: familiarId, report_date: new Date().toISOString().slice(0, 10), parameters: [], study_type: 'Laboratorio' })
  check(!eEstudio, 'y lo registra a nombre del familiar', eEstudio?.message)
  const rutaAjena = `${familiarId}/biovisor/${sello}_intruso.pdf`
  const { error: eIntruso } = await tercero.cliente.storage.from('patient-docs').upload(rutaAjena, new Blob(['%PDF-1.4 intruso'], { type: 'application/pdf' }), { contentType: 'application/pdf' })
  if (!eIntruso) creados.archivos.push(rutaAjena)
  check(Boolean(eIntruso), 'un tercero no puede subir a esa carpeta')

  // 6 ─ PIN
  console.log('\n6. PIN de acceso')
  const { error: ePinAjeno } = await tercero.cliente.rpc('generar_pin_familiar', { p_familiar: familiarId })
  check(Boolean(ePinAjeno), 'un tercero no puede generar un PIN para el familiar')
  const { data: pin, error: ePin } = await titular.cliente.rpc('generar_pin_familiar', { p_familiar: familiarId })
  check(!ePin && /^\d{6}$/.test(pin?.pin ?? ''), 'el titular genera un PIN de 6 dígitos', ePin?.message)
  const vence = (new Date(pin?.expiraAt) - Date.now()) / 60000
  check(vence > 14 && vence <= 15.1, 'vence en 15 minutos', `${vence.toFixed(1)} min`)

  const canjear = async (p) => {
    const r = await fetch(`${URL}/functions/v1/acceso-familiar`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ANON}`, apikey: ANON },
      body: JSON.stringify({ pin: p }),
    })
    return { status: r.status, cuerpo: await r.json().catch(() => ({})) }
  }
  const canje = await canjear(pin?.pin)
  check(canje.status === 200 && canje.cuerpo.tokenHash, 'el PIN se canjea', JSON.stringify(canje.cuerpo))
  if (canje.cuerpo.tokenHash) {
    const cFam = nuevo()
    const { data: ses, error: eSes } = await cFam.auth.verifyOtp({ token_hash: canje.cuerpo.tokenHash, type: 'magiclink' })
    check(!eSes && ses?.user?.id === familiarId, 'y abre la sesión DEL FAMILIAR', eSes?.message)
    const { data: hcFam } = await cFam.from('clinical_notes').select('id').eq('patient_id', familiarId)
    check((hcFam ?? []).length === 1, 'el familiar logueado ve su propia HC')
    const { data: titularDesdeFam } = await cFam.from('profiles').select('full_name').eq('id', titular.id)
    check((titularDesdeFam ?? []).length === 1, 'y ve el nombre de quien lo agregó')
  }
  const reuso = await canjear(pin?.pin)
  check(reuso.status === 401, 'el mismo PIN no sirve dos veces', String(reuso.status))

  const { data: pin2 } = await titular.cliente.rpc('generar_pin_familiar', { p_familiar: familiarId })
  await admin.from('familiar_pins').update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq('familiar_id', familiarId).is('used_at', null)
  const vencido = await canjear(pin2?.pin)
  check(vencido.status === 401, 'un PIN vencido no sirve', String(vencido.status))
}

async function limpiar() {
  console.log('\nLimpieza')
  if (creados.archivos.length) await admin.storage.from('patient-docs').remove(creados.archivos)
  for (const id of creados.consultas) await admin.from('consultations').delete().eq('id', id)
  for (const id of creados.usuarios) {
    await admin.from('clinical_notes').delete().eq('patient_id', id)
    await admin.from('diagnostic_reports').delete().eq('patient_id', id)
    await admin.from('family_members').delete().eq('patient_id', id)
  }
  // Primero los familiares (su profiles.titular_id apunta al titular).
  for (const id of [...creados.usuarios].reverse()) {
    const { error } = await admin.auth.admin.deleteUser(id)
    if (error) console.log(`   ⚠️ no se pudo borrar el usuario ${id}: ${error.message}`)
  }
  console.log(`   ${creados.usuarios.length} usuarios, ${creados.consultas.length} consultas y ${creados.archivos.length} archivos borrados`)
}

try {
  await main()
} catch (e) {
  mal(`se cortó: ${e.message ?? e}`)
} finally {
  await limpiar()
}
console.log(fallas ? `\n❌ ${fallas} falla(s)` : '\n✅ Todo en orden')
process.exit(fallas ? 1 : 0)
