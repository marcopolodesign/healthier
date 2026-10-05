#!/usr/bin/env node
/**
 * Las cuentas de prueba sólo se cruzan con cuentas de prueba (migración 186).
 *
 *   node scripts/verificar-cuentas-de-prueba.mjs            # producción + staging
 *   node scripts/verificar-cuentas-de-prueba.mjs produccion
 *   node scripts/verificar-cuentas-de-prueba.mjs staging
 *
 * **Por qué existe.** El 2026-10-05 a las 18:54 el paciente demo
 * (`paciente@healthier.app`) pidió una consulta inmediata, el profesional demo
 * ya había salido del pool y se le asignó a una médica real, que recibió el
 * mail de cancelación. La regla de Mateo: prueba ↔ prueba, real ↔ real, y en
 * la base, no en el cliente.
 *
 * Falla (exit 1) si:
 *   1. Falta la marca, la policy o alguno de los triggers.
 *   2. Hay una cuenta con mail de prueba (`@healthier.app`,
 *      `@staging.healthier.app`, `*.test`) sin marcar, un familiar de un titular
 *      de prueba sin marcar, o un `solo_pruebas` despegado de `es_prueba`.
 *   3. Vista como la tiene cada uno (RLS de verdad, con el JWT simulado): el
 *      paciente de prueba ve algún profesional real, un paciente real o un
 *      visitante sin sesión ve algún profesional de prueba.
 *   4. La base deja crear una consulta o una emergencia que cruce los dos
 *      mundos.
 *   5. Aparece una consulta, emergencia o vínculo familiar cruzado creado
 *      después de la migración.
 *
 * **No escribe nada, tampoco en producción.** Los chequeos 3 y 4 corren dentro
 * de un bloque que termina SIEMPRE con un error a propósito, así que todo lo
 * que intenta se deshace; además los intentos de inserción son justamente los
 * que la base tiene que rechazar antes de que corra ningún aviso.
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
  staging:    { ref: 'itjhrvlzuqvyhqtffumc' },
}

// Desde cuándo rige la regla en cada base (hora en que se aplicó la 186).
// Lo cruzado de antes es material de prueba y se va con la limpieza.
const VIGENTE_DESDE = {
  produccion: '2026-10-05 22:43:00+00',
  staging:    '2026-10-05 22:25:00+00',
}

async function sql(ref, query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const text = await r.text()
  let data
  try { data = JSON.parse(text) } catch { data = text }
  return { ok: r.ok, data, text }
}

const SQL_CATALOGO = `
  select
    exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='profiles' and column_name='es_prueba') as columna,
    exists (select 1 from pg_policies
             where schemaname='public' and tablename='professional_profiles'
               and policyname='professional_profiles_mismo_mundo' and permissive='RESTRICTIVE') as policy,
    (select array_agg(t) from unnest(array[
       'consultations_mismo_mundo','emergencies_mismo_mundo','walk_in_queue_mismo_mundo',
       'family_members_mismo_mundo','patient_followups_mismo_mundo',
       'patient_followups_recomendado_mismo_mundo','nutrition_plans_mismo_mundo',
       'activity_plans_mismo_mundo','reviews_mismo_mundo',
       'profiles_marca_de_prueba','profiles_propagar_marca_de_prueba',
       'professional_profiles_espejo_de_prueba'
     ]) t where not exists (select 1 from pg_trigger where tgname = t and not tgisinternal)) as faltan
`

const SQL_MARCAS = `
  select
    (select coalesce(array_agg(email order by email), '{}') from profiles
      where public.correo_de_prueba(email) and not es_prueba) as sin_marcar,
    (select coalesce(array_agg(f.email), '{}') from profiles f join profiles t on t.id = f.titular_id
      where t.es_prueba and not f.es_prueba) as familiares_sin_marcar,
    (select coalesce(array_agg(p.email), '{}') from professional_profiles pp join profiles p on p.id = pp.user_id
      where pp.solo_pruebas is distinct from p.es_prueba) as espejo_despegado,
    (select count(*) from profiles where es_prueba) as marcadas,
    (select coalesce(array_agg(email order by email), '{}') from profiles where ve_ambos_mundos) as ambos_mundos
`

// Corre todo como `authenticated`/`anon` con el JWT simulado y termina SIEMPRE
// con un error que trae el resultado: nada de lo que pasa adentro se guarda.
const SQL_REGLA = (conInsercionPermitida) => `
do $$
declare
  v_pac_prueba uuid; v_pac_real uuid; v_pro_prueba uuid; v_pro_real uuid;
  r jsonb := '{}'::jsonb;
  n_reales int; n_prueba int; n int;
begin
  select id into v_pac_prueba from profiles where email = 'paciente@healthier.app' and titular_id is null limit 1;
  select id into v_pac_real from profiles where role = 'patient' and not es_prueba and not ve_ambos_mundos
    and titular_id is null and deleted_at is null order by created_at limit 1;
  select pp.user_id into v_pro_prueba from professional_profiles pp join profiles p on p.id = pp.user_id
    where p.email = 'profesional@healthier.app';
  select pp.user_id into v_pro_real from professional_profiles pp join profiles p on p.id = pp.user_id
    where not p.es_prueba and pp.is_verified and not p.ve_ambos_mundos order by pp.created_at limit 1;
  r := r || jsonb_build_object('hay', jsonb_build_object(
    'pac_prueba', v_pac_prueba is not null, 'pac_real', v_pac_real is not null,
    'pro_prueba', v_pro_prueba is not null, 'pro_real', v_pro_real is not null));

  -- 3 · Lo que ve cada uno (RLS de verdad)
  perform set_config('request.jwt.claims', json_build_object('sub', v_pac_prueba, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) filter (where not solo_pruebas), count(*) filter (where solo_pruebas)
    into n_reales, n_prueba from professional_profiles where is_verified and is_active;
  execute 'reset role';
  r := r || jsonb_build_object('paciente_prueba_ve', jsonb_build_object('reales', n_reales, 'prueba', n_prueba));

  if v_pac_real is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_pac_real, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select count(*) filter (where not solo_pruebas), count(*) filter (where solo_pruebas)
      into n_reales, n_prueba from professional_profiles where is_verified and is_active;
    execute 'reset role';
    r := r || jsonb_build_object('paciente_real_ve', jsonb_build_object('reales', n_reales, 'prueba', n_prueba));
  end if;

  -- Sin sesión hoy no se puede leer la tabla en absoluto (una policy vieja
  -- llama a una función que anon no puede ejecutar): eso cuenta como 0.
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  begin
    execute 'set local role anon';
    select count(*) filter (where solo_pruebas) into n_prueba from professional_profiles where is_verified and is_active;
    execute 'reset role';
  exception when insufficient_privilege then
    n_prueba := 0;
  end;
  r := r || jsonb_build_object('anonimo_ve_prueba', n_prueba);
  perform set_config('request.jwt.claims', '', true);

  -- 4 · La base no deja cruzarlos
  if v_pro_real is not null then
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_pac_prueba, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      insert into consultations (patient_id, professional_id, status, modality, is_on_demand, scheduled_at)
      values (v_pac_prueba, v_pro_real, 'pending', 'video', true, now());
      execute 'reset role';
      r := r || '{"consulta_prueba_con_real":"SE CREÓ"}';
    exception when check_violation then
      r := r || jsonb_build_object('consulta_prueba_con_real', case when sqlerrm ilike '%cuenta de prueba%' then 'bloqueada' else 'otro error: ' || sqlerrm end);
    end;
    begin
      insert into emergencies (patient_id, professional_id, triage_code, status)
      values (v_pac_prueba, v_pro_real, 'verde', 'cancelled');
      r := r || '{"emergencia_prueba_con_real":"SE CREÓ"}';
    exception when others then
      r := r || jsonb_build_object('emergencia_prueba_con_real', case when sqlerrm ilike '%cuenta de prueba%' then 'bloqueada' else 'otro error: ' || sqlerrm end);
    end;
  end if;
  if v_pac_real is not null then
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_pac_real, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      insert into consultations (patient_id, professional_id, status, modality, is_on_demand, scheduled_at)
      values (v_pac_real, v_pro_prueba, 'pending', 'video', true, now());
      execute 'reset role';
      r := r || '{"consulta_real_con_prueba":"SE CREÓ"}';
    exception when check_violation then
      r := r || jsonb_build_object('consulta_real_con_prueba', case when sqlerrm ilike '%cuenta de prueba%' then 'bloqueada' else 'otro error: ' || sqlerrm end);
    end;
  end if;
  ${conInsercionPermitida ? `
  begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_pac_prueba, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
    insert into consultations (patient_id, professional_id, status, modality, is_on_demand, scheduled_at)
    values (v_pac_prueba, v_pro_prueba, 'pending', 'video', true, now());
    execute 'reset role';
    r := r || '{"consulta_prueba_con_prueba":"se crea"}';
  exception when others then
    r := r || jsonb_build_object('consulta_prueba_con_prueba', 'NO SE CREA: ' || sqlerrm);
  end;` : ''}

  raise exception 'RESULTADO %', r::text;
end $$;
`

const SQL_CRUZADAS = (desde) => `
  with t as (select id, es_prueba, ve_ambos_mundos from profiles)
  select 'consulta' as que, c.id::text, c.created_at from consultations c
    join t a on a.id = c.patient_id join t b on b.id = c.professional_id
   where c.created_at > '${desde}' and a.es_prueba <> b.es_prueba and not (a.ve_ambos_mundos or b.ve_ambos_mundos)
  union all
  select 'emergencia', e.id::text, e.created_at from emergencies e
    join t a on a.id = e.patient_id join t b on b.id = e.professional_id
   where e.updated_at > '${desde}' and a.es_prueba <> b.es_prueba and not (a.ve_ambos_mundos or b.ve_ambos_mundos)
  union all
  select 'familiar', f.id::text, f.created_at from family_members f
    join t a on a.id = f.patient_id join t b on b.id = f.familiar_id
   where f.created_at > '${desde}' and a.es_prueba <> b.es_prueba and not (a.ve_ambos_mundos or b.ve_ambos_mundos)
`

async function verificar(nombre) {
  const { ref } = ENTORNOS[nombre]
  const fallas = []
  const ok = (m) => console.log(`  ✅ ${m}`)
  const mal = (m) => { console.log(`  ❌ ${m}`); fallas.push(m) }
  console.log(`\n── ${nombre} (${ref})`)

  const cat = await sql(ref, SQL_CATALOGO)
  if (!cat.ok) { mal(`catálogo: ${cat.text}`); return fallas }
  const c = cat.data[0]
  c.columna ? ok('existe profiles.es_prueba') : mal('falta profiles.es_prueba')
  c.policy ? ok('policy restrictiva professional_profiles_mismo_mundo') : mal('falta la policy restrictiva')
  c.faltan ? mal(`faltan triggers: ${c.faltan.join(', ')}`) : ok('los 12 triggers están')
  if (!c.columna) return fallas

  const mk = (await sql(ref, SQL_MARCAS)).data[0]
  mk.sin_marcar.length ? mal(`mails de prueba sin marcar: ${mk.sin_marcar.join(', ')}`) : ok(`${mk.marcadas} cuentas marcadas, ningún mail de prueba sin marcar`)
  mk.familiares_sin_marcar.length ? mal(`familiares de prueba sin marcar: ${mk.familiares_sin_marcar.join(', ')}`) : ok('familiares heredan la marca')
  mk.espejo_despegado.length ? mal(`solo_pruebas despegado: ${mk.espejo_despegado.join(', ')}`) : ok('solo_pruebas = es_prueba en todos los profesionales')
  if (mk.ambos_mundos.length) console.log(`  ℹ️  ven los dos mundos: ${mk.ambos_mundos.join(', ')}`)

  const regla = await sql(ref, SQL_REGLA(nombre === 'staging'))
  const msg = typeof regla.data === 'object' ? String(regla.data?.message ?? '') : regla.text
  const m = msg.match(/RESULTADO (\{.*?\})\s*\n?CONTEXT/s)
  if (!m) { mal(`no se pudo correr la prueba de la regla: ${msg.slice(0, 300)}`); return fallas }
  const r = JSON.parse(m[1])
  if (!r.hay.pac_prueba) mal('no existe paciente@healthier.app')
  const pv = r.paciente_prueba_ve
  pv.reales === 0 ? ok(`paciente de prueba ve 0 profesionales reales (${pv.prueba} de prueba)`) : mal(`el paciente de prueba ve ${pv.reales} profesionales reales`)
  if (r.paciente_real_ve) {
    r.paciente_real_ve.prueba === 0 ? ok(`un paciente real ve 0 profesionales de prueba (${r.paciente_real_ve.reales} reales)`) : mal(`un paciente real ve ${r.paciente_real_ve.prueba} profesionales de prueba`)
  } else console.log('  ⚠️  no hay paciente real para probar')
  r.anonimo_ve_prueba === 0 ? ok('sin sesión no se ve ningún profesional de prueba') : mal(`sin sesión se ven ${r.anonimo_ve_prueba} profesionales de prueba`)
  for (const k of ['consulta_prueba_con_real', 'consulta_real_con_prueba', 'emergencia_prueba_con_real']) {
    if (!(k in r)) { console.log(`  ⚠️  ${k}: sin cuentas para probarlo`); continue }
    r[k] === 'bloqueada' ? ok(`${k.replaceAll('_', ' ')}: la base la rechaza`) : mal(`${k.replaceAll('_', ' ')}: ${r[k]}`)
  }
  if ('consulta_prueba_con_prueba' in r) {
    r.consulta_prueba_con_prueba === 'se crea' ? ok('consulta prueba con prueba: se puede crear (y se deshizo)') : mal(`consulta prueba con prueba: ${r.consulta_prueba_con_prueba}`)
  }

  const cruz = await sql(ref, SQL_CRUZADAS(VIGENTE_DESDE[nombre]))
  if (!cruz.ok) mal(`cruzadas: ${cruz.text}`)
  else cruz.data.length ? mal(`filas cruzadas después de la 186: ${cruz.data.map(x => `${x.que} ${x.id}`).join(', ')}`) : ok('ninguna fila cruzada desde que rige la regla')

  return fallas
}

const pedido = process.argv[2]
const nombres = pedido ? [pedido] : ['produccion', 'staging']
let total = 0
for (const n of nombres) {
  if (!ENTORNOS[n]) { console.error(`entorno desconocido: ${n}`); process.exit(2) }
  total += (await verificar(n)).length
}
console.log(total ? `\n❌ ${total} falla(s)` : '\n✅ todo en orden')
process.exit(total ? 1 : 0)
