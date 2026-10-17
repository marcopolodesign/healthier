#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Control de la revisión pre-prod de verticales (migraciones 202/203,
// 2026-10-17) — SÓLO STAGING. Falla (exit 1) si vuelve alguno de estos:
//
//  1. `crear_vertical` deja crear una vertical con el slug de una especialidad
//     de OTRA vertical ("Cardiología" se llevaba a los cardiólogos de Clínica),
//     o deja la vertical a medias cuando falla.
//  2. `mover_vertical` deja órdenes repetidos o con huecos (tiene que quedar
//     1..N) o mueve la fila equivocada.
//  3. Una derivación abierta a una especialidad que cambió de vertical deja de
//     ser reservable (trigger `validar_consulta_derivada`, 203) — y uno de otra
//     especialidad sigue sin poder tomarla.
//  4. La historia clínica de un paciente con una derivación se cae al abrirla
//     (ReferenceError en `DerivacionCard`, revisión ronda 2) — en el front de
//     staging, con Chromium headless y la sesión de clinica@staging.
//
//   node scripts/verificar-verticales.mjs            # todo
//   node scripts/verificar-verticales.mjs --sin-front
//
// Lo de la base corre dentro de bloques que terminan en `raise exception`: se
// deshacen enteros (nada queda escrito, ningún aviso sale).
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs'

const env = {}
for (const l of readFileSync('/Users/mataldao/Local/.env', 'utf8').split('\n')) {
  const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l)
  if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
}
const REF = env.HEALTHIER_STAGING_SUPABASE_REF
const URL_SB = env.HEALTHIER_STAGING_SUPABASE_URL
const ANON = env.HEALTHIER_STAGING_SUPABASE_ANON_KEY
const SERVICE = env.HEALTHIER_STAGING_SUPABASE_SERVICE_ROLE_KEY
const WEB = 'https://staging.healthier.com.ar'

let fallas = 0
const check = (ok, msg) => { console.log(`${ok ? '🟢' : '🔴'} ${msg}`); if (!ok) fallas++ }

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const txt = await r.text()
  return { ok: r.ok, txt }
}
// Un bloque que termina en `raise exception 'RESULTADO …'` se deshace entero;
// el resultado vuelve en el mensaje del error.
async function bloque(cuerpo) {
  const { txt } = await sql(`do $$ ${cuerpo} $$;`)
  let msg = txt
  try { msg = JSON.parse(txt).message ?? txt } catch { /* texto plano */ }
  const m = /RESULTADO ([\s\S]*?)(\nCONTEXT|$)/.exec(msg)
  // Los booleanos de Postgres llegan como t/f.
  return m ? m[1].trim().replace(/\bt\b/g, 'true').replace(/\bf\b/g, 'false') : `SIN RESULTADO: ${msg.slice(0, 300)}`
}

const SA = (await (await fetch(`${URL_SB}/rest/v1/profiles?select=id&email=eq.superadmin@healthier.app`, {
  headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
})).json())[0]?.id
if (!SA) { console.error('no encontré superadmin@healthier.app en staging'); process.exit(1) }
// Para que get_my_role() vea al super admin dentro del bloque.
const comoSuperAdmin = `perform set_config('request.jwt.claims', json_build_object('sub', '${SA}', 'role', 'authenticated')::text, true);`

// ── 1. crear_vertical ───────────────────────────────────────────────────────
{
  const r = await bloque(`
    declare msg text; quedo int; begin
      ${comoSuperAdmin}
      begin
        perform public.crear_vertical('cardiologia', 'Cardiología', '#B2633F', 'heartbeat', null, null, false, 50);
        msg := 'CREO';
      exception when others then msg := sqlerrm; end;
      select count(*) into quedo from public.vertical_settings where id = 'cardiologia';
      raise exception 'RESULTADO %|%|%', msg, quedo,
        (select vertical_id from public.specialties where slug = 'cardiologia');
    end`)
  const [msg, quedo, vertCardio] = r.split('|')
  check(msg !== 'CREO' && /ya es parte de la vertical/.test(msg), `crear "Cardiología" se rechaza (${msg.slice(0, 70)}…)`)
  check(quedo === '0' && vertCardio === 'clinica', 'no queda la vertical y Cardiología sigue en Clínica')

  const r2 = await bloque(`
    declare v public.vertical_settings; n int; begin
      ${comoSuperAdmin}
      v := public.crear_vertical('control_rpc', 'Control RPC', '#3F8A7C', 'pulse', null, 1500, true, 99);
      select count(*) into n from public.specialties where slug = 'control_rpc' and vertical_id = 'control_rpc';
      raise exception 'RESULTADO %|%', v.enabled, n;
    end`)
  check(r2 === 'true|1', `una vertical nueva con precio se crea prendida y con su especialidad (${r2})`)

  const r3 = await bloque(`
    declare msg text; begin
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
      begin perform public.crear_vertical('x_anon', 'X', null, null, null, null, false, 1); msg := 'CREO';
      exception when others then msg := sqlerrm; end;
      raise exception 'RESULTADO %', msg;
    end`)
  check(r3 !== 'CREO', 'sin super admin no se crea')
}

// ── 2. mover_vertical ───────────────────────────────────────────────────────
{
  const r = await bloque(`
    declare antes text[]; despues text[]; ok_seq boolean; begin
      ${comoSuperAdmin}
      -- empate a propósito: dos verticales con el mismo orden
      update public.vertical_settings set sort_order = 3 where id in ('nutricion', 'pediatria');
      select array_agg(id order by sort_order, id collate "C") into antes from public.vertical_settings where tipo = 'vertical';
      perform public.mover_vertical(antes[3], -1);
      select array_agg(id order by sort_order, id collate "C") into despues from public.vertical_settings where tipo = 'vertical';
      select bool_and(sort_order = n) into ok_seq from (
        select sort_order, row_number() over (order by sort_order, id collate "C") as n
          from public.vertical_settings where tipo = 'vertical') t;
      raise exception 'RESULTADO %|%|%|%', ok_seq, antes[3] = despues[2], antes[2] = despues[3], array_length(antes, 1) = array_length(despues, 1);
    end`)
  check(r === 'true|true|true|true', `mover_vertical con empate: mueve la fila pedida y deja 1..N (${r})`)
}

// ── 3. derivación abierta después de mover su especialidad ──────────────────
{
  const base = (prof, esp) => `
    declare d uuid; msg text; begin
      perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
      update public.professional_profiles set specialty = '${esp}' where user_id = '${prof}';
      insert into public.derivaciones (patient_id, derivado_por, vertical_destino, especialidad_destino, motivo)
      values ('5eed1001-0000-4000-8000-000000000001', '5eed0001-0000-4000-8000-000000000001',
              'clinica', 'psiquiatria', 'control 203 (se deshace)') returning id into d;
      begin
        insert into public.consultations (patient_id, professional_id, derivacion_id, scheduled_at, status, modality, vertical)
        values ('5eed1001-0000-4000-8000-000000000001', '${prof}', d, now() + interval '2 days', 'pending', 'video', 'psiquiatria');
        msg := 'RESERVO';
      exception when others then msg := sqlerrm; end;
      raise exception 'RESULTADO %', msg;
    end`
  // vertical_destino quedó 'clinica' (como una derivación creada antes de la 200)
  const ok = await bloque(base('c11e0001-0000-4000-8000-000000000001', 'psiquiatria'))
  check(ok === 'RESERVO', `derivación a "Clínica · Psiquiatría" (vieja) la reserva un psiquiatra (${ok.slice(0, 80)})`)
  const no = await bloque(base('c11e0001-0000-4000-8000-000000000001', 'nutricion'))
  check(/no es de la especialidad/.test(no), `un nutricionista no la puede tomar (${no.slice(0, 60)})`)
}

// ── 4. historia clínica con derivación, en el front ─────────────────────────
if (!process.argv.includes('--sin-front')) {
  const { chromium } = await import('@playwright/test')
  const link = await (await fetch(`${URL_SB}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email: 'clinica@staging.healthier.app' }),
  })).json()
  const ses = await (await fetch(`${URL_SB}/auth/v1/verify`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', token_hash: link.hashed_token ?? link.properties?.hashed_token }),
  })).json()
  const browser = await chromium.launch()
  const page = await browser.newPage()
  const errores = []
  page.on('pageerror', e => errores.push(e.message))
  await page.goto(`${WEB}/login`)
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [
    `sb-${REF}-auth-token`,
    JSON.stringify({ access_token: ses.access_token, token_type: ses.token_type, expires_in: ses.expires_in, expires_at: ses.expires_at, refresh_token: ses.refresh_token, user: ses.user }),
  ])
  await page.goto(`${WEB}/profesional/historia-clinica/5eed1001-0000-4000-8000-000000000001`)
  const vio = await page.getByText(/Derivación a /).first().waitFor({ timeout: 20000 }).then(() => true).catch(() => false)
  // El ErrorBoundary de la app atrapa el error (no llega a `pageerror`) y
  // muestra "Algo salió mal" con el mensaje: eso también es una caída.
  const caida = await page.getByText('Algo salió mal').count()
  if (caida) errores.push(await page.locator('body').innerText().then(t => t.split('\n').slice(0, 6).join(' ')))
  check(vio && errores.length === 0, `la historia clínica de un paciente con derivación se abre${errores.length ? ` (error: ${errores[0].slice(0, 80)})` : vio ? '' : ' (no apareció "Derivación a")'}`)
  await browser.close()
}

process.exit(fallas ? 1 : 0)
