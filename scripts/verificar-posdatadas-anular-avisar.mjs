#!/usr/bin/env node
// verificar-posdatadas-anular-avisar — el control de la migración 216
// (Mateo, 2026-10-22: "se anulan y sí avisamos"). Lo arreglado no vuelve: si
// una migración futura reescribe el trigger de la receta, el aviso o la
// función de anular, esto se pone en rojo.
//
//   node scripts/verificar-posdatadas-anular-avisar.mjs      # siempre STAGING
//
// Dos partes:
//   1. Base (Management API, cada caso en una transacción con ROLLBACK): el
//      cliente no puede anular a mano, el aviso sale una sola vez y sólo el día
//      que corresponde.
//   2. La Edge Function `rcta-anular` de staging, con sesiones reales: sólo la
//      anula quien la emitió, arrastra las posdatadas que no empezaron, deja la
//      que ya empezó, y una receta anulada no se vuelve a emitir. Usa un hash
//      inexistente, así que el servicio de recetas (homologación) contesta que
//      no la encuentra y se prueba también "anulada acá aunque allá no
//      confirme". Las filas que crea se borran al final.
//
// Nunca contra producción. Necesita en ~/Local/.env: SUPABASE_ACCESS_TOKEN y
// HEALTHIER_STAGING_SUPABASE_{REF,URL,ANON_KEY,SERVICE_ROLE_KEY}.
import fs from 'node:fs'
import os from 'node:os'
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries(
  fs.readFileSync(`${os.homedir()}/Local/.env`, 'utf8').split('\n')
    .filter(l => /^[A-Z0-9_]+=/.test(l))
    .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^["']|["']$/g, '')]),
)
const REF = env.HEALTHIER_STAGING_SUPABASE_REF
const TOKEN = env.SUPABASE_ACCESS_TOKEN
const URL_ = env.HEALTHIER_STAGING_SUPABASE_URL
const ANON = env.HEALTHIER_STAGING_SUPABASE_ANON_KEY
const SERVICE = env.HEALTHIER_STAGING_SUPABASE_SERVICE_ROLE_KEY
if (!REF || !TOKEN || !URL_ || !ANON || !SERVICE) { console.error('Faltan credenciales de staging en ~/Local/.env'); process.exit(2) }
if (!URL_.includes(REF) || REF === 'aixjejdoofervrkggbkd') { console.error('Esto corre sólo contra staging.'); process.exit(2) }

// Cuentas de staging: paciente@healthier.app, el Dr. demo y otra profesional.
const PACIENTE = 'ede3027e-e586-4e65-8b52-d7c44117a0c1'
const PRO = '00000001-0000-0000-0000-000000000001'
const PRO_EMAIL = 'demo.martin@healthier.app'
const OTRA_PRO_EMAIL = 'clinica@staging.healthier.app'
const PACIENTE_EMAIL = 'paciente@healthier.app'

const RX = 'a216a216-0000-4000-8000-0000000000a1'     // la de hoy
const POS1 = 'a216a216-0000-4000-8000-0000000000a2'   // ya empezó
const POS2 = 'a216a216-0000-4000-8000-0000000000a3'   // no empezó
const POS3 = 'a216a216-0000-4000-8000-0000000000a4'   // no empezó

const comoServicio = `select set_config('request.jwt.claims', '{"role":"service_role"}', true);`
const como = (uid) => `set local role authenticated; select set_config('request.jwt.claims', '{"sub":"${uid}","role":"authenticated"}', true);`
const reset = `reset role;`

const fila = (id, extra = '', valores = '') => `insert into clinical_medications (id, patient_id, professional_id, professional_license_type, professional_license_number,
    medication_name, presentation, dosage_text, rcta_status, rcta_prescription_id, rcta_hash, rcta_issued_at, status, quantity, is_chronic${extra})
  values ('${id}', '${PACIENTE}', '${PRO}', 'MN', '1', 'Prueba 216 Enalapril 10 mg', 'x 30', 'x', 'issued', 'prueba216-${id.slice(-2)}', 'PRUEBA216HASH${id.slice(-2)}', now(), 'active', '1', true${valores});`
const sembrar = `
  alter table clinical_medications disable trigger clinical_medications_avisar_receta;
  alter table clinical_medications disable trigger clinical_medications_mail_receta;
  alter table clinical_medications disable trigger verificar_que_puede_recetar;
  ${fila(RX)}
  ${fila(POS1, ', posdatada_de, vigencia_desde', `, '${RX}', (now() at time zone 'America/Argentina/Buenos_Aires')::date`)}
  ${fila(POS2, ', posdatada_de, vigencia_desde', `, '${RX}', (now() at time zone 'America/Argentina/Buenos_Aires')::date + 30`)}
  ${fila(POS3, ', posdatada_de, vigencia_desde', `, '${RX}', (now() at time zone 'America/Argentina/Buenos_Aires')::date + 60`)}
  alter table clinical_medications enable trigger clinical_medications_avisar_receta;
  alter table clinical_medications enable trigger clinical_medications_mail_receta;
  alter table clinical_medications enable trigger verificar_que_puede_recetar;`

const CASOS_BASE = [
  {
    nombre: 'El profesional no puede suspender a mano una receta emitida',
    sql: `${comoServicio} ${sembrar} ${como(PRO)} update clinical_medications set status = 'stopped' where id = '${RX}';`,
    espera: { error: 'Anular receta' },
  },
  {
    nombre: 'El profesional no puede marcar una receta como anulada a mano',
    sql: `${comoServicio} ${sembrar} ${como(PRO)} update clinical_medications set rcta_status = 'anulada' where id = '${POS2}';`,
    espera: { error: '42501' },
  },
  {
    nombre: 'Tampoco puede marcar anulado un borrador',
    sql: `${comoServicio} insert into clinical_medications (id, patient_id, professional_id, professional_license_type, professional_license_number, medication_name, dosage_text)
            values ('${RX}', '${PACIENTE}', '${PRO}', 'MN', '1', 'Prueba 216', 'x');
          ${como(PRO)} update clinical_medications set rcta_status = 'anulada' where id = '${RX}';`,
    espera: { error: '42501' },
  },
  {
    nombre: 'El cliente no escribe el hash ni la marca del aviso',
    sql: `${comoServicio} ${sembrar} ${como(PRO)} update clinical_medications set aviso_habilitada_at = now() where id = '${POS2}';`,
    espera: { error: '42501' },
  },
  {
    nombre: 'El aviso sale para la posdatada que empieza hoy, y sólo para ella',
    sql: `${comoServicio} ${sembrar}
          select avisar_posdatadas_habilitadas();
          select string_agg(right(id::text, 2), ',' order by id) as r from clinical_medications
           where id in ('${RX}', '${POS1}', '${POS2}', '${POS3}') and aviso_habilitada_at is not null;`,
    espera: { valor: 'a2' },
  },
  {
    nombre: 'El aviso no se repite en la segunda corrida',
    sql: `${comoServicio} ${sembrar}
          select avisar_posdatadas_habilitadas();
          create temp table t216 as select aviso_habilitada_at from clinical_medications where id = '${POS1}';
          select avisar_posdatadas_habilitadas();
          select ((select aviso_habilitada_at from clinical_medications where id = '${POS1}') = (select aviso_habilitada_at from t216))::text as r;`,
    espera: { valor: 'true' },
  },
  {
    nombre: 'El aviso deja el push y el mail en la cola de pg_net',
    sql: `${comoServicio} ${sembrar}
          create temp table antes216 as select coalesce(max(id), 0) as m from net.http_request_queue;
          select avisar_posdatadas_habilitadas();
          select count(*)::text as r
            from net.http_request_queue
           where id > (select m from antes216)
             and (url like '%/send-push-notification' or url like '%/send-email')
             and convert_from(body, 'utf8') like '%receta-habilitada%'
             and convert_from(body, 'utf8') like '%prueba216-a2%';`,
    espera: { valor: '2' },
  },
  {
    nombre: 'Una posdatada anulada no se avisa',
    sql: `${comoServicio} ${sembrar}
          update clinical_medications set status = 'cancelled', rcta_status = 'anulada' where id = '${POS1}';
          select avisar_posdatadas_habilitadas();
          select (aviso_habilitada_at is null)::text as r from clinical_medications where id = '${POS1}';`,
    espera: { valor: 'true' },
  },
  {
    nombre: 'El cron del aviso está programado a las 9 de Argentina',
    sql: `select schedule as r from cron.job where jobname = 'avisar-posdatadas-habilitadas';`,
    espera: { valor: '0 12 * * *' },
  },
  {
    nombre: 'El paciente no puede disparar el aviso',
    sql: `${como(PACIENTE)} select avisar_posdatadas_habilitadas();`,
    espera: { error: '42501' },
  },
]

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const cuerpo = await r.json().catch(() => ({}))
  return Array.isArray(cuerpo) ? { filas: cuerpo } : { error: cuerpo.message ?? JSON.stringify(cuerpo) }
}

let fallas = 0
const informar = (ok, nombre, detalle) => {
  if (!ok) fallas++
  console.log(`${ok ? '✅' : '❌'} ${nombre}`)
  if (!ok && detalle) console.log(`   ${String(detalle).slice(0, 400)}`)
}

console.log(`Posdatadas — anular en cadena y avisar (staging ${REF})\n`)
console.log('1 · Base')
for (const caso of CASOS_BASE) {
  const res = await sql(`begin; ${caso.sql} rollback;`)
  const ok = caso.espera.error
    ? !!res.error && res.error.includes(caso.espera.error)
    : !res.error && res.filas?.at(-1)?.r === caso.espera.valor
  informar(ok, caso.nombre, ok ? null : `esperaba ${JSON.stringify(caso.espera)} y vino ${JSON.stringify(res)}`)
}

// ── 2 · La función, con sesiones de verdad ───────────────────────────────────
console.log('\n2 · rcta-anular (staging)')
const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } })

async function sesion(email) {
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (error) throw new Error(`${email}: ${error.message}`)
  const anon = createClient(URL_, ANON, { auth: { persistSession: false } })
  const { data: s, error: e2 } = await anon.auth.verifyOtp({ token_hash: data.properties.hashed_token, type: 'magiclink' })
  if (e2) throw new Error(`${email}: ${e2.message}`)
  return s.session.access_token
}

async function llamar(fn, jwt, body) {
  const r = await fetch(`${URL_}/functions/v1/${fn}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}`, apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: r.status, json: await r.json().catch(() => ({})) }
}

const limpiar = () => sql(`begin;
  alter table clinical_medications disable trigger clinical_medications_no_delete;
  delete from rcta_issue_log where medication_ids && array['${RX}','${POS1}','${POS2}','${POS3}']::uuid[];
  delete from clinical_access_log where resource_id in ('${RX}','${POS1}','${POS2}','${POS3}');
  delete from clinical_medications where id in ('${POS1}','${POS2}','${POS3}');
  delete from clinical_medications where id = '${RX}';
  alter table clinical_medications enable trigger clinical_medications_no_delete;
  commit;`)

try {
  await limpiar()
  const sem = await sql(`begin; ${sembrar} commit;`)
  if (sem.error) throw new Error(`sembrar: ${sem.error}`)

  const [jwtPro, jwtOtra, jwtPaciente] = await Promise.all([sesion(PRO_EMAIL), sesion(OTRA_PRO_EMAIL), sesion(PACIENTE_EMAIL)])

  const otra = await llamar('rcta-anular', jwtOtra, { medicationId: RX })
  informar(otra.status === 403, 'Otra profesional no puede anular la receta', JSON.stringify(otra))
  const pac = await llamar('rcta-anular', jwtPaciente, { medicationId: RX })
  informar(pac.status === 403, 'El paciente no puede anular su receta', JSON.stringify(pac))
  const desdePos = await llamar('rcta-anular', jwtPro, { medicationId: POS2 })
  informar(desdePos.status === 422, 'Una posdatada no se anula suelta (se anula desde la original)', JSON.stringify(desdePos))

  const anul = await llamar('rcta-anular', jwtPro, { medicationId: RX, motivo: 'Prueba 216' })
  informar(anul.status === 200 && anul.json.anuladas?.length === 3 && anul.json.siguenVigentes?.length === 1,
    'El prescriptor anula: la de hoy + las 2 que no empezaron; la que ya empezó sigue', JSON.stringify(anul))
  informar(anul.json.sinConfirmar === 3,
    'Con un hash que el servicio no conoce, las 3 quedan "sin confirmar"', JSON.stringify(anul.json))

  const { data: filas } = await admin.from('clinical_medications')
    .select('id, status, rcta_status, rcta_anulacion_estado, stop_reason').in('id', [RX, POS1, POS2, POS3])
  const de = id => filas.find(f => f.id === id) ?? {}
  informar([RX, POS2, POS3].every(id => de(id).status === 'cancelled' && de(id).rcta_status === 'anulada'),
    'En la base quedan anuladas igual (la farmacia no las vende)', JSON.stringify(filas))
  informar(de(POS1).status === 'active' && de(POS1).rcta_status === 'issued', 'La posdatada que ya empezó queda como estaba', JSON.stringify(de(POS1)))
  informar(de(RX).stop_reason === 'Prueba 216', 'El motivo queda en la historia clínica', JSON.stringify(de(RX)))

  const { data: recetas } = await admin.rpc('farmacia_recetas_de', { p_patient: PACIENTE })
  const ids = (recetas ?? []).map(r => r.clinical_medication_id)
  informar(ids.includes(POS1) && !ids.some(id => [RX, POS2, POS3].includes(id)),
    'La farmacia sólo ve la posdatada que ya empezó', JSON.stringify(ids))

  const { count: logs } = await admin.from('rcta_issue_log').select('id', { count: 'exact', head: true })
    .overlaps('medication_ids', [RX, POS2, POS3]).eq('outcome', 'anulacion_error')
  informar(logs === 3, 'Cada intento queda en el log de recetas (super admin → Auditoría)', `logs=${logs}`)

  const otraVez = await llamar('rcta-anular', jwtPro, { medicationId: RX })
  informar(otraVez.status === 200 && otraVez.json.reintento === true && otraVez.json.anuladas?.length === 3,
    'Reintentar vuelve a llamar sólo por las que no se confirmaron', JSON.stringify(otraVez))

  const reemitir = await llamar('rcta-issue', jwtPro, { medicationId: RX })
  informar(reemitir.status === 409 && reemitir.json.code === 'RCTA_ANULADA', 'Una receta anulada no se vuelve a emitir', JSON.stringify(reemitir))
} catch (err) {
  informar(false, 'La parte de la función no pudo correr', err.message)
} finally {
  const l = await limpiar()
  if (l.error) console.log(`⚠️ No se pudo limpiar: ${l.error}`)
}

console.log(fallas ? `\n❌ ${fallas} caso(s) en rojo.` : '\n✅ Anular arrastra las posdatadas y el aviso sale una vez.')
process.exit(fallas ? 1 : 0)
