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
//  5. Firma de la HC con la matrícula real (antes iba 'otra'/'0'): una nota
//     de la videollamada, y desde el detalle de consulta una alergia, una
//     medicación del recetario y la nota de cierre. Con cuentas propias del control
//     (control-firma@ y control-paciente@staging.healthier.app), creadas acá si
//     no existen; el profesional queda fuera del marketplace (is_active false)
//     y cada consulta del control termina completada (no se acumulan abiertas).
//
//   node scripts/verificar-verticales.mjs            # todo
//   node scripts/verificar-verticales.mjs --sin-front
//
// Lo de la base corre dentro de bloques que terminan en `raise exception`: se
// deshacen enteros (nada queda escrito, ningún aviso sale).
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

const env = {}
for (const l of readFileSync(path.join(homedir(), 'Local/.env'), 'utf8').split('\n')) {
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

// ── 4-5. En el front de staging (Chromium headless) ─────────────────────────
if (!process.argv.includes('--sin-front')) {
  const { chromium } = await import('@playwright/test')
  const browser = await chromium.launch()
  const PACIENTE = '5eed1001-0000-4000-8000-000000000001' // tiene una derivación

  async function paginaComo(email) {
    const link = await (await fetch(`${URL_SB}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'magiclink', email }),
    })).json()
    const ses = await (await fetch(`${URL_SB}/auth/v1/verify`, {
      method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'magiclink', token_hash: link.hashed_token ?? link.properties?.hashed_token }),
    })).json()
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    page.errores = []
    page.on('pageerror', e => page.errores.push(e.message))
    await page.goto(`${WEB}/login`)
    await page.evaluate(([k, v]) => localStorage.setItem(k, v), [
      `sb-${REF}-auth-token`,
      JSON.stringify({ access_token: ses.access_token, token_type: ses.token_type, expires_in: ses.expires_in, expires_at: ses.expires_at, refresh_token: ses.refresh_token, user: ses.user }),
    ])
    return page
  }
  // Espera a que la red quede quieta y un rato más, antes de mirar la pantalla.
  const asentar = async page => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(1500) }

  // 4. historia clínica con derivación
  {
    const page = await paginaComo('clinica@staging.healthier.app')
    await page.goto(`${WEB}/profesional/historia-clinica/${PACIENTE}`)
    const vio = await page.getByText(/Derivación a /).first().waitFor({ timeout: 20000 }).then(() => true).catch(() => false)
    await asentar(page)
    // El ErrorBoundary de la app atrapa el error (no llega a `pageerror`) y
    // muestra "Algo salió mal" con el mensaje: eso también es una caída.
    if (await page.getByText('Algo salió mal').count()) page.errores.push(await page.locator('body').innerText().then(t => t.split('\n').slice(0, 6).join(' ')))
    check(vio && page.errores.length === 0, `la historia clínica de un paciente con derivación se abre${page.errores.length ? ` (error: ${page.errores[0].slice(0, 80)})` : vio ? '' : ' (no apareció "Derivación a")'}`)
    await page.context().close()
  }

  // Escribe una nota libre en la videollamada y devuelve el aviso que aparece.
  async function intentarNota(page, consultaId, texto) {
    await page.goto(`${WEB}/profesional/videollamada/${consultaId}`)
    await page.locator('[data-tour="botones-nota"] button').first().click({ timeout: 20000 })
    await page.locator('form textarea').first().fill(texto)
    await page.getByRole('button', { name: /^Guardar/ }).first().click()
    await page.waitForTimeout(3000)
    return page.locator('body').innerText()
  }

  // 5. Con matrícula, la nota de la videollamada se firma con la matrícula
  // REAL (no 'otra'/'0' como antes). Con cuentas propias del control —un
  // profesional y un paciente— que el script crea si no existen; nunca con las
  // demo compartidas, porque una nota de HC no se borra. El profesional queda
  // `is_active = false` y sin Mercado Pago: no aparece en el marketplace.
  const H = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' }
  const rest = async (ruta, init = {}) => {
    const r = await fetch(`${URL_SB}/rest/v1/${ruta}`, { ...init, headers: { ...H, Prefer: 'return=representation', ...(init.headers ?? {}) } })
    const t = await r.text()
    if (!r.ok) throw new Error(`${ruta} → ${r.status} ${t}`)
    return t ? JSON.parse(t) : null
  }
  const MATRICULA_CTRL = 'CTRL-58210'
  async function cuentaControl(email, rol, nombre, apellido) {
    let [fila] = await rest(`profiles?select=id&email=eq.${encodeURIComponent(email)}`)
    let id = fila?.id
    if (!id) {
      const u = await (await fetch(`${URL_SB}/auth/v1/admin/users`, {
        method: 'POST', headers: H,
        body: JSON.stringify({ email, email_confirm: true, password: crypto.randomUUID(), user_metadata: { role: rol, full_name: `${nombre} ${apellido}` } }),
      })).json()
      id = u.id
    }
    if (!id) throw new Error(`no pude crear ${email}`)
    await rest('profiles?on_conflict=id', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({ id, email, full_name: `${nombre} ${apellido}`, first_name: nombre, last_name: apellido, role: rol }),
    })
    return id
  }
  const proCtrl = await cuentaControl('control-firma@staging.healthier.app', 'professional', 'Control', 'Firma')
  const pacCtrl = await cuentaControl('control-paciente@staging.healthier.app', 'patient', 'Control', 'Paciente')
  await rest('professional_profiles?on_conflict=user_id', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({ user_id: proCtrl, specialty: 'medicina_general', license_type: 'MN', license_number: MATRICULA_CTRL, is_verified: true, is_active: false, mp_connected: false, is_on_demand: false }),
  })
  const [consultaCtrl] = await rest('consultations', {
    method: 'POST',
    body: JSON.stringify({ patient_id: pacCtrl, professional_id: proCtrl, status: 'confirmed', scheduled_at: new Date().toISOString(), modality: 'video', price_at_booking: 0, payment_status: 'exempt' }),
  })
  {
    const page = await paginaComo('control-firma@staging.healthier.app')
    const texto = await intentarNota(page, consultaCtrl.id, `Control de firma ${Date.now()}`)
    await page.context().close()
    const enc = await rest(`clinical_encounters?select=id,specialty,professional_license_number&consultation_id=eq.${consultaCtrl.id}`)
    const notas = enc[0] ? await rest(`clinical_entries?select=professional_license_number&encounter_id=eq.${enc[0].id}`) : []
    check(/Nota guardada/.test(texto) && enc[0]?.professional_license_number === MATRICULA_CTRL && enc[0]?.specialty === 'medicina_general'
      && notas.length > 0 && notas.every(n => n.professional_license_number === MATRICULA_CTRL),
      `con matrícula, la nota de la videollamada se firma con la matrícula real (encuentro ${enc[0]?.professional_license_number ?? '—'} · ${enc[0]?.specialty ?? '—'}, notas ${notas.map(n => n.professional_license_number).join(',') || '—'})`)
  }
  await rest(`consultations?id=eq.${consultaCtrl.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'completed' }) })

  // Cierre desde el detalle de consulta, apenas abierto: la nota de cierre
  // queda firmada con la matrícula real.
  {
    const [cc] = await rest('consultations', {
      method: 'POST',
      body: JSON.stringify({ patient_id: pacCtrl, professional_id: proCtrl, status: 'closing', scheduled_at: new Date().toISOString(), modality: 'video', price_at_booking: 0, payment_status: 'exempt' }),
    })
    const resumen = `Control de cierre ${Date.now()}`
    const page = await paginaComo('control-firma@staging.healthier.app')
    let aviso = ''
    const alergeno = `Látex control ${Date.now()}`
    try {
      await page.goto(`${WEB}/profesional/consulta/${cc.id}`)
      // Alergia y medicación desde el mismo detalle, antes de cerrar.
      await page.getByRole('button', { name: /Agregar alergia/ }).click({ timeout: 20000 })
      await page.getByPlaceholder(/Amoxicilina, Ibuprofeno/).first().fill(alergeno)
      await page.getByRole('button', { name: 'Guardar', exact: true }).click()
      await page.getByText('Alergia registrada').first().waitFor({ timeout: 15000 }).catch(() => {})
      await page.getByPlaceholder(/Buscá en el vademécum/).fill('amoxicilina')
      await page.locator('li, [role=option], button').filter({ hasText: /Amox|Amix/i }).first().click({ timeout: 15000 })
      await page.getByPlaceholder(/1 comprimido/).fill('1 comprimido')
      await page.getByRole('button', { name: /Guardar medicación/ }).click()
      await page.getByText(/Medicación registrada/).first().waitFor({ timeout: 15000 }).catch(() => {})
      await page.getByRole('button', { name: 'Cerrar consulta' }).last().click({ timeout: 20000 })
      await page.getByPlaceholder(/Qué pasó/).fill(resumen)
      await page.getByText('cerrá dejando un motivo').click()
      await page.getByPlaceholder(/el paciente cortó/).fill('Control automático.')
      await page.getByRole('button', { name: 'Confirmar cierre' }).click()
      aviso = await page.getByText(/Consulta finalizada correctamente|no se pudo asentar[^\n]*/).first().textContent({ timeout: 20000 }).catch(() => '')
    } finally {
      await page.context().close()
    }
    const alergias = await rest(`clinical_allergies?select=professional_license_number&substance=eq.${encodeURIComponent(alergeno)}`)
    check(alergias[0]?.professional_license_number === MATRICULA_CTRL, `una alergia cargada desde el detalle queda firmada con la matrícula real (${alergias[0]?.professional_license_number ?? 'no se guardó'})`)
    const meds = await rest(`clinical_medications?select=professional_license_number,created_at&patient_id=eq.${pacCtrl}&order=created_at.desc&limit=1`)
    const recien = meds[0] && Date.now() - new Date(meds[0].created_at).getTime() < 5 * 60 * 1000
    check(recien && meds[0].professional_license_number === MATRICULA_CTRL, `una medicación del recetario queda firmada con la matrícula real (${recien ? meds[0].professional_license_number : 'no se guardó'})`)
    const [despues] = await rest(`consultations?select=status&id=eq.${cc.id}`)
    const notas = await rest(`clinical_entries?select=professional_license_number&content=eq.${encodeURIComponent(resumen)}`)
    check(despues?.status === 'completed' && notas[0]?.professional_license_number === MATRICULA_CTRL,
      `cerrar desde el detalle deja la nota de cierre firmada con la matrícula real (${despues?.status} · ${notas[0]?.professional_license_number ?? 'sin nota'}${aviso && !/finalizada/.test(aviso) ? ` · ${aviso.slice(0, 60)}` : ''})`)
    if (despues?.status !== 'completed') await rest(`consultations?id=eq.${cc.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'completed' }) })
  }

  const [proFila] = await rest(`professional_profiles?select=is_active&user_id=eq.${proCtrl}`)
  check(proFila?.is_active === false, 'la cuenta de control no queda activa en el marketplace')

  await browser.close()
}

process.exit(fallas ? 1 : 0)
