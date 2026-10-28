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
 *   9. cobertura: toda tabla que el admin (o el admin de un tenant: emergencias,
 *      farmacia) puede escribir tiene su trigger o una excepción explicada acá abajo
 *   10. el id del asiento de configuración es la clave primaria real (rnos, droga…)
 *   11. el admin de emergencias queda asentado en las tablas de su tenant
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
  if (/TENANT sin-datos/.test(tenant)) console.log('· (aviso) no hay un emergency_admin con personal asignado en staging: se saltea el chequeo del tenant')
  else ok(/TENANT 1/.test(tenant), `un emergency_admin que cambia su personal queda asentado (${tenant.match(/TENANT \d+/)?.[0] ?? tenant.slice(0, 160)})`)

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

  // 9 ─ Cobertura: toda tabla que un admin puede escribir tiene su trigger
  const EXENTAS = {
    clinical_access_log: 'el DELETE lo frena el trigger de la 033 (retención de la HC); es ya un registro',
    professional_verification_log: 'es el registro de decisiones; la decisión queda en professional_profiles (trigger)',
    ambulance_locations: 'telemetría GPS de las ambulancias, no una acción de administración',
    pharmacy_products: 'catálogo operativo que edita la propia farmacia (importaciones masivas)',
    emergencies: 'operación diaria del despacho (asignaciones); sólo se asientan los borrados del super admin',
    medication_orders: 'operación diaria de la farmacia (pedidos); sólo se asientan los borrados del super admin',
  }
  const tablas = await sql(`
    select p.tablename,
           exists (select 1 from pg_trigger t where t.tgrelid = ('public.' || p.tablename)::regclass
                    and t.tgname like 'zz_registro_admin%' and not t.tgisinternal) as cubierta
      from pg_policies p
     where p.schemaname = 'public' and p.cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
       and ((coalesce(p.qual, '') || coalesce(p.with_check, '')) ~ 'super_admin|''admin''|emergency_admin|pharmacy_admin')
     group by p.tablename order by 1`)
  const sinCubrir = tablas.filter(t => !t.cubierta && !EXENTAS[t.tablename]).map(t => t.tablename)
  ok(sinCubrir.length === 0,
    sinCubrir.length ? `tablas que el admin escribe SIN registro: ${sinCubrir.join(', ')} — agregales el trigger o una excepción explicada` : `cobertura: ${tablas.length} tablas, ${tablas.filter(t => t.cubierta).length} con trigger, ${Object.keys(EXENTAS).length} exentas explicadas`)
  const sobran = Object.keys(EXENTAS).filter(k => !tablas.some(t => t.tablename === k))
  if (sobran.length) console.log(`· (aviso) excepciones que ya no hacen falta: ${sobran.join(', ')}`)
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

console.log(fallas ? `\n❌ ${fallas} falla(s)` : '\n✅ registro de acciones admin OK')
process.exit(fallas ? 1 : 0)
