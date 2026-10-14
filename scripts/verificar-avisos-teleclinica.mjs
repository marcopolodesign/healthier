#!/usr/bin/env node
/**
 * Control de los avisos al paciente de la Teleclínica (migración 198) — SÓLO STAGING.
 *
 *   node scripts/verificar-avisos-teleclinica.mjs
 *
 * Sale en rojo (exit 1) si vuelve cualquiera de estos problemas:
 *
 *   1. Un pedido inmediato aceptado NO genera "Te encontramos un profesional"
 *      en la campanita del paciente (o no lleva a la pantalla del pedido).
 *   2. Genera "Te agendaron un turno" o "Turno confirmado" (eran textos de
 *      turno agendado que salían al aceptar — Mateo, 2026-10-13).
 *   3. Un token de push que era de OTRA cuenta no se puede guardar a nombre de
 *      quien tiene la sesión (el 403 de RLS que dejó mudo el iPhone de Mateo).
 *   4. Receta + indicaciones cargadas juntas dan más de UN aviso, o el texto no
 *      dice las dos cosas.
 *   5. Mientras la consulta se está cerrando no se avisa aparte; al cerrar,
 *      lo pendiente se descarta (lo cuenta el aviso del cierre). Lo que llega
 *      después del cierre sí avisa, y lleva a "Gracias por tu consulta".
 *
 * Usa el camino real: el paciente pide por `ondemand-despacho` (bonificado
 * mientras corre) y el profesional acepta por la misma función.
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
const env = { ...leerEnv(join(homedir(), 'Local', 'Healthier', '.env')), ...leerEnv(join(homedir(), 'Local', '.env')) }
const URL = env.HEALTHIER_STAGING_SUPABASE_URL
const ANON = env.HEALTHIER_STAGING_SUPABASE_ANON_KEY
const SERVICE = env.HEALTHIER_STAGING_SUPABASE_SERVICE_ROLE_KEY
if (!URL || !SERVICE) { console.error('Faltan HEALTHIER_STAGING_* en ~/Local/.env'); process.exit(1) }
if (URL.includes('aixjejdoofervrkggbkd')) { console.error('Esto es producción. Sólo staging.'); process.exit(1) }

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } })
let fallos = 0
const ok = m => console.log(`  ✅ ${m}`)
const mal = m => { fallos++; console.log(`  ❌ ${m}`) }
const nota = m => console.log(`  ·  ${m}`)
const bloque = t => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 58 - t.length))}`)
const esperar = ms => new Promise(r => setTimeout(r, ms))

async function sesion(email) {
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (error) throw new Error(`magic link ${email}: ${error.message}`)
  const c = createClient(URL, ANON, { auth: { persistSession: false } })
  const { data: s, error: e2 } = await c.auth.verifyOtp({ token_hash: data.properties.hashed_token, type: 'magiclink' })
  if (e2) throw new Error(`sesión ${email}: ${e2.message}`)
  return { c, id: s.user.id, email, token: s.session.access_token }
}
async function despacho(quien, body) {
  const res = await fetch(`${URL}/functions/v1/ondemand-despacho`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${quien.token}`, apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const j = await res.json().catch(() => ({}))
  return { data: j.data ?? null, error: j.error ?? (res.ok ? null : `http ${res.status}`) }
}
/** Las notificaciones (campanita) de una consulta, esperando a que lleguen por pg_net. */
async function campanita(userId, consultationId, { esperarTipo = null, ms = 20000 } = {}) {
  const hasta = Date.now() + ms
  for (;;) {
    const { data } = await admin.from('notificaciones').select('tipo, titulo, cuerpo, url, created_at')
      .eq('user_id', userId).eq('consultation_id', consultationId).order('created_at')
    if (!esperarTipo || data?.some(n => n.tipo === esperarTipo) || Date.now() > hasta) return data ?? []
    await esperar(1000)
  }
}
/** Corre el despacho de avisos agrupados sin esperar la calma de 90 s. */
async function soltarAgrupados(consultationId) {
  await admin.from('avisos_consulta_pendientes')
    .update({ ultimo_cambio_at: new Date(Date.now() - 120000).toISOString() }).eq('consultation_id', consultationId)
  await admin.rpc('enviar_avisos_de_consulta')
}

const VERTICAL = 'clinica'
const paciente = await sesion('paciente.completo@staging.healthier.app')
const pro = await sesion('clinica@staging.healthier.app')
const restaurar = []
let consultaId = null
let pedidoId = null

try {
  // ── Preparar ─────────────────────────────────────────────────────────────
  bloque('Preparando')
  const { data: ppAntes } = await admin.from('professional_profiles')
    .select('is_on_demand, on_demand_last_seen_at, mp_connected, is_verified, is_active, license_type, license_number, specialty')
    .eq('user_id', pro.id).single()
  restaurar.push(() => admin.from('professional_profiles').update({
    is_on_demand: ppAntes.is_on_demand, on_demand_last_seen_at: ppAntes.on_demand_last_seen_at,
    mp_connected: ppAntes.mp_connected, is_verified: ppAntes.is_verified, is_active: ppAntes.is_active,
  }).eq('user_id', pro.id))
  await admin.from('professional_profiles').update({
    is_on_demand: true, on_demand_last_seen_at: new Date().toISOString(), mp_connected: true, is_verified: true, is_active: true,
  }).eq('user_id', pro.id)
  const { data: yaTenia } = await admin.from('mp_accounts').select('id').eq('professional_id', pro.id).maybeSingle()
  if (!yaTenia) {
    await admin.from('mp_accounts').insert({
      professional_id: pro.id, mp_user_id: '0', access_token: 'TEST-control-avisos', active: true, live_mode: false,
      mp_nickname: 'vendedor-simulado-avisos', connected_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    })
    restaurar.push(() => admin.from('mp_accounts').delete().eq('professional_id', pro.id).eq('mp_nickname', 'vendedor-simulado-avisos'))
  }
  const { data: exAntes } = await admin.from('profiles').select('payment_exempt').eq('id', paciente.id).single()
  restaurar.push(() => admin.from('profiles').update({ payment_exempt: exAntes.payment_exempt }).eq('id', paciente.id))
  await admin.from('profiles').update({ payment_exempt: true }).eq('id', paciente.id)
  await admin.from('ondemand_requests').update({ status: 'cancelled' }).eq('patient_id', paciente.id).eq('status', 'pending')
  nota(`paciente ${paciente.email} · profesional ${pro.email}`)

  // ── 1 y 2. Aceptar → "Te encontramos un profesional", sin textos de turno ──
  bloque('1-2. Pedido aceptado')
  const { data: pedido, error: ePedir } = await despacho(paciente, {
    action: 'pedir', vertical: VERTICAL,
    preconsulta: { version: 2, main_complaint: 'Tos (R05)', symptom: { id: 'tos', label: 'Tos' }, answers: [], has_red_flags: false },
  })
  if (!pedido?.requestId) throw new Error(`no se pudo pedir: ${ePedir ?? JSON.stringify(pedido)}`)
  pedidoId = pedido.requestId
  const { data: acept, error: eAcept } = await despacho(pro, { action: 'aceptar', requestId: pedidoId })
  if (!acept?.tomada) throw new Error(`no se pudo aceptar: ${eAcept ?? JSON.stringify(acept)}`)
  const { data: req } = await admin.from('ondemand_requests').select('consultation_id').eq('id', pedidoId).single()
  consultaId = req.consultation_id
  nota(`pedido ${pedidoId.slice(0, 8)} → consulta ${consultaId.slice(0, 8)}`)

  const avisos = await campanita(paciente.id, consultaId, { esperarTipo: 'ondemand-aceptado' })
  await esperar(4000) // margen para que lleguen los de turno, si volvieran
  const todos = await campanita(paciente.id, consultaId)
  const aceptado = todos.find(n => n.tipo === 'ondemand-aceptado')
  aceptado?.titulo === 'Te encontramos un profesional'
    ? ok(`"${aceptado.titulo}" — ${aceptado.cuerpo}`) : mal(`no llegó "Te encontramos un profesional" (llegó: ${JSON.stringify(avisos.map(n => n.titulo))})`)
  aceptado && /aceptó tu consulta\. Entrá cuando estés listo\./.test(aceptado.cuerpo) && !aceptado.cuerpo.startsWith('Un profesional')
    ? ok('el cuerpo trae el nombre del profesional') : mal(`cuerpo inesperado: ${aceptado?.cuerpo}`)
  aceptado?.url === `/paciente/ondemand/${VERTICAL}` ? ok(`lleva a ${aceptado.url}`) : mal(`url inesperada: ${aceptado?.url}`)
  const deTurno = todos.filter(n => ['turno-agendado', 'turno-confirmado'].includes(n.tipo))
  !deTurno.length ? ok('no llegó "Te agendaron un turno" ni "Turno confirmado"') : mal(`llegaron textos de turno: ${deTurno.map(n => n.titulo).join(', ')}`)
  todos.filter(n => n.tipo === 'ondemand-aceptado').length === 1 ? ok('un solo aviso de aceptado') : mal('más de un aviso de aceptado')

  // ── 3. Token de otra cuenta ────────────────────────────────────────────────
  bloque('3. Token de push que era de otra cuenta')
  {
    const tok = `ExponentPushToken[control-avisos-${Date.now()}]`
    await admin.from('expo_push_tokens').insert({ user_id: pro.id, token: tok, platform: 'ios', device_name: 'control' })
    const { error: eUpsert } = await paciente.c.from('expo_push_tokens')
      .upsert({ user_id: paciente.id, token: tok, platform: 'ios' }, { onConflict: 'token' })
    nota(eUpsert ? `el upsert directo rebota, como antes: ${eUpsert.message}` : 'el upsert directo pasó')
    const { error: eRpc } = await paciente.c.rpc('registrar_push_token', { p_token: tok, p_platform: 'ios', p_device_name: 'control' })
    const { data: fila } = await admin.from('expo_push_tokens').select('user_id').eq('token', tok).single()
    !eRpc && fila?.user_id === paciente.id
      ? ok('registrar_push_token se lo pasa a quien tiene la sesión') : mal(`el token sigue de otra cuenta (${eRpc?.message ?? fila?.user_id})`)
    const { error: eBasura } = await paciente.c.rpc('registrar_push_token', { p_token: 'cualquier-cosa' })
    eBasura ? ok('rechaza algo que no es un token de Expo') : mal('aceptó un token inválido')
    await admin.from('expo_push_tokens').delete().eq('token', tok)
  }

  // ── 4. Receta + indicaciones → UN aviso ────────────────────────────────────
  bloque('4. Receta e indicaciones juntas')
  const { data: enc, error: eEnc } = await admin.from('clinical_encounters').insert({
    consultation_id: consultaId, patient_id: paciente.id, professional_id: pro.id,
    professional_license_type: ppAntes.license_type ?? 'MN', professional_license_number: ppAntes.license_number ?? '0000',
    modality: 'telemedicina', specialty: ppAntes.specialty ?? 'medicina_general', encounter_type: 'consultation', status: 'in_progress',
  }).select('id').single()
  if (eEnc) throw new Error(`encuentro: ${eEnc.message}`)
  const base = {
    encounter_id: enc.id, patient_id: paciente.id, professional_id: pro.id,
    professional_license_type: ppAntes.license_type ?? 'MN', professional_license_number: ppAntes.license_number ?? '0000',
  }
  for (const texto of ['Tomar mucho líquido', 'Reposo 48 h']) {
    const { error } = await admin.from('clinical_entries').insert({ ...base, entry_type: 'indication', content: texto })
    if (error) throw new Error(`indicación: ${error.message}`)
  }
  await admin.from('clinical_entries').insert({ ...base, entry_type: 'note', content: 'Nota privada: no avisa' })
  const { data: med, error: eMed } = await admin.from('clinical_medications').insert({
    ...base, medication_name: 'Ibuprofeno 400 mg', dosage_text: '1 comprimido cada 8 h', status: 'active',
  }).select('id').single()
  if (eMed) throw new Error(`medicamento: ${eMed.message}`)
  await admin.from('clinical_medications').update({
    rcta_status: 'issued', rcta_prescription_id: `control-${Date.now()}`, rcta_issued_at: new Date().toISOString(),
  }).eq('id', med.id)

  const { data: pend } = await admin.from('avisos_consulta_pendientes').select('*').eq('consultation_id', consultaId).maybeSingle()
  pend?.receta && pend?.indicaciones ? ok('quedó UNA marca pendiente con receta e indicaciones') : mal(`marca pendiente: ${JSON.stringify(pend)}`)
  const antesDeSoltar = (await campanita(paciente.id, consultaId)).filter(n => ['consulta-novedades', 'receta-emitida'].includes(n.tipo))
  !antesDeSoltar.length ? ok('no salió nada todavía (espera la calma)') : mal(`salió antes de tiempo: ${antesDeSoltar.map(n => n.titulo)}`)
  await soltarAgrupados(consultaId)
  await campanita(paciente.id, consultaId, { esperarTipo: 'consulta-novedades' })
  await esperar(3000)
  const nov = (await campanita(paciente.id, consultaId)).filter(n => ['consulta-novedades', 'receta-emitida'].includes(n.tipo))
  nov.length === 1 ? ok('llegó UN solo aviso') : mal(`llegaron ${nov.length}: ${nov.map(n => n.titulo).join(' | ')}`)
  nov[0]?.titulo === 'Tu profesional ya cargó tu receta y tus indicaciones'
    ? ok(`"${nov[0].titulo}" — ${nov[0].cuerpo}`) : mal(`título inesperado: ${nov[0]?.titulo}`)
  nov[0]?.url === `/paciente/consulta/resumen/${consultaId}` ? ok('en plena consulta lleva al resumen') : mal(`url: ${nov[0]?.url}`)

  // ── 5. Cerrando → espera; al cerrar se descarta; después vuelve a avisar ───
  bloque('5. Cierre')
  await admin.from('consultations').update({ status: 'closing', closing_started_at: new Date().toISOString() }).eq('id', consultaId)
  await admin.from('consultations').update({ closing_notes: 'Volvé si sigue la fiebre' }).eq('id', consultaId)
  await soltarAgrupados(consultaId)
  const { data: sigue } = await admin.from('avisos_consulta_pendientes').select('consultation_id').eq('consultation_id', consultaId).maybeSingle()
  sigue ? ok('mientras cierra, las notas de cierre esperan al cierre') : mal('avisó aparte mientras se cerraba')
  await admin.from('consultations').update({ status: 'completed' }).eq('id', consultaId)
  await campanita(paciente.id, consultaId, { esperarTipo: 'post-consulta' })
  const { data: borrada } = await admin.from('avisos_consulta_pendientes').select('consultation_id').eq('consultation_id', consultaId).maybeSingle()
  !borrada ? ok('al cerrar se descartó lo pendiente (lo cuenta "Tu resumen ya está listo")') : mal('quedó pendiente después del cierre')
  await esperar(3000)
  const tras = (await campanita(paciente.id, consultaId)).filter(n => n.tipo === 'consulta-novedades')
  tras.length === 1 ? ok('no hubo aviso doble al cerrar') : mal(`avisos de novedades: ${tras.length}`)

  await admin.from('clinical_entries').insert({ ...base, entry_type: 'indication', content: 'Control en 7 días' })
  await soltarAgrupados(consultaId)
  await esperar(1500)
  const despues = await campanita(paciente.id, consultaId, { esperarTipo: null })
  const ultima = despues.filter(n => n.tipo === 'consulta-novedades')
  const nuevo = ultima[ultima.length - 1]
  ultima.length === 2 && nuevo?.titulo === 'Tu profesional ya cargó tus indicaciones'
    ? ok(`después del cierre: "${nuevo.titulo}"`) : mal(`después del cierre: ${JSON.stringify(ultima.map(n => n.titulo))}`)
  nuevo?.url === `/paciente/consulta/review/${consultaId}` ? ok('y lleva a "Gracias por tu consulta"') : mal(`url: ${nuevo?.url}`)

  // ── 6. El cierre real del profesional: notas + completed en UNA escritura ──
  // `completar_cierre_de_consulta` guarda el resumen y pasa a `completed` en el
  // mismo UPDATE. El bloque 5 escribe las dos cosas por separado y no lo veía:
  // el release del 2026-10-14 mandaba "Tu resumen ya está listo" y, 90 s
  // después, "Tu profesional ya cargó tus indicaciones" con el mismo resumen.
  bloque('6. Cierre del profesional con resumen')
  const { data: orig } = await admin.from('consultations')
    .select('patient_id, professional_id, modality, is_on_demand').eq('id', consultaId).single()
  const { data: otra, error: eOtra } = await admin.from('consultations').insert({
    ...orig, scheduled_at: new Date().toISOString(), status: 'confirmed',
  }).select('id').single()
  if (eOtra) throw new Error(`consulta para el bloque 6: ${eOtra.message}`)
  await admin.from('consultations').update({ status: 'in_progress' }).eq('id', otra.id)
  await admin.from('consultations').update({ status: 'closing', closing_started_at: new Date().toISOString() }).eq('id', otra.id)
  const { error: eCierre } = await pro.c.rpc('completar_cierre_de_consulta', {
    p_consultation_id: otra.id, p_closing_notes: 'Reposo y control en 48 h', p_motivo_sin_codigo: 'control automático',
  })
  if (eCierre) throw new Error(`completar_cierre_de_consulta: ${eCierre.message}`)
  await campanita(paciente.id, otra.id, { esperarTipo: 'post-consulta' })
  const { data: quedo } = await admin.from('avisos_consulta_pendientes').select('consultation_id').eq('consultation_id', otra.id).maybeSingle()
  !quedo ? ok('el resumen del cierre no queda pendiente (lo cuenta "Tu resumen ya está listo")') : mal('el resumen del cierre quedó pendiente: va a llegar un segundo aviso')
  await soltarAgrupados(otra.id)
  await esperar(3000)
  const dobles = (await campanita(paciente.id, otra.id)).filter(n => n.tipo === 'consulta-novedades')
  dobles.length === 0 ? ok('un solo aviso al cerrar') : mal(`además del resumen llegó: ${dobles.map(n => n.titulo).join(' | ')}`)
} catch (err) {
  mal(String(err?.message ?? err))
} finally {
  bloque('Limpieza')
  if (consultaId) await admin.from('consultations').update({ status: 'completed' }).eq('id', consultaId).neq('status', 'completed')
  for (const r of restaurar.reverse()) await r()
  nota('perfil del profesional y del paciente como estaban')
}

console.log(fallos ? `\n🔴 ${fallos} problema(s)` : '\n🟢 Todo en orden')
process.exit(fallos ? 1 : 0)
