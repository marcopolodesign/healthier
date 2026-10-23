#!/usr/bin/env node
/**
 * Nadie se da a sí mismo un rol alto, la bonificación ni la verificación
 * (migración 217).
 *
 *   node scripts/verificar-alta-rol.mjs                 # staging (base + API)
 *   node scripts/verificar-alta-rol.mjs staging --sin-api
 *   node scripts/verificar-alta-rol.mjs produccion      # sólo la parte de base
 *
 * **Por qué existe.** El 2026-10-23 se encontró que un `signUp` con
 * `data: { role: 'super_admin' }` por la API pública dejaba un super admin, que
 * un usuario sin perfil se lo creaba con cualquier rol, que cualquier paciente
 * se ponía `payment_exempt` (consultas y farmacia gratis) y que un profesional
 * se insertaba el legajo ya verificado. Además la app manda
 * `role: 'paciente'` en el alta y eso respondía 500.
 *
 * Dos partes:
 *
 *   1. **Base** (corre también contra producción): todo dentro de un bloque que
 *      termina SIEMPRE con un error a propósito, así que nada se guarda — ni los
 *      usuarios de auth que crea ni los mails que encolaría. Cada paso corre con
 *      el rol de quien lo haría (`authenticated` con su JWT simulado, el super
 *      admin, el service role).
 *   2. **API** (sólo staging, se saltea con `--sin-api`): altas de verdad por
 *      GoTrue con la anon key, como lo haría cualquiera, y PATCH con el token
 *      del propio usuario. Borra todo lo que crea al terminar.
 *
 * Falla (exit 1) si cualquiera de esos caminos vuelve a dejar pasar algo, o si
 * los caminos legítimos (alta de paciente/profesional, cuentas creadas por
 * Admin API con `app_metadata.role`, `promote_user_to_admin`, el service role,
 * un profesional verificado que guarda su configuración) dejan de andar.
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const env = Object.fromEntries(
  readFileSync(join(homedir(), 'Local', '.env'), 'utf8')
    .split('\n').map(l => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2].replace(/^["']|["']$/g, '')])
)

const ENTORNOS = {
  produccion: { ref: 'aixjejdoofervrkggbkd' },
  staging: {
    ref: 'itjhrvlzuqvyhqtffumc',
    url: env.HEALTHIER_STAGING_SUPABASE_URL,
    anon: env.HEALTHIER_STAGING_SUPABASE_ANON_KEY,
    service: env.HEALTHIER_STAGING_SUPABASE_SERVICE_ROLE_KEY,
  },
}

const args = process.argv.slice(2)
const nombre = args.find(a => !a.startsWith('--')) ?? 'staging'
const entorno = ENTORNOS[nombre]
if (!entorno) { console.error(`entorno inválido: ${nombre} (staging|produccion)`); process.exit(2) }
const conApi = nombre === 'staging' && !args.includes('--sin-api')

let fallas = 0
const ok = (msg) => console.log(`   ✓ ${msg}`)
const mal = (msg) => { fallas++; console.log(`   ✗ ${msg}`) }
const esperar = (cond, si, no) => (cond ? ok(si) : mal(no))

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${entorno.ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const text = await r.text()
  let data
  try { data = JSON.parse(text) } catch { data = text }
  return { ok: r.ok, data, text }
}

// ── 1 · Base ────────────────────────────────────────────────────────────────
const SQL_CATALOGO = `
  select
    (select array_agg(t) from unnest(array['blindar_perfil_desde_el_cliente','legajo_nace_sin_verificar',
       'impedir_autoascenso_de_rol','crear_perfil_al_registrarse','profiles_marca_de_prueba']) t
      where not exists (select 1 from pg_trigger where tgname = t and not tgisinternal)) as faltan
`

const SQL_REGLA = `
do $$
declare
  r jsonb := '{}'::jsonb;
  v_meta_app constant jsonb := '{"provider":"email","providers":["email"]}';
  v_sa uuid := gen_random_uuid();       -- signUp con role super_admin
  v_app uuid := gen_random_uuid();      -- signUp de la app: role 'paciente'
  v_pro uuid := gen_random_uuid();      -- signUp de profesional
  v_farm uuid := gen_random_uuid();     -- Admin API con app_metadata.role
  v_sinrol uuid := gen_random_uuid();   -- Google/Apple: sin rol
  v_super uuid;
  v_txt text; v_bool boolean; v_uuid uuid;
begin
  select id into v_super from profiles where role = 'super_admin' and deleted_at is null order by created_at limit 1;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    ('00000000-0000-0000-0000-000000000000', v_sa, 'authenticated', 'authenticated', 'sa-' || v_sa || '@alta-rol.test', '', now(),
      v_meta_app, '{"role":"super_admin","full_name":"Prueba SA"}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_app, 'authenticated', 'authenticated', 'app-' || v_app || '@alta-rol.test', '', now(),
      v_meta_app, '{"role":"paciente","nombre":"Prueba","apellido":"App"}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_pro, 'authenticated', 'authenticated', 'pro-' || v_pro || '@alta-rol.test', '', now(),
      v_meta_app, '{"role":"professional","first_name":"Prueba","last_name":"Pro"}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_farm, 'authenticated', 'authenticated', 'farm-' || v_farm || '@alta-rol.test', '', now(),
      v_meta_app || '{"role":"pharmacy_admin"}', '{"role":"super_admin"}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_sinrol, 'authenticated', 'authenticated', 'sinrol-' || v_sinrol || '@alta-rol.test', '', now(),
      '{"provider":"google","providers":["google"]}', '{"full_name":"Prueba Google"}', now(), now());

  -- 1 · Qué rol dejó el alta
  r := r || jsonb_build_object('alta', jsonb_build_object(
    'super_admin_pedido', (select role from profiles where id = v_sa),
    'paciente_app',       (select role from profiles where id = v_app),
    'profesional',        (select role from profiles where id = v_pro),
    'admin_api_farmacia', (select role from profiles where id = v_farm),
    'sin_rol_crea_perfil', exists (select 1 from profiles where id = v_sinrol)));

  -- 2 · El de Google se crea el perfil a mano con rol alto
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_sinrol, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    insert into profiles (id, email, role) values (v_sinrol, 'sinrol-' || v_sinrol || '@alta-rol.test', 'super_admin');
    execute 'reset role';
    r := r || '{"insert_rol_alto":"SE CREÓ"}';
  exception when insufficient_privilege then
    r := r || '{"insert_rol_alto":"bloqueado"}';
  when others then
    r := r || jsonb_build_object('insert_rol_alto', 'otro error: ' || sqlerrm);
  end;

  -- 3 · …o con rol paciente pero exento y colgado de otro titular
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_sinrol, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    insert into profiles (id, email, role, payment_exempt, titular_id)
    values (v_sinrol, 'sinrol-' || v_sinrol || '@alta-rol.test', 'patient', true, v_app);
    execute 'reset role';
    select payment_exempt, titular_id into v_bool, v_uuid from profiles where id = v_sinrol;
    r := r || jsonb_build_object('insert_paciente', jsonb_build_object('creado', true, 'exento', v_bool, 'con_titular', v_uuid is not null));
  exception when others then
    r := r || jsonb_build_object('insert_paciente', jsonb_build_object('creado', false, 'error', sqlerrm));
  end;

  -- 4 · El paciente se toca a sí mismo
  perform set_config('request.jwt.claims', json_build_object('sub', v_sa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update profiles set payment_exempt = true, titular_id = v_app where id = v_sa;
  -- el upsert de register(): INSERT ... ON CONFLICT DO UPDATE sobre la fila que creó el trigger
  insert into profiles (id, email, role, payment_exempt)
  values (v_sa, 'sa-' || v_sa || '@alta-rol.test', 'patient', true)
  on conflict (id) do update set payment_exempt = excluded.payment_exempt, role = excluded.role;
  execute 'reset role';
  select payment_exempt, titular_id into v_bool, v_uuid from profiles where id = v_sa;
  r := r || jsonb_build_object('update_propio', jsonb_build_object('exento', v_bool, 'con_titular', v_uuid is not null));

  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_sa, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    update profiles set role = 'super_admin' where id = v_sa;
    execute 'reset role';
    r := r || '{"update_rol":"SE CAMBIÓ"}';
  exception when check_violation then
    r := r || '{"update_rol":"bloqueado"}';
  when others then
    r := r || jsonb_build_object('update_rol', 'otro error: ' || sqlerrm);
  end;

  -- 5 · El profesional y su legajo
  perform set_config('request.jwt.claims', json_build_object('sub', v_pro, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into professional_profiles (user_id, specialty, is_verified, is_active, average_rating, total_reviews, mp_connected)
  values (v_pro, 'Clínica médica', true, true, 5, 999, true);
  execute 'reset role';
  r := r || jsonb_build_object('legajo_nuevo', (select jsonb_build_object('verificado', is_verified, 'activo', is_active,
          'rating', average_rating, 'reviews', total_reviews, 'mp', mp_connected) from professional_profiles where user_id = v_pro));

  -- Healthier lo verifica (service role) y él guarda Configuración con el
  -- registro entero (upsert): tiene que seguir verificado.
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  update professional_profiles set is_verified = true, is_active = true, verification_source = 'manual', verified_at = now()
   where user_id = v_pro;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pro, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into professional_profiles (user_id, specialty, bio, is_verified, is_active)
  values (v_pro, 'Clínica médica', 'Guardé mi configuración', true, true)
  on conflict (user_id) do update set bio = excluded.bio, is_verified = excluded.is_verified, is_active = excluded.is_active;
  execute 'reset role';
  r := r || jsonb_build_object('verificado_guarda_config', (select jsonb_build_object('verificado', is_verified, 'bio_guardada', bio = 'Guardé mi configuración')
          from professional_profiles where user_id = v_pro));

  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_pro, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    delete from professional_profiles where user_id = v_pro;
    execute 'reset role';
    r := r || jsonb_build_object('borrar_legajo', case when exists (select 1 from professional_profiles where user_id = v_pro) then 'no borró nada' else 'SE BORRÓ' end);
  exception when insufficient_privilege then
    r := r || '{"borrar_legajo":"bloqueado"}';
  when others then
    r := r || jsonb_build_object('borrar_legajo', 'otro error: ' || sqlerrm);
  end;

  -- 6 · Los caminos de Healthier siguen andando
  if v_super is not null then
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_super, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      perform promote_user_to_admin('sa-' || v_sa || '@alta-rol.test', 'pharmacy_admin');
      update profiles set payment_exempt = true where id = v_app;
      execute 'reset role';
      r := r || jsonb_build_object('super_admin', jsonb_build_object(
        'promueve', (select role from profiles where id = v_sa),
        'bonifica', (select payment_exempt from profiles where id = v_app)));
    exception when others then
      r := r || jsonb_build_object('super_admin', jsonb_build_object('error', sqlerrm));
    end;
  else
    r := r || '{"super_admin":"no hay super admin en esta base"}';
  end if;

  begin
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    execute 'set local role service_role';
    update profiles set payment_exempt = false, role = 'emergency_operator' where id = v_app;
    execute 'reset role';
    r := r || jsonb_build_object('service_role', (select jsonb_build_object('rol', role, 'exento', payment_exempt) from profiles where id = v_app));
  exception when others then
    r := r || jsonb_build_object('service_role', jsonb_build_object('error', sqlerrm));
  end;

  raise exception 'RESULTADO %', r::text;
end $$;
`

async function parteBase() {
  console.log(`\n🗄  Base (${nombre}) — todo se deshace al final`)
  const cat = await sql(SQL_CATALOGO)
  if (!cat.ok) { mal(`no se pudo leer el catálogo: ${cat.text}`); return }
  const faltan = cat.data?.[0]?.faltan
  esperar(!faltan, 'triggers de la 217 en su lugar', `faltan triggers: ${faltan}`)

  const res = await sql(SQL_REGLA)
  const msg = typeof res.data === 'object' ? String(res.data?.message ?? '') : res.text
  const m = msg.match(/RESULTADO (\{.*?\})\s*\n?CONTEXT/s)
  if (!m) { mal(`el bloque no devolvió resultado: ${msg.slice(0, 400)}`); return }
  const r = JSON.parse(m[1])

  esperar(r.alta?.super_admin_pedido === 'patient', 'signUp con role super_admin → paciente', `signUp con role super_admin → ${r.alta?.super_admin_pedido}`)
  esperar(r.alta?.paciente_app === 'patient', "alta de la app (role 'paciente') → paciente", `alta de la app → ${r.alta?.paciente_app}`)
  esperar(r.alta?.profesional === 'professional', 'alta de profesional → profesional', `alta de profesional → ${r.alta?.profesional}`)
  esperar(r.alta?.admin_api_farmacia === 'pharmacy_admin', 'Admin API con app_metadata.role → farmacia', `Admin API con app_metadata.role → ${r.alta?.admin_api_farmacia}`)
  esperar(r.alta?.sin_rol_crea_perfil === false, 'Google/Apple sin rol: no crea perfil (lo elige después)', 'Google/Apple sin rol creó perfil')
  esperar(r.insert_rol_alto === 'bloqueado', 'crearse el perfil con rol alto: bloqueado', `crearse el perfil con rol alto: ${r.insert_rol_alto}`)
  esperar(r.insert_paciente?.creado && r.insert_paciente.exento === false && r.insert_paciente.con_titular === false,
    'crearse el perfil de paciente anda, sin bonificación ni titular', `crearse el perfil de paciente: ${JSON.stringify(r.insert_paciente)}`)
  esperar(r.update_propio?.exento === false && r.update_propio?.con_titular === false,
    'paciente se pone payment_exempt / titular (PATCH y upsert): no cambia', `paciente se toca: ${JSON.stringify(r.update_propio)}`)
  esperar(r.update_rol === 'bloqueado', 'paciente se cambia el rol: bloqueado', `paciente se cambia el rol: ${r.update_rol}`)
  const l = r.legajo_nuevo ?? {}
  esperar(l.verificado === false && l.activo === false && Number(l.rating) === 0 && l.reviews === 0 && l.mp === false,
    'legajo nuevo insertado "verificado": nace sin verificar, sin rating ni MP', `legajo nuevo: ${JSON.stringify(l)}`)
  esperar(r.verificado_guarda_config?.verificado === true && r.verificado_guarda_config?.bio_guardada === true,
    'profesional verificado guarda su configuración (upsert): sigue verificado', `verificado que guarda: ${JSON.stringify(r.verificado_guarda_config)}`)
  esperar(r.borrar_legajo === 'bloqueado', 'borrar el propio legajo: bloqueado', `borrar el propio legajo: ${r.borrar_legajo}`)
  if (typeof r.super_admin === 'string') ok(`(${r.super_admin})`)
  else esperar(r.super_admin?.promueve === 'pharmacy_admin' && r.super_admin?.bonifica === true,
    'super admin promueve y bonifica', `super admin: ${JSON.stringify(r.super_admin)}`)
  esperar(r.service_role?.rol === 'emergency_operator' && r.service_role?.exento === false,
    'service role cambia rol y bonificación', `service role: ${JSON.stringify(r.service_role)}`)
}

// ── 2 · API (staging) ───────────────────────────────────────────────────────
async function parteApi() {
  console.log('\n🌐 API pública de staging — altas reales, se borran al final')
  const { url, anon, service } = entorno
  const sello = Date.now()
  const creados = []
  const signUp = async (email, data) => {
    const r = await fetch(`${url}/auth/v1/signup`, {
      method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: `Alta-${sello}!`, data }),
    })
    const j = await r.json()
    const id = j.user?.id ?? j.id
    if (id) creados.push(id)
    return { status: r.status, id, token: j.access_token, j }
  }
  const rest = async (path, { method = 'GET', token, body } = {}) => {
    const r = await fetch(`${url}/rest/v1/${path}`, {
      method,
      headers: { apikey: anon, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: body ? JSON.stringify(body) : undefined,
    })
    return { status: r.status, text: await r.text() }
  }
  const perfil = async (id) => {
    const r = await fetch(`${url}/rest/v1/profiles?id=eq.${id}&select=role,payment_exempt`, { headers: { apikey: service, Authorization: `Bearer ${service}` } })
    return (await r.json())[0] ?? null
  }

  try {
    const sa = await signUp(`api-sa-${sello}@alta-rol.test`, { role: 'super_admin', full_name: 'API SA' })
    const pSa = sa.id ? await perfil(sa.id) : null
    esperar(pSa?.role === 'patient', 'signUp con role super_admin → paciente', `signUp con role super_admin → ${JSON.stringify(pSa ?? sa.j)}`)

    const app = await signUp(`api-app-${sello}@alta-rol.test`, { role: 'paciente', nombre: 'API', apellido: 'App' })
    esperar(app.status === 200 && (await perfil(app.id))?.role === 'patient', "alta de la app (role 'paciente') → 200 y paciente", `alta de la app → ${app.status} ${JSON.stringify(app.j).slice(0, 200)}`)

    const pro = await signUp(`api-pro-${sello}@alta-rol.test`, { role: 'professional', first_name: 'API', last_name: 'Pro' })
    esperar((await perfil(pro.id))?.role === 'professional', 'alta de profesional → profesional', 'alta de profesional no quedó profesional')

    if (sa.token) {
      const a = await rest(`profiles?id=eq.${sa.id}`, { method: 'PATCH', token: sa.token, body: { payment_exempt: true } })
      const p = await perfil(sa.id)
      esperar(p?.payment_exempt === false, 'PATCH payment_exempt con el token propio: no cambia', `PATCH payment_exempt → ${a.status} ${JSON.stringify(p)}`)
      const b = await rest(`profiles?id=eq.${sa.id}`, { method: 'PATCH', token: sa.token, body: { role: 'super_admin' } })
      esperar(b.status >= 400 && (await perfil(sa.id))?.role === 'patient', 'PATCH role con el token propio: rechazado', `PATCH role → ${b.status}`)
      // updateUser({ data: { role } }) sólo toca el user_metadata: el perfil no se entera.
      const u = await fetch(`${url}/auth/v1/user`, {
        method: 'PUT', headers: { apikey: anon, Authorization: `Bearer ${sa.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { role: 'super_admin' } }),
      })
      esperar(u.ok && (await perfil(sa.id))?.role === 'patient', 'updateUser({data:{role}}): el perfil sigue paciente', `updateUser → ${u.status}`)
    } else {
      mal('el signUp no devolvió sesión (¿se prendió la confirmación de mail en staging?)')
    }

    const sinRol = await signUp(`api-sinrol-${sello}@alta-rol.test`, { full_name: 'API sin rol' })
    if (sinRol.token) {
      const c = await rest('profiles', { method: 'POST', token: sinRol.token, body: { id: sinRol.id, email: `api-sinrol-${sello}@alta-rol.test`, role: 'super_admin' } })
      esperar(c.status === 403 && !(await perfil(sinRol.id)), 'sin rol + POST /profiles con super_admin: rechazado', `sin rol + POST /profiles → ${c.status} ${c.text}`)
    }

    if (pro.token) {
      const d = await rest('professional_profiles', { method: 'POST', token: pro.token, body: { user_id: pro.id, specialty: 'Clínica médica', is_verified: true, is_active: true } })
      const r = await fetch(`${url}/rest/v1/professional_profiles?user_id=eq.${pro.id}&select=is_verified,is_active`, { headers: { apikey: service, Authorization: `Bearer ${service}` } })
      const leg = (await r.json())[0]
      esperar(d.status === 201 && leg?.is_verified === false && leg?.is_active === false, 'legajo insertado "verificado": queda sin verificar', `legajo → ${d.status} ${JSON.stringify(leg)}`)
      const e = await rest(`professional_profiles?user_id=eq.${pro.id}`, { method: 'DELETE', token: pro.token })
      esperar(e.status === 403, 'DELETE del propio legajo: rechazado', `DELETE legajo → ${e.status}`)
    }
  } finally {
    let borrados = 0
    for (const id of creados) {
      const r = await fetch(`${url}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: { apikey: service, Authorization: `Bearer ${service}` } })
      if (r.ok) borrados++
      else mal(`no se pudo borrar el usuario de prueba ${id}: ${r.status}`)
    }
    console.log(`   🧹 ${borrados}/${creados.length} usuarios de prueba borrados`)
  }
}

await parteBase()
if (conApi) await parteApi()
console.log(fallas ? `\n❌ ${fallas} control(es) en rojo` : '\n✅ Todo en verde')
process.exit(fallas ? 1 : 0)
