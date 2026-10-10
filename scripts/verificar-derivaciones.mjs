#!/usr/bin/env node
/**
 * "Lo arreglado no vuelve" — derivaciones (migración 195).
 *
 *   node scripts/verificar-derivaciones.mjs          # staging (único entorno: crea consultas)
 *
 * Arma dos pacientes y un tercero de prueba (casilla sumidero de Resend) y usa
 * profesionales de prueba de staging:
 *   A = clinica@staging      — el que deriva (atendió a los pacientes)
 *   B = nutricion@staging    — destino concreto
 *   C = pediatria@staging    — destino por especialidad / el que no tiene nada que ver
 *
 * Prueba:
 *   1. Quién puede derivar: un paciente no; un profesional sin consulta con el
 *      paciente no; sin motivo no; con los dos destinos no.
 *   2. Quién ve la derivación (RLS): paciente, A, B y super admin sí; C y el
 *      tercero no. B ve el nombre del paciente; C no.
 *   3. SIN consentimiento B no ve la HC — ni antes de reservar ni DESPUÉS,
 *      aunque ya tenga una consulta con el paciente. A la sigue viendo.
 *   4. El consentimiento queda registrado (cada respuesta) y sólo lo da el paciente.
 *   5. La reserva queda vinculada: con otro profesional no se puede colgar de la
 *      derivación; con B sí, y la derivación pasa a "reservada".
 *   6. CON consentimiento B ve la HC.
 *   7. Derivación a una especialidad: sólo un profesional de esa especialidad
 *      puede tomar el turno; el que lo toma ve la derivación pero no la HC sin
 *      consentimiento. Si el turno se cancela, la derivación vuelve a pendiente.
 *   8. Cancelar: B no puede; A sí, mientras está pendiente.
 *   9. Avisos: llega la notificación al paciente y queda el mail registrado.
 *  10. Rechazo: sólo el destino rechaza (con motivo); después el paciente
 *      reserva con OTRO de la misma especialidad (no con el que rechazó ni con
 *      uno de otra); el que rechazó no ve la HC; le llega el aviso al paciente.
 *  11. Vence a los 30 días.
 * Al final borra todo lo que creó, aunque algo falle. No cobra nada.
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

const URL = env.HEALTHIER_STAGING_SUPABASE_URL
const SERVICE = env.HEALTHIER_STAGING_SUPABASE_SERVICE_ROLE_KEY
const ANON = env.HEALTHIER_STAGING_SUPABASE_ANON_KEY
if (!URL || !SERVICE || !ANON) { console.error('Faltan credenciales de staging'); process.exit(2) }

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } })
const nuevo = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })

let fallas = 0
const ok = (m) => console.log(`   ✅ ${m}`)
const mal = (m) => { fallas++; console.log(`   ❌ ${m}`) }
const check = (cond, m, detalle = '') => (cond ? ok(m) : mal(m + (detalle ? ` — ${detalle}` : '')))
const esperar = (ms) => new Promise(r => setTimeout(r, ms))

async function sesionDe(email) {
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (error) throw error
  const c = nuevo()
  const { error: e2 } = await c.auth.verifyOtp({ token_hash: data.properties.hashed_token, type: 'magiclink' })
  if (e2) throw e2
  return c
}

const creados = { usuarios: [], consultas: [], derivaciones: [] }
const sello = Date.now()

async function crearPaciente(nombre) {
  const email = `delivered+deriv-${nombre}-${sello}@resend.dev`
  const { data, error } = await admin.auth.admin.createUser({
    email, email_confirm: true, password: crypto.randomUUID(),
    user_metadata: { role: 'patient', full_name: `Verificación ${nombre}` },
  })
  if (error) throw error
  creados.usuarios.push(data.user.id)
  // Los profesionales de staging son cuentas de prueba (migración 186): el
  // paciente también, o la base no deja cruzarlos.
  await admin.from('profiles').update({ es_prueba: true }).eq('id', data.user.id)
  return { id: data.user.id, email, cliente: await sesionDe(email) }
}

async function pro(email) {
  const { data } = await admin.from('profiles').select('id').eq('email', email).is('titular_id', null).single()
  return { id: data.id, email, cliente: await sesionDe(email) }
}

// Horarios bien separados para no chocar con el anti-doble-reserva.
let turno = 0
const horario = () => new Date(Date.now() + (20 + turno++) * 864e5 + (sello % 3600) * 1000).toISOString()

async function consulta(cliente, patientId, professionalId, extra = {}) {
  const { data, error } = await cliente.from('consultations').insert({
    patient_id: patientId, professional_id: professionalId, modality: 'video', vertical: 'clinica',
    status: 'pending', payment_status: 'pending_payment', price_at_booking: 15000,
    scheduled_at: horario(), ...extra,
  }).select().single()
  if (data) creados.consultas.push(data.id)
  return { data, error }
}

const leeHc = async (cliente, patientId) => {
  const { data } = await cliente.from('clinical_notes').select('id').eq('patient_id', patientId)
  return (data ?? []).length > 0
}

async function main() {
  console.log('\n═══ DERIVACIONES — STAGING ═══')
  const [A, B, C, D, superadmin] = await Promise.all([
    pro('clinica@staging.healthier.app'),
    pro('nutricion@staging.healthier.app'),
    pro('pediatria@staging.healthier.app'),
    pro('nutricionista2@staging.healthier.app'),   // otra de nutrición, para después de un rechazo
    sesionDe('superadmin@healthier.app'),
  ])
  const p1 = await crearPaciente('p1')
  const p2 = await crearPaciente('p2')
  const tercero = await crearPaciente('tercero')

  // A atendió a los dos pacientes; cada uno tiene una nota en su HC.
  for (const p of [p1, p2]) {
    const { error } = await consulta(admin, p.id, A.id)
    if (error) throw new Error(`no se pudo sembrar la consulta con A: ${error.message}`)
    const { error: eNota } = await admin.from('clinical_notes').insert({
      patient_id: p.id, professional_id: A.id, specialty: 'clinica', note_type: 'external',
      title: 'Verificación', content: 'Hipertensión en control (verificación)',
    })
    if (eNota) throw new Error(`no se pudo sembrar la HC: ${eNota.message}`)
  }
  const origen = creados.consultas[0]

  // 1 ─ quién puede derivar
  console.log('\n1. Quién puede derivar')
  const derivar = (cliente, args) => cliente.rpc('crear_derivacion', {
    p_patient_id: p1.id, p_motivo: 'Control nutricional por hipertensión', p_profesional_destino_id: null,
    p_vertical_destino: null, p_especialidad_destino: null, p_consulta_origen_id: null, ...args,
  })
  const r1 = await derivar(p1.cliente, { p_profesional_destino_id: B.id })
  check(Boolean(r1.error), 'un paciente no puede derivar', r1.error?.message)
  const r2 = await derivar(C.cliente, { p_profesional_destino_id: B.id })
  check(Boolean(r2.error), 'un profesional sin consulta con el paciente no puede', r2.error?.message)
  const r3 = await derivar(A.cliente, { p_profesional_destino_id: B.id, p_motivo: '  ' })
  check(Boolean(r3.error), 'sin motivo no se puede', r3.error?.message)
  const r4 = await derivar(A.cliente, { p_profesional_destino_id: B.id, p_vertical_destino: 'nutricion' })
  check(Boolean(r4.error), 'con los dos destinos a la vez no se puede', r4.error?.message)
  const r5 = await derivar(A.cliente, { p_vertical_destino: 'clinica', p_especialidad_destino: 'nutricion' })
  check(Boolean(r5.error), 'una especialidad de otra área no se acepta', r5.error?.message)

  const { data: d1, error: eD1 } = await derivar(A.cliente, { p_profesional_destino_id: B.id, p_consulta_origen_id: origen })
  if (eD1) throw new Error(`A no pudo derivar: ${eD1.message}`)
  creados.derivaciones.push(d1)
  ok('A deriva a P1 con B')

  // 2 ─ quién la ve
  console.log('\n2. Quién ve la derivación')
  const ve = async (cliente, id) => ((await cliente.from('derivaciones').select('id').eq('id', id)).data ?? []).length === 1
  check(await ve(p1.cliente, d1), 'el paciente la ve')
  check(await ve(A.cliente, d1), 'el que derivó la ve')
  check(await ve(B.cliente, d1), 'el destinatario la ve')
  check(await ve(superadmin, d1), 'el super admin la ve')
  check(!(await ve(C.cliente, d1)), 'otro profesional no la ve')
  check(!(await ve(tercero.cliente, d1)), 'otro paciente no la ve')
  const nombreDesde = async (cliente) => ((await cliente.from('profiles').select('full_name').eq('id', p1.id)).data ?? []).length === 1
  check(await nombreDesde(B.cliente), 'el destinatario ve el nombre del paciente')
  check(!(await nombreDesde(C.cliente)), 'otro profesional no ve el perfil del paciente')
  const escribe = await B.cliente.from('derivaciones').update({ motivo: 'cambiado' }).eq('id', d1).select()
  check((escribe.data ?? []).length === 0, 'nadie la edita por fuera de las RPC')

  // 3 ─ sin consentimiento, sin HC
  console.log('\n3. Sin consentimiento, el destinatario no ve la HC')
  check(!(await leeHc(B.cliente, p1.id)), 'antes de responder: B no ve la HC')
  check(await leeHc(A.cliente, p1.id), 'A (que lo atendió) sí la ve')

  // 4 ─ consentimiento
  console.log('\n4. Consentimiento')
  const eT = (await tercero.cliente.rpc('responder_consentimiento_derivacion', { p_derivacion_id: d1, p_acepta: true })).error
  check(Boolean(eT), 'un tercero no puede responder por el paciente')
  const eB = (await B.cliente.rpc('responder_consentimiento_derivacion', { p_derivacion_id: d1, p_acepta: true })).error
  check(Boolean(eB), 'el destinatario no puede darse el consentimiento')
  const eNo = (await p1.cliente.rpc('responder_consentimiento_derivacion', { p_derivacion_id: d1, p_acepta: false })).error
  check(!eNo, 'el paciente dice que no', eNo?.message)
  check(!(await leeHc(B.cliente, p1.id)), 'con "no": B no ve la HC')

  // 5 ─ reserva vinculada
  console.log('\n5. La reserva queda vinculada')
  const mal1 = await consulta(p1.cliente, p1.id, C.id, { derivacion_id: d1 })
  check(Boolean(mal1.error), 'con otro profesional no se puede colgar de la derivación', mal1.error?.message)
  const ajena = await consulta(tercero.cliente, tercero.id, B.id, { derivacion_id: d1 })
  check(Boolean(ajena.error), 'otro paciente no puede usar la derivación', ajena.error?.message)
  const buena = await consulta(p1.cliente, p1.id, B.id, { derivacion_id: d1, vertical: 'nutricion' })
  check(!buena.error && buena.data?.derivacion_id === d1, 'con B se reserva y la consulta queda vinculada', buena.error?.message)
  const { data: dTras } = await admin.from('derivaciones').select('estado, consulta_reservada_id').eq('id', d1).single()
  check(dTras?.estado === 'reservada' && dTras?.consulta_reservada_id === buena.data?.id, 'la derivación pasa a "reservada" con el turno', JSON.stringify(dTras))
  check(!(await leeHc(B.cliente, p1.id)), 'ya con turno y sin consentimiento: B sigue sin ver la HC')
  // El turno nace sin pagar (el cobro va después): un reintento no puede chocar.
  const reintento = await consulta(p1.cliente, p1.id, B.id, { derivacion_id: d1, vertical: 'nutricion' })
  const { data: dReintento } = await admin.from('derivaciones').select('consulta_reservada_id').eq('id', d1).single()
  check(!reintento.error && dReintento?.consulta_reservada_id === reintento.data?.id,
    'si el turno quedó sin pagar, se puede reservar de nuevo y la derivación apunta al nuevo', reintento.error?.message)
  if (reintento.data) await admin.from('consultations').update({ status: 'confirmed', payment_status: 'paid' }).eq('id', reintento.data.id)
  const otra = await consulta(p1.cliente, p1.id, B.id, { derivacion_id: d1, vertical: 'nutricion' })
  check(Boolean(otra.error), 'con el turno pagado, la derivación no se usa dos veces', otra.error?.message)

  // 6 ─ con consentimiento
  console.log('\n6. Con consentimiento')
  await p1.cliente.rpc('responder_consentimiento_derivacion', { p_derivacion_id: d1, p_acepta: true })
  check(await leeHc(B.cliente, p1.id), 'con "sí": B ve la HC')
  const { data: hist } = await admin.from('derivacion_consentimientos').select('acepta, respondido_por').eq('derivacion_id', d1).order('created_at')
  check(hist?.length === 2 && hist[0].acepta === false && hist[1].acepta === true && hist.every(h => h.respondido_por === p1.id),
    'quedan registradas las dos respuestas, con quién respondió', JSON.stringify(hist))
  check((await p1.cliente.from('derivacion_consentimientos').select('id').eq('derivacion_id', d1)).data?.length === 2, 'el paciente ve su historial de respuestas')
  await p1.cliente.rpc('responder_consentimiento_derivacion', { p_derivacion_id: d1, p_acepta: false })
  check(!(await leeHc(B.cliente, p1.id)), 'si lo retira, B deja de ver la HC')

  // 7 ─ a una especialidad
  console.log('\n7. Derivación a una especialidad')
  const { data: d2, error: eD2 } = await derivar(A.cliente, { p_patient_id: p2.id, p_vertical_destino: 'pediatria', p_motivo: 'Control de crecimiento' })
  if (eD2) throw new Error(`A no pudo derivar a pediatría: ${eD2.message}`)
  creados.derivaciones.push(d2)
  check(!(await ve(C.cliente, d2)), 'antes del turno, los pediatras no la ven')
  const malEsp = await consulta(p2.cliente, p2.id, B.id, { derivacion_id: d2, vertical: 'pediatria' })
  check(Boolean(malEsp.error), 'un profesional de otra especialidad no puede tomarla', malEsp.error?.message)
  const okEsp = await consulta(p2.cliente, p2.id, C.id, { derivacion_id: d2, vertical: 'pediatria' })
  check(!okEsp.error, 'un pediatra sí', okEsp.error?.message)
  check(await ve(C.cliente, d2), 'el pediatra que la tomó ve la derivación (la nota)')
  check(!(await leeHc(C.cliente, p2.id)), 'pero sin consentimiento no ve la HC')
  if (okEsp.data) {
    await p2.cliente.from('consultations').update({ status: 'cancelled' }).eq('id', okEsp.data.id)
    const { data: dCanc } = await admin.from('derivaciones').select('estado, consulta_reservada_id').eq('id', d2).single()
    check(dCanc?.estado === 'pendiente' && !dCanc?.consulta_reservada_id, 'si cancela el turno, la derivación vuelve a pendiente', JSON.stringify(dCanc))
  }

  // 8 ─ cancelar
  console.log('\n8. Cancelar la derivación')
  const eCB = (await B.cliente.rpc('cancelar_derivacion', { p_derivacion_id: d2 })).error
  check(Boolean(eCB), 'otro profesional no puede cancelarla')
  const eCA = (await A.cliente.rpc('cancelar_derivacion', { p_derivacion_id: d2 })).error
  check(!eCA, 'el que derivó la cancela', eCA?.message)
  const eCR = (await A.cliente.rpc('cancelar_derivacion', { p_derivacion_id: d1 })).error
  check(Boolean(eCR), 'una reservada no se cancela')
  const tarde = await consulta(p2.cliente, p2.id, C.id, { derivacion_id: d2, vertical: 'pediatria' })
  check(Boolean(tarde.error), 'una cancelada no se puede reservar', tarde.error?.message)

  // 9 ─ avisos
  console.log('\n9. Avisos')
  let notif = [], mails = []
  for (let i = 0; i < 10 && (!notif.length || !mails.length); i++) {
    await esperar(1500)
    notif = (await admin.from('notificaciones').select('tipo, url').eq('user_id', p1.id).eq('tipo', 'derivacion-nueva')).data ?? []
    mails = (await admin.from('email_log').select('tipo, destinatario, estado, error').eq('tipo', 'derivacion').in('destinatario', [p1.email])).data ?? []
  }
  check(notif.length === 1 && notif[0].url === `/paciente/derivaciones/${d1}`, 'al paciente le llega la notificación con el link a la derivación', JSON.stringify(notif))
  check(mails.length >= 1, 'el mail al paciente queda registrado', JSON.stringify(mails))

  // 10 ─ rechazo
  console.log('\n10. El destino rechaza')
  const { data: d3, error: eD3 } = await derivar(A.cliente, { p_patient_id: p2.id, p_profesional_destino_id: B.id, p_motivo: 'Plan alimentario' })
  if (eD3) throw new Error(`A no pudo derivar a B: ${eD3.message}`)
  creados.derivaciones.push(d3)
  const rechazar = (cliente) => cliente.rpc('rechazar_derivacion', { p_derivacion_id: d3, p_motivo: 'No tengo agenda este mes' })
  check(Boolean((await rechazar(A.cliente)).error), 'el que derivó no puede rechazarla')
  check(Boolean((await rechazar(C.cliente)).error), 'otro profesional no puede rechazarla')
  check(Boolean((await rechazar(p2.cliente)).error), 'el paciente no puede rechazarla')
  const eRech = (await rechazar(B.cliente)).error
  check(!eRech, 'el destino la rechaza', eRech?.message)
  const { data: dRech } = await admin.from('derivaciones').select('estado, motivo_rechazo, rechazada_at').eq('id', d3).single()
  check(dRech?.estado === 'rechazada' && dRech?.motivo_rechazo === 'No tengo agenda este mes' && dRech?.rechazada_at,
    'queda "rechazada" con el motivo', JSON.stringify(dRech))
  check(Boolean((await rechazar(B.cliente)).error), 'no se rechaza dos veces')
  check(await ve(superadmin, d3), 'el super admin la ve rechazada')
  await p2.cliente.rpc('responder_consentimiento_derivacion', { p_derivacion_id: d3, p_acepta: true })
  check(!(await leeHc(B.cliente, p2.id)), 'el que la rechazó no ve la HC aunque el paciente la haya compartido')
  const conB = await consulta(p2.cliente, p2.id, B.id, { derivacion_id: d3, vertical: 'nutricion' })
  check(Boolean(conB.error), 'no se reserva con el que la rechazó', conB.error?.message)
  const conC = await consulta(p2.cliente, p2.id, C.id, { derivacion_id: d3, vertical: 'pediatria' })
  check(Boolean(conC.error), 'ni con uno de otra especialidad', conC.error?.message)
  const conD = await consulta(p2.cliente, p2.id, D.id, { derivacion_id: d3, vertical: 'nutricion' })
  check(!conD.error, 'con otro de la misma especialidad sí', conD.error?.message)
  const { data: dTomada } = await admin.from('derivaciones').select('estado, consulta_reservada_id').eq('id', d3).single()
  check(dTomada?.estado === 'reservada' && dTomada?.consulta_reservada_id === conD.data?.id, 'y la derivación pasa a "reservada"', JSON.stringify(dTomada))
  check(await leeHc(D.cliente, p2.id), 'el que la tomó ve la HC (el paciente la compartió)')
  if (conD.data) {
    await p2.cliente.from('consultations').update({ status: 'cancelled' }).eq('id', conD.data.id)
    const { data: dVuelve } = await admin.from('derivaciones').select('estado').eq('id', d3).single()
    check(dVuelve?.estado === 'rechazada', 'si cancela ese turno, vuelve a "rechazada" (no a pendiente con el que la rechazó)', JSON.stringify(dVuelve))
  }
  let avisoRech = [], mailRech = []
  for (let i = 0; i < 10 && (!avisoRech.length || !mailRech.length); i++) {
    await esperar(1500)
    avisoRech = (await admin.from('notificaciones').select('url').eq('user_id', p2.id).eq('tipo', 'derivacion-rechazada')).data ?? []
    mailRech = (await admin.from('email_log').select('estado').eq('tipo', 'derivacion-rechazada').eq('destinatario', p2.email)).data ?? []
  }
  check(avisoRech.length === 1 && avisoRech[0].url === `/paciente/derivaciones/${d3}`, 'al paciente le llega el aviso del rechazo', JSON.stringify(avisoRech))
  check(mailRech.length >= 1, 'y el mail queda registrado', JSON.stringify(mailRech))

  // 11 ─ vencimiento
  console.log('\n11. Vencimiento')
  const { data: dv } = await admin.from('derivaciones').select('created_at, vence_at').eq('id', d1).single()
  const dias = (new Date(dv.vence_at) - new Date(dv.created_at)) / 864e5
  check(Math.round(dias) === 30, 'vence a los 30 días', `${dias.toFixed(1)} días`)
}

async function limpiar() {
  console.log('\nLimpieza')
  for (const id of creados.consultas) await admin.from('consultations').update({ derivacion_id: null }).eq('id', id)
  for (const id of creados.derivaciones) {
    await admin.from('derivacion_consentimientos').delete().eq('derivacion_id', id)
    await admin.from('derivaciones').delete().eq('id', id)
  }
  for (const id of creados.consultas) await admin.from('consultations').delete().eq('id', id)
  for (const id of creados.usuarios) {
    await admin.from('notificaciones').delete().eq('user_id', id)
    await admin.from('clinical_notes').delete().eq('patient_id', id)
  }
  for (const id of creados.usuarios) {
    const { error } = await admin.auth.admin.deleteUser(id)
    if (error) console.log(`   ⚠️ no se pudo borrar el usuario ${id}: ${error.message}`)
  }
  console.log(`   ${creados.usuarios.length} usuarios, ${creados.consultas.length} consultas y ${creados.derivaciones.length} derivaciones borradas`)
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
