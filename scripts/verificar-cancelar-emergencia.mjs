#!/usr/bin/env node
/**
 * Chequeo de la regla "con la ambulancia asignada, cancelar se cobra igual"
 * (Mateo, 2026-09-25) — `mp-capture` action=cancel-emergency + migración 175.
 *
 *   node scripts/verificar-cancelar-emergencia.mjs          # SÓLO staging
 *
 * 🔴 Sólo corre contra STAGING, a propósito: crea emergencias y reserva plata en
 * el sandbox de Mercado Pago (tarjeta de prueba APRO). En producción eso sería
 * una reserva real en una tarjeta real.
 *
 * Qué prueba, entrando como el paciente de prueba (sesión por magic link, sin
 * contraseñas):
 *   A. `pending` sin pago           → cancela, `cobrado:false`.
 *   B. `awaiting_dispatch` con reserva → cancela, `cobrado:false`, reserva liberada en MP.
 *   C. `dispatched` con reserva     → cancela, `cobrado:true`, reserva CAPTURADA en MP.
 *   D. `arrived`                    → 409, no se toca nada.
 *   E. RLS: el paciente NO puede poner `cancelled` por UPDATE directo sobre una
 *      despachada (así nadie se saltea el cobro).
 *   F. RLS: el paciente SÍ puede seguir haciendo el triage (pending → awaiting_dispatch).
 *   G. `cancelled` es final: el despacho no puede revivirla en `dispatched`.
 *
 * Al terminar borra lo que creó (emergencias y filas de `payments`).
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries(
  readFileSync(join(homedir(), 'Local/.env'), 'utf8').split('\n')
    .filter(l => /^[A-Z0-9_]+=/.test(l))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')] }),
)
// La public key de sandbox vive en el `.env` del website. En un worktree no hay
// `.env`, así que se cae al del checkout principal.
const leerWebEnv = () => {
  for (const ruta of [new URL('../.env', import.meta.url), join(homedir(), 'Local/Healthier/website/.env')]) {
    try {
      return Object.fromEntries(readFileSync(ruta, 'utf8').split('\n')
        .filter(l => /^[A-Z0-9_]+=/.test(l))
        .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')] }))
    } catch { /* siguiente */ }
  }
  return {}
}
const webEnv = leerWebEnv()

const URL_ = env.HEALTHIER_STAGING_SUPABASE_URL
const SERVICE = env.HEALTHIER_STAGING_SUPABASE_SERVICE_ROLE_KEY
const ANON = env.HEALTHIER_STAGING_SUPABASE_ANON_KEY
const MP_PUBLIC_KEY = webEnv.VITE_MP_PUBLIC_KEY_SANDBOX
if (!URL_?.includes('itjhrvlzuqvyhqtffumc')) { console.error('Esto corre sólo contra staging.'); process.exit(2) }

const EMAIL_PACIENTE = process.env.PACIENTE_EMAIL || 'paciente@healthier.app'

const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } })

let fallas = 0
const ok = (cond, msg, extra) => {
  console.log(`${cond ? '✅' : '❌'} ${msg}${extra ? ` — ${extra}` : ''}`)
  if (!cond) fallas++
}

async function sesionDelPaciente() {
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email: EMAIL_PACIENTE })
  if (error) throw error
  const cliente = createClient(URL_, ANON, { auth: { persistSession: false } })
  const { data: s, error: e2 } = await cliente.auth.verifyOtp({ type: 'magiclink', token_hash: data.properties.hashed_token })
  if (e2) throw e2
  return { cliente, token: s.session.access_token, userId: s.user.id }
}

async function llamar(path, body, token) {
  const res = await fetch(`${URL_}/functions/v1/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: ANON },
    body: JSON.stringify(body),
  })
  return { status: res.status, json: await res.json().catch(() => ({})) }
}

const creadas = []
async function crearEmergencia(patientId) {
  const { data, error } = await admin.from('emergencies').insert({
    patient_id: patientId, triage_code: 'VERDE', status: 'pending',
    notes: '["prueba verificar-cancelar-emergencia"]',
  }).select('id').single()
  if (error) throw error
  creadas.push(data.id)
  return data.id
}

async function tokenDeTarjeta() {
  const res = await fetch(`https://api.mercadopago.com/v1/card_tokens?public_key=${MP_PUBLIC_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      card_number: process.env.MP_CARD || '5031755734530604', security_code: '123',
      expiration_month: 11, expiration_year: 2030,
      cardholder: { name: 'APRO', identification: { type: 'DNI', number: '12345678' } },
    }),
  })
  const j = await res.json()
  if (!j.id) throw new Error(`card_token: ${JSON.stringify(j)}`)
  return j.id
}

async function reservar(emergencyId, token) {
  const cardToken = await tokenDeTarjeta()
  const r = await llamar('mp-payment', {
    emergencyId, cardToken, paymentMethodId: process.env.MP_METHOD || 'master',
    payerEmail: process.env.MP_PAYER_EMAIL || 'test_user_healthier@testuser.com',
    payerDocType: 'DNI', payerDocNumber: '12345678',
  }, token)
  return r
}

const pago = async id => (await admin.from('payments').select('status, mp_payment_id, charged_amount').eq('emergency_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle()).data
const fila = async id => (await admin.from('emergencies').select('status, cancellation_charged, cancelled_at').eq('id', id).single()).data

async function main() {
  const { cliente, token, userId } = await sesionDelPaciente()
  console.log(`Paciente de prueba: ${EMAIL_PACIENTE} (${userId})\n`)

  // A — pending sin pago
  {
    const id = await crearEmergencia(userId)
    const r = await llamar('mp-capture', { action: 'cancel-emergency', emergencyId: id }, token)
    const f = await fila(id)
    ok(r.status === 200 && r.json?.data?.cobrado === false, 'A. pending sin pago → cancela sin cobrar', JSON.stringify(r.json))
    ok(f.status === 'cancelled' && f.cancellation_charged === false && f.cancelled_at, 'A. fila: cancelled, sin cargo, con cancelled_at')
  }

  // B — awaiting_dispatch con reserva
  let reservaOk = true
  {
    const id = await crearEmergencia(userId)
    const res = await reservar(id, token)
    reservaOk = res.status === 200 && res.json?.data?.approved
    ok(reservaOk, 'B. reserva en el sandbox de MP', `${res.status} ${JSON.stringify(res.json)}`)
    if (reservaOk) {
      await admin.from('emergencies').update({ status: 'awaiting_dispatch' }).eq('id', id)
      const r = await llamar('mp-capture', { action: 'cancel-emergency', emergencyId: id }, token)
      const f = await fila(id); const p = await pago(id)
      ok(r.status === 200 && r.json?.data?.cobrado === false, 'B. awaiting_dispatch → cancela sin cobrar', JSON.stringify(r.json))
      ok(f.status === 'cancelled' && f.cancellation_charged === false, 'B. fila: cancelled, sin cargo')
      ok(p?.status === 'cancelled', 'B. la reserva quedó liberada (payments.status=cancelled)', p?.status)
    }
  }

  // C — dispatched con reserva → se cobra
  {
    const id = await crearEmergencia(userId)
    const res = await reservar(id, token)
    if (res.status === 200 && res.json?.data?.approved) {
      await admin.from('emergencies').update({ status: 'awaiting_dispatch' }).eq('id', id)
      await admin.from('emergencies').update({ status: 'dispatched', dispatched_at: new Date().toISOString() }).eq('id', id)

      // E — RLS: el UPDATE directo del paciente no cancela una despachada.
      const { data: tocadas } = await cliente.from('emergencies').update({ status: 'cancelled' }).eq('id', id).select('id')
      ok((tocadas ?? []).length === 0 && (await fila(id)).status === 'dispatched', 'E. el paciente NO puede cancelar por UPDATE directo una despachada')

      const r = await llamar('mp-capture', { action: 'cancel-emergency', emergencyId: id }, token)
      const f = await fila(id); const p = await pago(id)
      ok(r.status === 200 && r.json?.data?.cobrado === true && r.json?.data?.monto > 0, 'C. dispatched → cancela y cobra', JSON.stringify(r.json))
      ok(f.status === 'cancelled' && f.cancellation_charged === true, 'C. fila: cancelled, con cargo')
      ok(p?.status === 'approved', 'C. la reserva quedó CAPTURADA (payments.status=approved)', p?.status)

      // G — cancelled es final
      const { error: gErr } = await admin.from('emergencies').update({ status: 'dispatched' }).eq('id', id)
      ok(Boolean(gErr) && (await fila(id)).status === 'cancelled', 'G. una cancelada no se puede volver a despachar', gErr?.message)
    } else {
      ok(false, 'C. reserva en el sandbox de MP', `${res.status} ${JSON.stringify(res.json)}`)
    }
  }

  /*
   * C2/C3 — la rama con cobro SIN depender del sandbox de MP (que en staging
   * hoy no autoriza: devuelve `internal_error`). Se simula la fila de
   * `payments` directo en la base:
   *   C2. pago ya `approved` → no llama a MP, cancela y devuelve cobrado:true.
   *   C3. pago `authorized` con un mp_payment_id que MP no conoce → la captura
   *       falla y la emergencia NO se cancela (sigue `dispatched`).
   * No reemplazan a C: la llamada real de captura a MP sólo la prueba C.
   */
  const filaPago = (emergencyId, patientId, extra) => ({
    emergency_id: emergencyId, patient_id: patientId, method: 'card',
    gross_amount: 50, credits_used: 0, charged_amount: 50, platform_fee: 0,
    mp_fee_estimated: 0, net_to_professional: 0, manual_settlement_amount: 0, currency: 'ARS',
    ...extra,
  })
  {
    const id = await crearEmergencia(userId)
    await admin.from('emergencies').update({ status: 'awaiting_dispatch', paid_at: new Date().toISOString() }).eq('id', id)
    await admin.from('emergencies').update({ status: 'dispatched' }).eq('id', id)
    const { error } = await admin.from('payments').insert(filaPago(id, userId, { status: 'approved', mp_payment_id: '1' }))
    if (error) throw error
    const r = await llamar('mp-capture', { action: 'cancel-emergency', emergencyId: id }, token)
    const f = await fila(id)
    ok(r.status === 200 && r.json?.data?.cobrado === true && r.json?.data?.monto === 50, 'C2. dispatched con pago ya cobrado → cancela con cobrado:true', JSON.stringify(r.json))
    ok(f.status === 'cancelled' && f.cancellation_charged === true, 'C2. fila: cancelled, con cargo')
  }
  {
    const id = await crearEmergencia(userId)
    await admin.from('emergencies').update({ status: 'awaiting_dispatch', paid_at: new Date().toISOString() }).eq('id', id)
    await admin.from('emergencies').update({ status: 'in_transit' }).eq('id', id)
    const { error } = await admin.from('payments').insert(filaPago(id, userId, { status: 'authorized', mp_payment_id: '999999999999' }))
    if (error) throw error
    const r = await llamar('mp-capture', { action: 'cancel-emergency', emergencyId: id }, token)
    const f = await fila(id); const p = await pago(id)
    ok(r.status >= 400 && f.status === 'in_transit' && p?.status === 'authorized', 'C3. si la captura falla, NO se cancela', `${r.status} ${JSON.stringify(r.json)} · fila=${f.status}`)
  }
  {
    // B2 — awaiting_dispatch con reserva que MP no puede liberar: se cancela
    // igual (sin cargo) y el error queda en el log.
    const id = await crearEmergencia(userId)
    await admin.from('emergencies').update({ status: 'awaiting_dispatch', paid_at: new Date().toISOString() }).eq('id', id)
    const { error } = await admin.from('payments').insert(filaPago(id, userId, { status: 'authorized', mp_payment_id: '999999999998' }))
    if (error) throw error
    const r = await llamar('mp-capture', { action: 'cancel-emergency', emergencyId: id }, token)
    const f = await fila(id)
    ok(r.status === 200 && r.json?.data?.cobrado === false && f.status === 'cancelled' && f.cancellation_charged === false, 'B2. awaiting_dispatch → cancela sin cargo aunque MP falle al liberar', JSON.stringify(r.json))
  }
  {
    // E2 — RLS sin MP: el paciente no cancela por UPDATE directo una despachada.
    const id = await crearEmergencia(userId)
    await admin.from('emergencies').update({ status: 'dispatched' }).eq('id', id)
    const { data: tocadas } = await cliente.from('emergencies').update({ status: 'cancelled' }).eq('id', id).select('id')
    ok((tocadas ?? []).length === 0 && (await fila(id)).status === 'dispatched', 'E2. el paciente NO puede cancelar por UPDATE directo una despachada')
    await admin.from('emergencies').update({ status: 'cancelled' }).eq('id', id)
    const { error: gErr } = await admin.from('emergencies').update({ status: 'dispatched' }).eq('id', id)
    ok(Boolean(gErr) && (await fila(id)).status === 'cancelled', 'G2. una cancelada no se puede volver a despachar', gErr?.message)
  }

  // D — arrived → 409
  {
    const id = await crearEmergencia(userId)
    await admin.from('emergencies').update({ status: 'arrived' }).eq('id', id)
    const r = await llamar('mp-capture', { action: 'cancel-emergency', emergencyId: id }, token)
    ok(r.status === 409 && (await fila(id)).status === 'arrived', 'D. arrived → 409 y no se toca', JSON.stringify(r.json))
  }

  // F — el triage del paciente sigue andando
  {
    const id = await crearEmergencia(userId)
    const { data } = await cliente.from('emergencies').update({ status: 'awaiting_dispatch', triage_code: 'AMARILLO' }).eq('id', id).select('status').maybeSingle()
    ok(data?.status === 'awaiting_dispatch', 'F. el paciente sigue pudiendo hacer el triage (pending → awaiting_dispatch)')
  }

  // Ajeno: otro usuario no puede cancelar la emergencia del paciente — con service
  // role no hay "otro usuario" a mano; la regla vive en el `patient_id !== userId`.
}

try {
  await main()
} catch (err) {
  console.error('💥', err)
  fallas++
} finally {
  if (creadas.length) {
    await admin.from('payments').delete().in('emergency_id', creadas)
    await admin.from('emergencies').delete().in('id', creadas)
  }
  console.log(`\n${fallas ? `❌ ${fallas} falla(s)` : '✅ Todo en verde'}`)
  process.exit(fallas ? 1 : 0)
}
