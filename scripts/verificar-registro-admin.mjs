#!/usr/bin/env node
/**
 * Registro de acciones de administradores (migración 218) — control automático,
 * SÓLO STAGING.
 *
 *   node scripts/verificar-registro-admin.mjs
 *
 * **Por qué existe.** El Manual de Seguridad presentado al RENAPER declara que
 * las acciones de los administradores (altas, bajas, cambios de rol,
 * verificación de profesionales) quedan registradas con usuario, fecha y hora,
 * y que el registro no se puede modificar ni borrar. Esto falla si:
 *
 *   · una acción admin deja de quedar asentada (alguien reescribe el flujo, o
 *     agrega una tabla que el super admin escribe y no le pone el trigger), o
 *   · se puede editar, borrar o vaciar `admin_action_log` — con el service role,
 *     con la sesión del super admin o desde SQL.
 *
 * Recorre el flujo REAL (la API con la sesión del super admin y las mismas Edge
 * Functions que llama el panel), no sólo la base:
 *
 *   1. cambio de rol (RPC promote_user_to_admin) → actor, rol, antes/después
 *   2. el mismo cambio hecho por el servidor → igual queda asentado (via=servidor)
 *   3. verificar / pedir revisión a un profesional → y que limpiar el rechazo no asiente
 *   4. "iniciar sesión como" y baja de cuenta (Edge Functions); la baja que se hace la
 *      propia persona y la reactivación por mail NO son acciones admin
 *   4b. decisión de consultorio y rechazo repetidos: cada decisión queda, no sólo la primera
 *   5. configuración de la plataforma (platform_settings) con antes/después
 *   6. edición del perfil de otra persona: asienta los NOMBRES de columna, no los valores
 *   7. devolución decidida por el super admin (disparada desde SQL, se deshace)
 *   8. append-only: UPDATE / DELETE / INSERT / TRUNCATE rechazados para todos
 *   9. cobertura POR OPERACIÓN: por cada INSERT / UPDATE / DELETE que las policies le
 *      dan a un admin (o al admin de un tenant: emergencias, farmacia) tiene que
 *      haber un trigger que lo asiente, o una excepción explicada acá abajo
 *   10. el id del asiento de configuración es la clave primaria real (rnos, droga…)
 *   11. el admin de emergencias queda asentado en las tablas de su tenant, pero NO
 *       el despacho diario (ambulances.status)
 *   3b. un admin que edita el legajo (matrícula, dirección): asentado aunque no toque columnas de verificación
 *   12. consultas: el admin edita cualquier columna (precio, profesional…), crea y
 *       borra, y queda asentado; un paciente que edita la suya, no
 *
 * Código de salida: 0 todo probado y verde · 1 fallas · 3 sin fallas pero NO PROBADO por falta de
 * cuentas/datos demo en staging (cuenta como rojo: no se da por bueno lo que no se corrió).
 *
 * Deja la base como la encontró (los asientos de prueba quedan: son inmutables).
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries(
  readFileSync(join(homedir(), 'Local', '.env'), 'utf8')
    .split('\n').map(l => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2].replace(/^["']|["']$/g, '')])
)
const REF = env.HEALTHIER_STAGING_SUPABASE_REF
const URL = env.HEALTHIER_STAGING_SUPABASE_URL
if (!REF || REF === 'aixjejdoofervrkggbkd') { console.error('Sólo corre contra staging.'); process.exit(2) }
const ANON = env.HEALTHIER_STAGING_SUPABASE_ANON_KEY
const SERVICE = env.HEALTHIER_STAGING_SUPABASE_SERVICE_ROLE_KEY

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } })

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const text = await r.text()
  if (!r.ok) throw new Error(text)
  return JSON.parse(text)
}
const falla = (p) => p.then(() => null, e => e.message)

async function rest(path, { method = 'GET', body, token, service = false } = {}) {
  const key = service ? SERVICE : ANON
  const r = await fetch(`${URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: key, Authorization: `Bearer ${service ? SERVICE : token}`,
      'Content-Type': 'application/json', Prefer: 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const txt = await r.text()
  let data = null
  try { data = txt ? JSON.parse(txt) : null } catch { data = txt }
  return { ok: r.ok, status: r.status, data }
}

async function funcion(nombre, body, token, reintento = true) {
  const r = await fetch(`${URL}/functions/v1/${nombre}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  const res = { status: r.status, json: await r.json().catch(() => null) }
  // La puerta de las Edge Functions a veces contesta 401 a un token recién emitido: una vez más con sesión nueva.
  if (res.status === 401 && reintento) return funcion(nombre, body, (await sesionDe('superadmin@healthier.app')).token, false)
  return res
}

async function sesionDe(email) {
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (error) throw error
  const anon = createClient(URL, ANON, { auth: { persistSession: false } })
  const { data: s, error: e2 } = await anon.auth.verifyOtp({ type: 'magiclink', token_hash: data.properties.hashed_token })
  if (e2) throw e2
  return { token: s.session.access_token, id: s.user.id }
}

let fallas = 0
const ok = (cond, msg) => { console.log(`${cond ? '✅' : '❌'} ${msg}`); if (!cond) fallas++ }
// Lo que NO se pudo probar porque faltan cuentas o datos demo de staging. Un control que se saltea
// pruebas en silencio y sale en verde miente: se informa y el script termina con código 3.
const noProbado = []
const noProbadoItem = (que, porQue) => { noProbado.push(que); console.log(`⚠️  NO PROBADO: ${que} — ${porQue}`) }

const [{ ahora }] = await sql('select now() as ahora')
const asientos = (where) => sql(`select * from public.admin_action_log where created_at >= '${ahora}' and ${where} order by created_at`)

const ts = Date.now()
const EMAIL = `registro.admin.${ts}@staging.healthier.app`
let userId = null
let userIdB = null
const EMAIL_B = `registro.admin.b.${ts}@staging.healthier.app`
const restaurar = []   // pasos para dejar el profesional como estaba

try {
  const sup = await sesionDe('superadmin@healthier.app')
  const pac = await sesionDe('paciente@healthier.app')
  const { data: creado, error } = await admin.auth.admin.createUser({
    email: EMAIL, password: `Reg-${ts}-Aa1`, email_confirm: true,
    user_metadata: { role: 'patient', first_name: 'Registro', last_name: 'Admin', full_name: 'Registro Admin' },
  })
  if (error) throw error
  userId = creado.user.id
  console.log(`· cuenta de prueba ${EMAIL} (${userId}); super admin ${sup.id}`)

  // El alta de un paciente por su cuenta NO es una acción de administración.
  const altas = await asientos(`action = 'alta_de_cuenta' and entity_id = '${userId}'`)
  ok(altas.length === 0, 'el registro de un paciente no se asienta como acción admin')

  // 1 ─ Cambio de rol por la API, con la sesión del super admin
  const r1 = await rest('rpc/promote_user_to_admin', { method: 'POST', token: sup.token, body: { target_email: EMAIL, new_role: 'admin' } })
  ok(r1.ok, `promote_user_to_admin como super admin (HTTP ${r1.status})`)
  const [a1] = await asientos(`action = 'cambio_de_rol' and entity_id = '${userId}'`)
  ok(a1 && a1.actor_id === sup.id && a1.actor_role === 'super_admin' && a1.via === 'usuario',
    `cambio de rol asentado con quién (${a1?.actor_email}, ${a1?.actor_role}, via ${a1?.via})`)
  ok(a1?.detail?.antes === 'patient' && a1?.detail?.despues === 'admin' && a1?.target_user_id === userId,
    'cambio de rol: antes/después y sobre quién')

  // 2 ─ El mismo cambio hecho "por el servidor" (consola / service role)
  await sql(`update public.profiles set role = 'patient' where id = '${userId}'`)
  const a2 = await asientos(`action = 'cambio_de_rol' and entity_id = '${userId}' and via = 'servidor'`)
  ok(a2.length === 1 && a2[0].actor_id === null && a2[0].detail.despues === 'patient',
    'un cambio de rol hecho desde la consola igual queda asentado (via=servidor)')

  // 3 ─ Verificación de un profesional
  const [pro] = await sql(`select id, user_id, is_verified, verified_by, rejection_type, rejection_reason,
                                  refes_estado, refes_revisado_por, refes_revisado_at, refes_error
                           from public.professional_profiles pp
                           where user_id = (select id from public.profiles where email = 'profesional@healthier.app' limit 1)`)
  if (!pro) noProbadoItem('verificación, rechazo, consultorio y legajo de un profesional', 'falta profesional@healthier.app con su legajo en staging')
  if (pro) {
  // Se restaura con la sesión del super admin: un trigger de la base no deja
  // cambiar is_verified a nadie que no sea administrador.
  restaurar.push(() => rest(`professional_profiles?id=eq.${pro.id}`, {
    method: 'PATCH', token: sup.token,
    body: { is_verified: pro.is_verified, verified_by: pro.verified_by, rejection_type: pro.rejection_type, rejection_reason: pro.rejection_reason },
  }).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status} ${JSON.stringify(r.data)}`) }))
  const r3 = await rest(`professional_profiles?id=eq.${pro.id}`, {
    method: 'PATCH', token: sup.token, body: { is_verified: !pro.is_verified, verified_by: sup.id },
  })
  ok(r3.ok, `el super admin cambia is_verified por la API (HTTP ${r3.status})`)
  const [a3] = await asientos(`action = 'verificacion_profesional' and entity_id = '${pro.id}'`)
  ok(a3 && a3.actor_id === sup.id && a3.detail.antes === pro.is_verified && a3.detail.despues === !pro.is_verified,
    `verificación asentada con quién y antes/después (${a3?.actor_email})`)

  const r3b = await rest(`professional_profiles?id=eq.${pro.id}`, {
    method: 'PATCH', token: sup.token, body: { rejection_type: 'revision', rejection_reason: 'prueba del registro admin', verified_by: sup.id },
  })
  ok(r3b.ok, `pedido de revisión (HTTP ${r3b.status} ${r3b.ok ? '' : JSON.stringify(r3b.data)})`)
  const [a3b] = await asientos(`action = 'rechazo_profesional' and entity_id = '${pro.id}'`)
  ok(a3b && a3b.actor_id === sup.id && a3b.detail.tipo === 'revision', 'pedido de revisión asentado con su motivo')
  await rest(`professional_profiles?id=eq.${pro.id}`, {
    method: 'PATCH', token: sup.token, body: { rejection_type: 'revision', rejection_reason: 'segundo motivo distinto', verified_by: sup.id },
  })
  const rechazos2 = await asientos(`action = 'rechazo_profesional' and entity_id = '${pro.id}'`)
  ok(rechazos2.length === 2 && rechazos2[1].detail.motivo === 'segundo motivo distinto',
    'un segundo pedido de revisión con otro motivo también queda asentado')
  await rest(`professional_profiles?id=eq.${pro.id}`, { method: 'PATCH', token: sup.token, body: { rejection_type: null, rejection_reason: null } })
  const rechazos = await asientos(`action = 'rechazo_profesional' and entity_id = '${pro.id}'`)
  ok(rechazos.length === 2, 'limpiar el rechazo (reenvío) no se asienta como acción admin')

  // 3b ─ Decisión sobre el consultorio: cada decisión del mismo admin queda
  restaurar.push(() => rest(`professional_profiles?id=eq.${pro.id}`, {
    method: 'PATCH', token: sup.token,
    body: { refes_estado: pro.refes_estado, refes_revisado_por: pro.refes_revisado_por, refes_revisado_at: pro.refes_revisado_at, refes_error: pro.refes_error },
  }).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status} ${JSON.stringify(r.data)}`) }))
  for (const [estado, hora] of [['aprobado_manual', 1000], ['rechazado_manual', 2000]]) {
    const r = await rest(`professional_profiles?id=eq.${pro.id}`, {
      method: 'PATCH', token: sup.token,
      body: { refes_estado: estado, refes_revisado_por: sup.id, refes_revisado_at: new Date(Date.now() + hora).toISOString() },
    })
    ok(r.ok, `decisión del consultorio ${estado} (HTTP ${r.status}${r.ok ? '' : ' ' + JSON.stringify(r.data)})`)
  }
  const dc = await asientos(`action = 'decision_consultorio' and entity_id = '${pro.id}'`)
  ok(dc.length === 2 && dc[0].detail.estado === 'aprobado_manual' && dc[1].detail.estado === 'rechazado_manual' && dc.every(a => a.actor_id === sup.id),
    'dos decisiones seguidas del mismo admin: las dos quedan asentadas')

  }

  // 4 ─ Edge Functions de admin: "iniciar sesión como" y baja de cuenta
  const imp = await funcion('impersonate-user', { targetUserId: userId }, sup.token)
  ok(imp.status === 200, `impersonate-user (HTTP ${imp.status})`)
  const [a4] = await asientos(`action = 'iniciar_sesion_como' and target_user_id = '${userId}'`)
  ok(a4 && a4.actor_id === sup.id, 'iniciar sesión como: asentado con el admin que lo hizo')

  // 6 ─ Un admin edita el perfil de otra persona (antes de la baja, que le cambia el mail)
  const r6 = await rest(`profiles?id=eq.${userId}`, { method: 'PATCH', token: sup.token, body: { full_name: 'Nombre Secreto Editado' } })
  ok(r6.ok, `el super admin edita el nombre de otra persona (HTTP ${r6.status})`)
  const [a6] = await asientos(`action = 'edicion_de_perfil_por_admin' and entity_id = '${userId}'`)
  ok(a6 && a6.actor_id === sup.id && a6.detail.columnas?.includes('full_name'), 'edición del perfil: asienta la columna')
  ok(a6 && !JSON.stringify(a6.detail).includes('Secreto'), 'edición del perfil: NO copia el valor (datos personales)')
  // Una persona editando SU propio perfil no es una acción de administración.
  const antes = (await asientos(`action = 'edicion_de_perfil_por_admin'`)).length
  await rest(`profiles?id=eq.${pac.id}`, { method: 'PATCH', token: pac.token, body: { phone: '+5491100000001' } })
  ok((await asientos(`action = 'edicion_de_perfil_por_admin'`)).length === antes, 'un paciente editando su propio perfil no se asienta')

  // La baja que se hace la propia persona (delete-account, service role) y la
  // reactivación por el link del mail NO son acciones de administración.
  const { data: cb, error: errB } = await admin.auth.admin.createUser({
    email: EMAIL_B, password: `Reg-B-${ts}-Aa1`, email_confirm: true,
    user_metadata: { role: 'patient', first_name: 'Registro', last_name: 'Propia', full_name: 'Registro Propia' },
  })
  if (errB) throw errB
  userIdB = cb.user.id
  await sql(`update public.profiles set deleted_at = now(), deleted_by = null where id = '${userIdB}'`)
  await sql(`update public.profiles set deleted_at = null where id = '${userIdB}'`)
  await sql(`update public.profiles set deleted_at = now(), deleted_by = '${userIdB}' where id = '${userIdB}'`)
  const propias = await asientos(`entity_id = '${userIdB}' and action in ('baja_de_cuenta', 'reactivacion_de_cuenta')`)
  ok(propias.length === 0, 'baja propia (sin y con deleted_by = sí misma) y reactivación: no se asientan como acciones admin')

  const baja = await funcion('dar-de-baja-usuario', { ids: [userId] }, sup.token)
  ok(baja.status === 200 && baja.json?.resultados?.every(r => r.ok), `dar-de-baja-usuario (HTTP ${baja.status})`)
  const [a5] = await asientos(`action = 'baja_de_cuenta' and entity_id = '${userId}'`)
  ok(a5 && a5.actor_id === sup.id && a5.actor_role === 'super_admin', 'baja de cuenta: asentada con el admin que la hizo')

  // 5 ─ Configuración de la plataforma
  const [conf] = await sql('select slot_duration_minutes from public.platform_settings where id = 1')
  const nuevo = conf.slot_duration_minutes === 20 ? 15 : 20
  const r5 = await rest('platform_settings?id=eq.1', { method: 'PATCH', token: sup.token, body: { slot_duration_minutes: nuevo } })
  ok(r5.ok, `el super admin cambia platform_settings (HTTP ${r5.status})`)
  await rest('platform_settings?id=eq.1', { method: 'PATCH', token: sup.token, body: { slot_duration_minutes: conf.slot_duration_minutes } })
  const a7 = await asientos(`action = 'modificacion_platform_settings'`)
  ok(a7.length === 2 && a7[0].actor_id === sup.id
    && a7[0].detail.cambios.slot_duration_minutes.antes === conf.slot_duration_minutes
    && a7[0].detail.cambios.slot_duration_minutes.despues === nuevo,
    'configuración: dos cambios asentados con antes/después')

  // 7 ─ Devolución decidida por el super admin (se deshace: el bloque termina con error)
  const [pago] = await sql(`select id from public.payments where patient_id is not null limit 1`)
  if (pago) {
    const r = await sql(`do $$
      declare n int; v text;
      begin
        update public.payments set refund_request_status = 'approved', refund_reviewed_by = '${sup.id}', refund_reviewed_at = now()
         where id = '${pago.id}';
        select count(*)::text into v from public.admin_action_log where entity_id = '${pago.id}' and action = 'devolucion_aprobada' and actor_id = '${sup.id}';
        raise exception 'DEVOLUCION %', v;
      end $$;`).then(() => '', e => e.message)
    ok(/DEVOLUCION 1/.test(r), `devolución aprobada: asentada con el admin que la decidió (${r.match(/DEVOLUCION \d+/)?.[0] ?? r.slice(0, 120)})`)
  } else {
    console.log('· sin pagos en staging: se saltea la devolución')
  }

  // 10 ─ El id del asiento de configuración es la clave primaria real
  const pk = await sql(`do $$
    declare a text; b text;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', '${sup.id}', 'role', 'authenticated')::text, true);
      set local role authenticated;
      insert into public.cobertura_rnos (rnos, nombre_catalogo) values ('999999', 'prueba del registro admin');
      insert into public.farmacia_drogas_bajo_receta (droga, tipo, motivo) values ('droga-de-prueba-registro', 'receta', 'x');
      reset role;
      select entity_id into a from public.admin_action_log where action = 'alta_cobertura_rnos' and created_at >= now() - interval '1 minute' order by created_at desc limit 1;
      select entity_id into b from public.admin_action_log where action = 'alta_farmacia_drogas_bajo_receta' and created_at >= now() - interval '1 minute' order by created_at desc limit 1;
      raise exception 'PK %|%', a, b;
    end $$;`).then(() => '', e => e.message)
  ok(/PK 999999\|droga-de-prueba-registro/.test(pk), `entity_id = clave primaria real (${pk.match(/PK [^\n]*/)?.[0] ?? pk.slice(0, 160)})`)

  // 11 ─ El admin de emergencias (tenant) queda asentado en las tablas de su tenant
  const tenant = await sql(`do $$
    declare adm uuid; fila uuid; n int;
    begin
      select p.id into adm from public.profiles p where p.role = 'emergency_admin' and exists (select 1 from public.emergency_provider_staff s where s.profile_id = p.id) limit 1;
      if adm is null then raise exception 'TENANT sin-datos'; end if;
      select id into fila from public.emergency_provider_staff where profile_id = adm limit 1;
      perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
      set local role authenticated;
      update public.emergency_provider_staff set es_coordinador = not es_coordinador where id = fila;
      reset role;
      select count(*) into n from public.admin_action_log where actor_id = adm and action = 'modificacion_emergency_provider_staff' and entity_id = fila::text;
      raise exception 'TENANT %', n;
    end $$;`).then(() => '', e => e.message)
  if (/TENANT sin-datos/.test(tenant)) noProbadoItem('el admin de emergencias queda asentado en su tenant', 'no hay un emergency_admin con personal asignado en staging')
  else ok(/TENANT 1/.test(tenant), `un emergency_admin que cambia su personal queda asentado (${tenant.match(/TENANT \d+/)?.[0] ?? tenant.slice(0, 160)})`)

  // 12 ─ Consultas: cualquier columna, también crear y borrar; un paciente no cuenta.
  // Todo en un bloque que termina SIEMPRE con error (se deshace): se crea una consulta de
  // prueba y se borra ésa, nunca una existente.
  const [pacDemo] = await sql(`select id from public.profiles where email = 'paciente@healthier.app' and titular_id is null limit 1`)
  const [proDemo] = await sql(`select id from public.profiles where email = 'profesional@healthier.app' limit 1`)
  if (!pacDemo || !proDemo) noProbadoItem('consultas (admin edita, crea y borra; el paciente no cuenta)', 'faltan paciente@healthier.app / profesional@healthier.app en staging')
  else {
  const consR = await sql(`do $$
    declare v uuid; v2 uuid; filas int; pac int; a int; b int; c int; d int;
    begin
      -- la consulta de prueba la crea el servidor (la base protege el estado de pago de las demás)
      perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
      insert into public.consultations (patient_id, professional_id) values ('${pacDemo.id}', '${proDemo.id}') returning id into v;
      -- 1. el PACIENTE edita su consulta: tiene que tocar 1 fila y no asentar nada
      perform set_config('request.jwt.claims', json_build_object('sub', '${pacDemo.id}', 'role', 'authenticated')::text, true);
      set local role authenticated;
      update public.consultations set cancel_reason = 'prueba' where id = v;
      get diagnostics filas = row_count;
      reset role;
      select count(*) into pac from public.admin_action_log where entity_id = v::text;
      -- 2. el ADMIN cambia columnas que el panel no toca, crea una y borra la de prueba
      perform set_config('request.jwt.claims', json_build_object('sub', '${sup.id}', 'role', 'authenticated')::text, true);
      set local role authenticated;
      update public.consultations set price_at_booking = coalesce(price_at_booking, 0) + 1 where id = v;
      update public.consultations set invoice_url = 'https://example.test/f.pdf' where id = v;
      insert into public.consultations (patient_id, professional_id) values ('${pacDemo.id}', '${proDemo.id}') returning id into v2;
      delete from public.consultations where id = v;
      reset role;
      select count(*) into a from public.admin_action_log where entity_id = v::text and action = 'modificacion_consultations' and actor_id = '${sup.id}' and detail->'columnas' ? 'price_at_booking';
      select count(*) into b from public.admin_action_log where entity_id = v::text and action = 'modificacion_consultations' and detail->'columnas' ? 'invoice_url';
      select count(*) into c from public.admin_action_log where entity_id = v::text and action = 'eliminacion_consultations' and actor_id = '${sup.id}';
      select count(*) into d from public.admin_action_log where entity_id = v2::text and action = 'alta_consultations' and actor_id = '${sup.id}';
      raise exception 'CONS filas=% pac=% precio=% factura=% baja=% alta=%', filas, pac, a, b, c, d;
    end $$;`).then(() => '', e => e.message)
  ok(/CONS filas=1 pac=0 precio=1 factura=1 baja=1 alta=1/.test(consR),
    `consultas: el paciente edita la suya (1 fila, nada asentado); el admin cambia precio y factura, crea y borra → todo asentado (${consR.match(/CONS [^\n]*/)?.[0] ?? consR.slice(0, 220)})`)

  }

  // 11b ─ El despacho diario (estado de la ambulancia) NO es una acción de administración
  const [hayAmb] = await sql(`select exists (select 1 from public.ambulances where id = '40000000-0000-0000-0000-000000000001')
                                and exists (select 1 from public.profiles where id = '30000000-0000-0000-0000-000000000001' and role = 'emergency_admin') as ok`)
  if (!hayAmb.ok) noProbadoItem('el despacho diario (ambulances.status) no se asienta', 'no están los seeds de despacho de staging (ambulancia 4000…01 / emergency_admin 3000…01)')
  else {
  const amb = await sql(`do $$
    declare adm uuid := '30000000-0000-0000-0000-000000000001'; amb uuid := '40000000-0000-0000-0000-000000000001'; a int; b int; st text;
    begin
      select status into st from public.ambulances where id = amb;
      perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
      set local role authenticated;
      update public.ambulances set status = case when st = 'en_servicio' then 'disponible' else 'en_servicio' end where id = amb;
      reset role;
      select count(*) into a from public.admin_action_log where entity_id = amb::text and action = 'modificacion_ambulances';
      perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
      set local role authenticated;
      update public.ambulances set label = label || ' (prueba)' where id = amb;
      reset role;
      select count(*) into b from public.admin_action_log where entity_id = amb::text and action = 'modificacion_ambulances';
      raise exception 'AMB %/%', a, b;
    end $$;`).then(() => '', e => e.message)
  ok(/AMB 0\/1/.test(amb), `ambulancias: cambiar el estado no se asienta, cambiar la etiqueta sí (${amb.match(/AMB [\d/]+/)?.[0] ?? amb.slice(0, 200)})`)
  }

  // 3b ─ Un admin edita el legajo de un profesional (matrícula, dirección del consultorio):
  // el UPDATE de professional_profiles se asienta aunque no toque ninguna columna de verificación.
  if (pro) {
  const leg = await sql(`do $$
    declare n int; det jsonb;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', '${sup.id}', 'role', 'authenticated')::text, true);
      set local role authenticated;
      update public.professional_profiles set license_number = coalesce(license_number, '') || '0', address = coalesce(address, '') || ' ' where id = '${pro.id}';
      reset role;
      select count(*), min(detail::text)::jsonb into n, det from public.admin_action_log
       where entity_id = '${pro.id}' and action = 'modificacion_professional_profiles' and actor_id = '${sup.id}'
         and target_user_id = '${pro.user_id}';
      raise exception 'LEG % %', n, det->'columnas';
    end $$;`).then(() => '', e => e.message)
  ok(/LEG 1 /.test(leg) && /address/.test(leg) && /license_number/.test(leg), `edición de matrícula y dirección del consultorio asentada sobre la persona (target_user_id), sólo con los nombres de columna (${leg.match(/LEG [^\n]*/)?.[0] ?? leg.slice(0, 200)})`)

  }

  // 8 ─ Append-only, para todos
  const [{ n: total }] = await sql('select count(*)::int n from public.admin_action_log')
  const [una] = await sql('select id from public.admin_action_log limit 1')
  const intentos = [
    ['service role PATCH', rest(`admin_action_log?id=eq.${una.id}`, { method: 'PATCH', service: true, body: { action: 'x' } })],
    ['service role DELETE', rest(`admin_action_log?id=eq.${una.id}`, { method: 'DELETE', service: true })],
    ['service role INSERT', rest('admin_action_log', { method: 'POST', service: true, body: { via: 'usuario', action: 'x', entity_type: 'x' } })],
    ['super admin PATCH', rest(`admin_action_log?id=eq.${una.id}`, { method: 'PATCH', token: sup.token, body: { action: 'x' } })],
    ['super admin DELETE', rest(`admin_action_log?id=eq.${una.id}`, { method: 'DELETE', token: sup.token })],
    ['super admin INSERT', rest('admin_action_log', { method: 'POST', token: sup.token, body: { via: 'usuario', action: 'x', entity_type: 'x' } })],
  ]
  for (const [nombre, p] of intentos) {
    const r = await p
    ok(!r.ok || (Array.isArray(r.data) && r.data.length === 0), `${nombre} rechazado (HTTP ${r.status})`)
  }
  for (const [nombre, q] of [
    ['SQL UPDATE', `update public.admin_action_log set action = 'x' where id = '${una.id}'`],
    ['SQL DELETE', `delete from public.admin_action_log where id = '${una.id}'`],
    ['SQL TRUNCATE', 'truncate public.admin_action_log'],
  ]) {
    const msg = await falla(sql(q))
    ok(msg && /no se modifica ni se borra/.test(msg), `${nombre} rechazado por el trigger`)
  }
  const [{ n: despues }] = await sql('select count(*)::int n from public.admin_action_log')
  ok(despues >= total, `el registro no perdió filas (${total} → ${despues})`)
  const lee = await rest('admin_action_log?select=id&limit=1', { token: pac.token })
  ok(lee.ok && lee.data.length === 0, 'un paciente no lee el registro')
  const leeSuper = await rest('admin_action_log?select=id&limit=1', { token: sup.token })
  ok(leeSuper.ok && leeSuper.data.length === 1, 'el super admin sí lo lee')

  // 9 ─ Cobertura POR OPERACIÓN. Un trigger que sólo despierta ante ciertas columnas
  // (WHEN con old./new., UPDATE OF) NO cubre la operación: queda como hueco salvo que
  // tenga una justificación explícita acá abajo.
  // Excepciones, POR OPERACIÓN y con el motivo. '*' = todas las que dé la policy.
  const EXENTAS = {
    clinical_access_log: { DELETE: 'el DELETE lo frena el trigger de la 033 (retención de la HC); es ya un registro' },
    professional_verification_log: { '*': 'es el registro de decisiones; la decisión queda en professional_profiles (trigger)' },
    ambulance_locations: { '*': 'telemetría GPS de las ambulancias, no una acción de administración' },
    pharmacy_products: { '*': 'catálogo operativo que edita la propia farmacia (importaciones masivas)' },
    emergencies: { UPDATE: 'operación diaria del despacho (asignaciones); sólo se asientan los borrados del super admin' },
    medication_orders: { UPDATE: 'operación diaria de la farmacia (pedidos); sólo se asientan los borrados del super admin' },
  }
  // Operaciones cubiertas SÓLO por un trigger que filtra columnas, con su justificación.
  const PARCIALES = {
    profiles: { UPDATE: 'asienta rol, baja, exención/titular y marca de prueba, y la edición de OTRA persona con sesión (cualquier columna); lo que cada persona se guarda a sí misma no es una acción de administración' },
    professional_profiles: { UPDATE: 'toda columna que edite un admin se asienta salvo las de verificación, rechazo, estado y consultorio (con su propio trigger) y las que se mueven solas con ellas (reverificación, SISA, REFEPS) o ya asienta profiles (solo_pruebas)' },
    ambulances: { UPDATE: 'el estado (disponible / en servicio) cambia en cada asignación del despacho diario: no es una acción de administración' },
  }
  const BIT = { INSERT: 4, DELETE: 8, UPDATE: 16 }
  // ¿El trigger filtra por columnas? Se lee del CATÁLOGO, no del texto de la definición:
  //   · tgattr (UPDATE OF …) no vacío;
  //   · el WHEN (tgqual, el árbol del catálogo) mira OLD o una columna NEW que no sea la de la
  //     persona afectada (la guarda de actor `auth.uid() <> new.user_id` no cuenta);
  //   · el trigger recibe una lista de columnas excluidas (3.er argumento de registrar_admin_config).
  const filtraColumnas = (tg, op = 'UPDATE') => {
    if (op === 'UPDATE' && tg.attr) return true      // UPDATE OF …
    if (op === 'UPDATE' && tg.ignorar) return true   // columnas excluidas por argumento (sólo valen en el UPDATE)
    if (tg.old_vars > 0) return true         // el WHEN compara con OLD
    // El WHEN mira una columna NEW que NO es la de la persona (guarda de actor tipo `auth.uid() <> new.user_id`)
    return tg.new_attnums.some((n) => n !== tg.persona_attnum)
  }
  const ops = await sql(`
    with pol as (
      select p.tablename, o.op
        from pg_policies p
        cross join lateral unnest(case when p.cmd = 'ALL' then array['INSERT', 'UPDATE', 'DELETE'] else array[p.cmd] end) o(op)
       where p.schemaname = 'public' and p.cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
         and ((coalesce(p.qual, '') || coalesce(p.with_check, '')) ~ 'super_admin|''admin''|emergency_admin|pharmacy_admin')
       group by p.tablename, o.op)
    select pol.tablename, pol.op,
           coalesce((select json_agg(json_build_object(
                         'tipo', t.tgtype::int,
                         'attr', t.tgattr::text,
                         -- el WHEN, leído del árbol del catálogo: OLD = varno 1, NEW = varno 2
                         'old_vars', (select count(*) from regexp_matches(coalesce(t.tgqual::text, ''), ':varno 1 ', 'g')),
                         'new_attnums', (select coalesce(json_agg(m[1]::int), '[]'::json) from regexp_matches(coalesce(t.tgqual::text, ''), ':varno 2 :varattno (\\d+)', 'g') m),
                         -- argumentos de registrar_admin_config: [2] columnas excluidas, [4] columna de la persona afectada
                         'ignorar', coalesce((string_to_array(encode(t.tgargs, 'escape'), E'\\\\000'))[3], ''),
                         'persona_attnum', (select a.attnum from pg_attribute a where a.attrelid = t.tgrelid
                                              and a.attname = nullif((string_to_array(encode(t.tgargs, 'escape'), E'\\\\000'))[5], ''))))
                       from pg_trigger t
                      where t.tgrelid = ('public.' || pol.tablename)::regclass
                        and t.tgname like 'zz_registro_admin%' and not t.tgisinternal), '[]'::json) as triggers
      from pol order by 1, 2`)
  const clasificar = (r) => {
    const que = r.triggers.filter(tg => (tg.tipo & BIT[r.op]) > 0)
    if (que.some(tg => !filtraColumnas(tg, r.op))) return 'completa'
    if (que.length) return 'parcial'
    return 'ninguna'
  }
  const exenta = (r) => EXENTAS[r.tablename]?.[r.op] || EXENTAS[r.tablename]?.['*']
  const huecos = []
  let completas = 0, parcialesOk = 0, exentas = 0
  for (const r of ops) {
    const c = clasificar(r)
    if (c === 'completa') completas++
    else if (exenta(r)) exentas++
    else if (c === 'parcial' && PARCIALES[r.tablename]?.[r.op]) parcialesOk++
    else huecos.push(`${r.tablename}.${r.op}${c === 'parcial' ? ' (sólo un trigger que filtra columnas, sin justificar)' : ''}`)
  }
  // Autochequeo del clasificador: tiene que distinguir un trigger total de uno por columnas.
  const base = { attr: '', ignorar: '', old_vars: 0, new_attnums: [], persona_attnum: null }
  ok(!filtraColumnas(base)
     && !filtraColumnas({ ...base, new_attnums: [2], persona_attnum: 2 })          // guarda de actor sobre la columna de la persona
     && filtraColumnas({ ...base, old_vars: 2, new_attnums: [5] })                  // new.a IS DISTINCT FROM old.a
     && filtraColumnas({ ...base, new_attnums: [7], persona_attnum: 2 })            // new.is_verified IS TRUE
     && filtraColumnas({ ...base, new_attnums: [2] })                               // una columna NEW sin persona declarada
     && filtraColumnas({ ...base, attr: '5' })                                      // UPDATE OF
     && filtraColumnas({ ...base, ignorar: 'status' }),                             // columnas excluidas
    'el clasificador (catálogo) distingue un trigger sobre toda la fila de uno que filtra columnas, y no confunde una guarda de actor con un filtro')
  const tablas = [...new Set(ops.map(r => r.tablename))]
  ok(huecos.length === 0,
    huecos.length
      ? `operaciones que el admin puede hacer SIN registro completo: ${huecos.join(', ')} — agregales un trigger sobre toda la fila, o justificá la excepción`
      : `cobertura: ${ops.length} operaciones en ${tablas.length} tablas; ${completas} con trigger sobre toda la fila, ${parcialesOk} parciales justificadas, ${exentas} exentas explicadas`)
  const sobran = [
    ...Object.entries(EXENTAS).flatMap(([t, m]) => Object.keys(m).filter(op => !ops.some(r => r.tablename === t && (op === '*' || r.op === op))).map(op => `${t}.${op}`)),
    ...Object.entries(PARCIALES).flatMap(([t, m]) => Object.keys(m).filter(op => !ops.some(r => r.tablename === t && r.op === op && clasificar(r) === 'parcial')).map(op => `${t}.${op} (parcial)`)),
  ]
  if (sobran.length) console.log(`· (aviso) excepciones que ya no hacen falta: ${sobran.join(', ')}`)

  // ── 13. Contraseña propia (migración 219): tengo_contrasena + asiento cambio_de_contrasena ──
  {
    const rpc = (nombre, body, token) => rest(`rpc/${nombre}`, { method: 'POST', body: body ?? {}, token })
    // La cuenta demo del super admin tiene contraseña; una creada sin contraseña (magic link) no.
    const t1 = await rpc('tengo_contrasena', {}, sup.token)
    ok(t1.ok && t1.data === true, 'tengo_contrasena: una cuenta con contraseña (superadmin@) contesta true')
    const mail13 = `registro.admin.pw.${ts}@staging.healthier.app`
    const { data: nuevo13, error: e13 } = await admin.auth.admin.createUser({ email: mail13, email_confirm: true })
    if (e13) throw e13
    try {
      const ses13 = await sesionDe(mail13)
      const t2 = await rpc('tengo_contrasena', {}, ses13.token)
      ok(t2.ok && t2.data === false, 'tengo_contrasena: una cuenta que entró por magic link (sin contraseña) contesta false')
      // GoTrue le guarda un hash aleatorio a toda cuenta creada sin contraseña: si la RPC mirara sólo
      // `encrypted_password`, esta cuenta (como marcopolo@) quedaría "con contraseña" y sin poder ponerla.
      const [{ largo }] = await sql(`select length(encrypted_password) largo from auth.users where id = '${nuevo13.user.id}'`)
      ok(largo > 0, `la cuenta sin contraseña tiene igual un hash aleatorio (${largo} caracteres): por eso no alcanza con mirar el hash`)
      const clave13 = `Prueba-${ts}-Aa1`
      await admin.auth.admin.updateUserById(nuevo13.user.id, { password: clave13 })
      const t3a = await rpc('tengo_contrasena', {}, ses13.token)
      ok(t3a.ok && t3a.data === false, 'tengo_contrasena: con la contraseña puesta pero sin haber entrado nunca con ella, todavía false (límite documentado)')
      const conClave = createClient(URL, ANON, { auth: { persistSession: false } })
      const { data: sClave, error: eClave } = await conClave.auth.signInWithPassword({ email: mail13, password: clave13 })
      ok(!eClave, `entrar con la contraseña funciona (${eClave?.message ?? 'ok'})`)
      const t3 = await rpc('tengo_contrasena', {}, sClave?.session?.access_token)
      ok(t3.ok && t3.data === true, 'tengo_contrasena: contesta true en cuanto la persona entró con su contraseña')
      // Cada cuenta ve sólo lo suyo: la función no recibe ningún id.
      const t4 = await rpc('tengo_contrasena', { p_id: nuevo13.user.id }, sup.token)
      ok(!(t4.ok && t4.data === false), 'tengo_contrasena no acepta el id de otra cuenta (no se puede consultar a un tercero)')
      // Sin sesión: nada.
      const t5 = await rest('rpc/tengo_contrasena', { method: 'POST', body: {}, token: ANON })
      ok(!t5.ok, `tengo_contrasena: anónimo rechazado (HTTP ${t5.status})`)
      // Quien no es admin no puede asentar nada.
      const noAdmin = await rpc('registrar_cambio_de_contrasena', { p_primera_vez: true }, ses13.token)
      ok(!noAdmin.ok, `registrar_cambio_de_contrasena: una cuenta sin rol de administración es rechazada (HTTP ${noAdmin.status})`)
      const sinSesion = await rest('rpc/registrar_cambio_de_contrasena', { method: 'POST', body: {}, token: ANON })
      ok(!sinSesion.ok, `registrar_cambio_de_contrasena: anónimo rechazado (HTTP ${sinSesion.status})`)
      const servidor = await rest('rpc/registrar_cambio_de_contrasena', { method: 'POST', body: {}, service: true })
      ok(!servidor.ok, `registrar_cambio_de_contrasena: el servidor sin persona detrás no puede asentar (HTTP ${servidor.status})`)
    } finally {
      await admin.auth.admin.deleteUser(nuevo13.user.id).catch(e => console.error('limpieza 13:', e.message))
    }
    // El super admin sí: asiento con la persona como actor y sin el valor de ninguna contraseña.
    const antes13 = (await asientos(`action = 'cambio_de_contrasena'`)).length
    const a1 = await rpc('registrar_cambio_de_contrasena', { p_primera_vez: false }, sup.token)
    const a2 = await rpc('registrar_cambio_de_contrasena', { p_primera_vez: true }, sup.token)
    ok(a1.ok && a2.ok, `registrar_cambio_de_contrasena: el super admin asienta su cambio (HTTP ${a1.status}/${a2.status})`)
    const filas13 = await asientos(`action = 'cambio_de_contrasena'`)
    const nuevas = filas13.slice(antes13)
    ok(nuevas.length === 2
       && nuevas.every(f => f.actor_id === sup.id && f.via === 'usuario' && f.actor_role === 'super_admin' && f.target_user_id === sup.id),
      'el asiento queda con el super admin como actor (via=usuario) sobre su propia cuenta')
    ok(nuevas.every(f => !/pass|contrase[ñn]a\s*[:=]|hash/i.test(JSON.stringify({ ...f.detail, entity_id: undefined })) || /^(Puso|Cambió) su contraseña/.test(f.detail?.nota ?? '')),
      'el asiento no lleva ningún valor de contraseña (sólo la nota "Puso/Cambió su contraseña")')
    ok(nuevas.map(f => f.detail?.nota).join('|') === 'Cambió su contraseña|Puso su contraseña por primera vez',
      'la nota distingue el cambio de la primera vez')
  }
} catch (e) {
  fallas++
  console.error('❌ el recorrido se cortó:', e.message)
} finally {
  for (const paso of restaurar.reverse()) await paso().catch(e => console.error('restaurar:', e.message))
  if (userId) {
    await sql(`delete from public.impersonation_log where target_user_id = '${userId}';
               delete from public.email_log where usuario_id = '${userId}';
               delete from public.bajas_de_usuarios where user_id = '${userId}';
               delete from public.profiles where id = '${userId}';`).catch(e => console.error('limpieza:', e.message))
    await admin.auth.admin.deleteUser(userId).catch(e => console.error('limpieza auth:', e.message))
    if (userIdB) {
      await sql(`delete from public.email_log where usuario_id = '${userIdB}'; delete from public.profiles where id = '${userIdB}';`).catch(e => console.error('limpieza B:', e.message))
      await admin.auth.admin.deleteUser(userIdB).catch(e => console.error('limpieza auth B:', e.message))
    }
    const [del] = await sql(`select count(*)::int n from public.admin_action_log where action = 'eliminacion_de_perfil' and entity_id = '${userId}'`).catch(() => [{ n: -1 }])
    ok(del.n === 1, 'borrar un perfil queda asentado (eliminacion_de_perfil)')
    console.log('· limpiado')
  }
}

if (noProbado.length) console.log(`\n⚠️  ${noProbado.length} bloque(s) NO PROBADO(S): ${noProbado.join(' | ')}`)
console.log(fallas ? `\n❌ ${fallas} falla(s)` : noProbado.length ? '\n⚠️  sin fallas, pero con partes NO PROBADAS (código de salida 3)' : '\n✅ registro de acciones admin OK')
// 0 = todo probado y verde · 1 = hay fallas · 3 = sin fallas pero faltaron cuentas/datos demo (no es verde)
process.exit(fallas ? 1 : noProbado.length ? 3 : 0)
