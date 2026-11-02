#!/usr/bin/env node
/**
 * Control del incidente 2026-11-02: una paciente reservó y pagó un turno
 * "presencial" con una profesional que atiende SÓLO por video. Falla si vuelve:
 *  1. lógica de filtro de la web (src/lib/modalidad.js): presencial sólo con
 *     quien atiende presencial + precio presencial propio + consultorio con
 *     número; el precio de video jamás hace de presencial; la modalidad nunca
 *     se deduce por descarte;
 *  2. la web y la base (direccion_con_numero) deciden igual sobre las mismas
 *     direcciones;
 *  3. LA BASE (staging) rechaza un turno presencial con un profesional sólo
 *     virtual / sin precio presencial / sin dirección con número, y acepta uno
 *     'ambas' completo, la atención de una emergencia y un turno de video. Todo
 *     dentro de una transacción que se deshace: no deja filas.
 *  4. las pantallas no vuelven a `modality === 'virtual' ? 'video' : 'presencial'`.
 * Uso: node --test scripts/test-modalidad-presencial.mjs   (desde website/)
 * Necesita SUPABASE_ACCESS_TOKEN y HEALTHIER_STAGING_SUPABASE_REF (~/Local/.env);
 * sin ellos las pruebas de base se saltean (y lo dicen).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { ofreceModalidad, modalidadParaBase, direccionConNumero, precioPresencial } from '../src/lib/modalidad.js'

// ── 1. La lógica de filtro ───────────────────────────────────────────────────
const ANI = { modalityPreference: 'virtual', pricePresencial: null, priceVideo: 15000, sessionPrice: 15000, address: 'Avenida Santa Fe, Recoleta' }
const AMBAS = { modalityPreference: 'ambas', pricePresencial: 35000, priceVideo: 30000, address: '2839, Arenales, Barrio Norte, Recoleta, Buenos Aires' }

test('una profesional sólo virtual no ofrece presencial, aunque tenga precio de video', () => {
  const r = ofreceModalidad(ANI, 'presencial')
  assert.equal(r.ok, false)
  assert.equal(r.precio, null)
  assert.equal(precioPresencial(ANI), null)
})
test('null cuenta como virtual', () => {
  assert.equal(ofreceModalidad({ ...AMBAS, modalityPreference: null }, 'presencial').ok, false)
})
test('presencial: sin precio presencial no se ofrece (no cae al de video ni al session_price)', () => {
  const r = ofreceModalidad({ ...AMBAS, pricePresencial: null, sessionPrice: 20000 }, 'presencial')
  assert.equal(r.ok, false)
  assert.equal(r.precio, null)
})
test('presencial: sin calle y número no se ofrece', () => {
  for (const address of [null, '', 'Donado y Echeverria.', 'Lavalleja, Villa Crespo, Buenos Aires, Comuna 15']) {
    assert.equal(ofreceModalidad({ ...AMBAS, address }, 'presencial').ok, false, `address=${address}`)
  }
})
test("'ambas' con precio presencial y dirección completa ofrece presencial con SU precio", () => {
  const r = ofreceModalidad(AMBAS, 'presencial')
  assert.equal(r.ok, true)
  assert.equal(r.precio, 35000)
  assert.equal(ofreceModalidad(AMBAS, 'virtual').precio, 30000)
})
test('virtual: ofrece quien tiene precio de video; el presencial no hace de video', () => {
  assert.equal(ofreceModalidad(ANI, 'virtual').ok, true)
  assert.equal(ofreceModalidad({ modalityPreference: 'presencial', pricePresencial: 40000, address: 'Paraguay 2452' }, 'virtual').ok, false)
})
test('la modalidad nunca se deduce por descarte', () => {
  assert.equal(modalidadParaBase('virtual'), 'video')
  assert.equal(modalidadParaBase('presencial'), 'presencial')
  for (const malo of [null, undefined, '', 'video', 'Presencial', 'otra']) {
    assert.throws(() => modalidadParaBase(malo), /presencial o por videoconsulta/, String(malo))
  }
  assert.equal(ofreceModalidad(AMBAS, undefined).ok, false)
})

// ── Guardas estáticas ────────────────────────────────────────────────────────
function archivos(dir) {
  return readdirSync(dir).flatMap(n => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? archivos(p) : /\.(jsx?|tsx?)$/.test(n) ? [p] : []
  })
}
test("ninguna pantalla vuelve a guardar 'presencial' por descarte ni a cruzar precios", () => {
  // Las pantallas del PACIENTE (donde se reserva) y los servicios. El formulario
  // del profesional (Configuracion.jsx) precarga sus propios campos: no reserva.
  const raiz = new URL('../src', import.meta.url).pathname
  const malos = []
  for (const f of archivos(raiz).filter(f => !f.includes('/pages/professional/'))) {
    const t = readFileSync(f, 'utf8')
    if (/===\s*'(virtual|Videollamada)'\s*\?\s*'video'\s*:\s*'presencial'/.test(t)) malos.push(`${f}: descarte a presencial`)
    if (/pricePresencial\s*\?\?\s*[\w.?]*(sessionPrice|priceVideo|price)\b/.test(t)) malos.push(`${f}: presencial cae a otro precio`)
    if (/priceVideo\s*\?\?\s*[\w.?]*pricePresencial/.test(t)) malos.push(`${f}: video cae al presencial`)
  }
  assert.deepEqual(malos, [])
})

// ── 2 y 3. La base de staging ────────────────────────────────────────────────
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN
const REF = process.env.HEALTHIER_STAGING_SUPABASE_REF
const saltear = !TOKEN || !REF ? 'faltan SUPABASE_ACCESS_TOKEN / HEALTHIER_STAGING_SUPABASE_REF (source ~/Local/.env)' : false

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const t = await r.text()
  return { status: r.status, body: t }
}

const DIRECCIONES = [
  '2839, Arenales, Barrio Norte, Recoleta, Buenos Aires, Comuna 2, Ciudad Autónoma de Buenos Aires',
  'Paraguay 2452, Ciudad autónoma de Buenos Aires', 'Nazarre 2843 3 piso dto 14', 'Arenales 3709 1A Palermo',
  'Calle 22 621, Este, Mercedes, Partido de Mercedes, Buenos Aires', 'IFER, 2259, Marcelo T. de Alvear, Barrio Norte',
  '5063, 61 - Lacroze, Villa Ballester', 'Lavalleja, Villa Crespo, Buenos Aires, Comuna 15, Ciudad Autónoma de Buenos Aires',
  'Donado y Echeverria.', '', null, 'Avenida Santa Fe, Recoleta', '9 de Julio, Centro', 'Av. 9 de Julio 1500', 'Calle 12', 'Ruta 8 km 50',
  'Av. Santa Fe 1900, Recoleta, Buenos Aires', 'Piso 3 dto 4', '1990, Avenida Santa Fe, Barrio Norte, Recoleta',
]

test('la web y la base deciden igual si una dirección tiene calle y número', { skip: saltear }, async () => {
  const lista = DIRECCIONES.map(d => (d === null ? 'null' : `'${d.replace(/'/g, "''")}'`)).join(',')
  const { status, body } = await sql(`select d, public.direccion_con_numero(d) ok from unnest(array[${lista}]::text[]) d`)
  assert.equal(status, 201, body)
  const filas = JSON.parse(body)
  assert.equal(filas.length, DIRECCIONES.length)
  filas.forEach((f, i) => assert.equal(f.ok, direccionConNumero(DIRECCIONES[i]), `"${DIRECCIONES[i]}": base=${f.ok} web=${direccionConNumero(DIRECCIONES[i])}`))
})

test('LA BASE rechaza un turno presencial con quien no lo ofrece y acepta el resto (se deshace sola)', { skip: saltear }, async () => {
  // Un solo bloque en una transacción: arma 4 profesionales con perfiles distintos
  // sobre UNA fila real (se restaura sola al abortar), prueba cada caso con un
  // sub-bloque y termina con una excepción propia para deshacer todo.
  const { status, body } = await sql(`
do $$
declare
  v_pat uuid; v_pro uuid; v_n int := 0; v_msg text;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  select id into v_pat from public.profiles where role = 'patient' limit 1;
  select user_id into v_pro from public.professional_profiles where is_active limit 1;
  if v_pat is null or v_pro is null then raise exception 'FALTAN_DATOS'; end if;

  -- (1) sólo virtual con precio de video: debe rechazar
  update public.professional_profiles set modality_preference='virtual', price_presencial=null, price_video=20000, address='Avenida Santa Fe, Recoleta' where user_id=v_pro;
  begin
    insert into public.consultations (patient_id, professional_id, modality, status, payment_status, scheduled_at) values (v_pat, v_pro, 'presencial', 'pending', 'pending_payment', now() + interval '3 days');
    raise exception 'NO_RECHAZO_VIRTUAL';
  exception when check_violation then
    get stacked diagnostics v_msg = message_text;
    if v_msg not like '%sólo por videoconsulta%' then raise exception 'MENSAJE_RARO: %', v_msg; end if;
  end;

  -- (2) 'ambas' sin precio presencial: debe rechazar
  update public.professional_profiles set modality_preference='ambas', price_presencial=null, address='2839, Arenales, Barrio Norte, Recoleta' where user_id=v_pro;
  begin
    insert into public.consultations (patient_id, professional_id, modality, status, payment_status, scheduled_at) values (v_pat, v_pro, 'presencial', 'pending', 'pending_payment', now() + interval '3 days');
    raise exception 'NO_RECHAZO_SIN_PRECIO';
  exception when check_violation then null; end;

  -- (3) 'ambas' con precio pero sin número en la dirección: debe rechazar
  update public.professional_profiles set price_presencial=35000, address='Donado y Echeverria.' where user_id=v_pro;
  begin
    insert into public.consultations (patient_id, professional_id, modality, status, payment_status, scheduled_at) values (v_pat, v_pro, 'presencial', 'pending', 'pending_payment', now() + interval '3 days');
    raise exception 'NO_RECHAZO_SIN_NUMERO';
  exception when check_violation then null; end;

  -- (4) 'ambas' completo: debe aceptar presencial y video
  update public.professional_profiles set address='2839, Arenales, Barrio Norte, Recoleta' where user_id=v_pro;
  insert into public.consultations (patient_id, professional_id, modality, status, payment_status, scheduled_at) values (v_pat, v_pro, 'presencial', 'pending', 'pending_payment', now() + interval '4 days');
  insert into public.consultations (patient_id, professional_id, modality, status, payment_status, scheduled_at) values (v_pat, v_pro, 'video', 'pending', 'pending_payment', now() + interval '5 days');

  -- (5) video con un profesional sólo virtual sigue andando
  update public.professional_profiles set modality_preference='virtual', price_presencial=null where user_id=v_pro;
  insert into public.consultations (patient_id, professional_id, modality, status, payment_status, scheduled_at) values (v_pat, v_pro, 'video', 'pending', 'pending_payment', now() + interval '6 days');

  -- (6) un turno presencial ya existente no se rompe porque el profesional pasó a virtual (UPDATE que no toca modalidad)
  update public.consultations set status='cancelled' where patient_id=v_pat and professional_id=v_pro and modality='presencial' and scheduled_at > now() + interval '3 days 12 hours' and scheduled_at < now() + interval '4 days 12 hours';

  -- (7) cambiar un turno de video a presencial con un profesional sólo virtual: debe rechazar
  begin
    update public.consultations set modality='presencial' where patient_id=v_pat and professional_id=v_pro and modality='video';
    raise exception 'NO_RECHAZO_UPDATE';
  exception when check_violation then null; end;

  raise exception 'PRUEBA_OK';
end $$;`)
  assert.match(body, /PRUEBA_OK/, `la prueba de base no llegó al final: ${body}`)
})

test('la guardia está instalada en staging', { skip: saltear }, async () => {
  const { body } = await sql(`select tgname from pg_trigger where tgrelid='public.consultations'::regclass and tgname='consultations_turno_presencial'`)
  assert.match(body, /consultations_turno_presencial/)
})
