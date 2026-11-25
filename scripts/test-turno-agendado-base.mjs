#!/usr/bin/env node
/**
 * Control de la migración 249 (`validar_turno_agendado`) contra la base de
 * STAGING: un turno agendado por el paciente no se puede reservar fuera de la
 * agenda, en el pasado, encima de otro ni a otro precio — aunque el horario
 * venga escrito a mano en la URL del wizard (`?fecha=&hora=`).
 *
 * Todo corre en UNA transacción que se deshace: no deja filas, no manda mails
 * ni avisos (pg_net encola dentro de la transacción).
 *
 *   node --test scripts/test-turno-agendado-base.mjs      (desde website/)
 *
 * Necesita SUPABASE_ACCESS_TOKEN y HEALTHIER_STAGING_SUPABASE_REF (~/Local/.env).
 * Sin ellos se saltea y lo dice.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN
const REF = process.env.HEALTHIER_STAGING_SUPABASE_REF
const PRO = '5eed0001-0000-4000-8000-000000000001' // Valentina Ortega (seed de staging): lun–sáb 9–13, lun–vie 15–19
const PACIENTE_EMAIL = 'paciente@healthier.app'

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const body = await r.json()
  if (!r.ok) throw new Error(JSON.stringify(body))
  return body
}

// El próximo día hábil (lun–vie) a partir de pasado mañana, en Buenos Aires.
function diaHabil() {
  const d = new Date(Date.now() - 3 * 3600e3)
  d.setUTCDate(d.getUTCDate() + 2)
  while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

test('la base valida el turno agendado por el paciente (migración 249)', { skip: !TOKEN || !REF ? 'sin SUPABASE_ACCESS_TOKEN / HEALTHIER_STAGING_SUPABASE_REF' : false }, async () => {
  const [{ id: paciente }] = await sql(`select id from profiles where email = '${PACIENTE_EMAIL}' limit 1`)
  const dia = diaHabil()
  const libre = await sql(`select not exists (select 1 from consultations where professional_id='${PRO}' and scheduled_at='${dia}T12:30:00-03:00' and status in ('pending','confirmed','in_progress')) as ok`)
  assert.ok(libre[0].ok, `el ${dia} 12:30 tiene que estar libre en staging para la prueba`)

  const ins = (caso, extra) => `
    begin
      insert into consultations (patient_id, professional_id, modality, status, payment_status, ${extra.cols})
      values ('${paciente}', '${PRO}', ${extra.vals})
      returning price_at_booking::text into vtxt;
      insert into r values ('${caso}', 'ok ' || coalesce(vtxt, ''));
    exception when others then
      insert into r values ('${caso}', 'error ' || sqlerrm);
    end;`

  // Todo va en un solo DO que termina con un RAISE: el error deshace TODO (las
  // filas de prueba, los avisos encolados) y trae los resultados en el mensaje.
  let mensaje = ''
  try {
    await sql(`
      do $do$
      declare v jsonb; vtxt text;
      begin
        create temp table r (caso text, resultado text);
        grant all on r to authenticated;
        perform set_config('request.jwt.claims', '{"sub":"${paciente}","role":"authenticated"}', true);
        execute 'set local role authenticated';
        ${ins('precio_manipulado', { cols: 'price_at_booking, scheduled_at', vals: `'video', 'pending', 'pending_payment', 1, '${dia}T12:30:00-03:00'` })}
        ${ins('ocupado', { cols: 'price_at_booking, scheduled_at', vals: `'video', 'pending', 'pending_payment', 18000, '${dia}T12:30:00-03:00'` })}
        ${ins('fuera_de_agenda', { cols: 'price_at_booking, scheduled_at', vals: `'video', 'pending', 'pending_payment', 18000, '${dia}T22:00:00-03:00'` })}
        ${ins('desalineado', { cols: 'price_at_booking, scheduled_at', vals: `'video', 'pending', 'pending_payment', 18000, '${dia}T10:07:00-03:00'` })}
        ${ins('pasado', { cols: 'price_at_booking, scheduled_at', vals: `'video', 'pending', 'pending_payment', 18000, now() - interval '1 day'` })}
        ${ins('presencial_precio', { cols: 'price_at_booking, scheduled_at', vals: `'presencial', 'pending', 'pending_payment', 5, '${dia}T11:00:00-03:00'` })}
        ${ins('on_demand_ahora', { cols: 'price_at_booking, scheduled_at, is_on_demand, vertical', vals: `'video', 'pending', 'pending_payment', 1, now(), true, 'clinica'` })}
        ${ins('on_demand_a_futuro', { cols: 'price_at_booking, scheduled_at, is_on_demand, vertical', vals: `'video', 'pending', 'pending_payment', 1, '${dia}T11:30:00-03:00', true, 'clinica'` })}
        ${ins('sin_horario', { cols: 'price_at_booking', vals: `'video', 'pending', 'pending_payment', 1` })}
        execute 'reset role';
        select jsonb_object_agg(caso, resultado) into v from r;
        raise exception 'RESULTADOS%RESULTADOS', v::text;
      end $do$;
    `)
  } catch (e) {
    mensaje = String(e.message)
  }
  const m = mensaje.match(/RESULTADOS(.*?)RESULTADOS/)
  assert.ok(m, `la prueba no llegó al final: ${mensaje.slice(0, 400)}`)
  const res = JSON.parse(m[1].replace(/\\"/g, '"'))
  console.log(res)

  assert.equal(res.precio_manipulado, 'ok 18000.00', 'el precio lo pone la base (video = 18000), no el cliente')
  assert.match(res.ocupado, /ya no está libre/)
  assert.match(res.fuera_de_agenda, /no está en la agenda/)
  assert.match(res.desalineado, /no está en la agenda/)
  assert.match(res.pasado, /ya pasó/)
  assert.equal(res.presencial_precio, 'ok 22000.00', 'presencial cobra el precio presencial')
  const [{ ondemand_price: precioInmediata }] = await sql("select ondemand_price from vertical_settings where id = 'clinica'")
  assert.equal(Number(res.on_demand_ahora.replace('ok ', '')), Number(precioInmediata), 'la inmediata cobra el precio de la vertical, no el del cliente')
  assert.match(res.on_demand_a_futuro, /es para ahora/, 'marcar is_on_demand no sirve para saltearse la agenda')
  assert.match(res.sin_horario, /Elegí un día y un horario/)
})
