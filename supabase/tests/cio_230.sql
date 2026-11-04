-- Verificación de la migración 230 — app instalada y referidos en cio.people.
--
--   bash scripts/correr-test.sh cio_230 staging
--   bash scripts/correr-test.sh cio_230 prod
--
-- Corre COMO `cio_reader`, el rol con el que entran Customer.io y Metabase.
-- Devuelve aserciones y contadores — nunca una fila con datos de una persona.
-- Todas las filas de aserción tienen que dar ok = true.
set local role cio_reader;

-- Por oid y no por nombre: resolver 'public.x' ya exige USAGE en el esquema,
-- que cio_reader (bien) no tiene.
select 'cio_reader no puede leer expo_push_tokens directo' as asercion,
       not has_table_privilege(
         (select c.oid from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relname = 'expo_push_tokens'), 'select') as ok,
       null::bigint as detalle
union all
select 'cio_reader no puede leer auth.sessions directo',
       not has_table_privilege(
         (select c.oid from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'auth' and c.relname = 'sessions'), 'select'), null
union all
select 'las columnas nuevas están al final de cio.people, en orden',
       (select array_agg(column_name::text order by ordinal_position)
          from information_schema.columns
         where table_schema = 'cio' and table_name = 'people'
           and ordinal_position > (select ordinal_position from information_schema.columns
                                    where table_schema = 'cio' and table_name = 'people'
                                      and column_name = 'es_extranjero'))
       = array['tiene_app','app_plataforma','app_push_activo','app_ultimo_uso_at',
               'referido_por_profesional_id','referido_por_profesional_nombre',
               'link_referido'],
       null
union all
select 'las columnas viejas no se movieron (es_extranjero sigue en su lugar)',
       (select ordinal_position from information_schema.columns
         where table_schema = 'cio' and table_name = 'people' and column_name = 'es_extranjero') = 61,
       (select ordinal_position from information_schema.columns
         where table_schema = 'cio' and table_name = 'people' and column_name = 'es_extranjero')
union all
select 'tiene_app nunca es NULL', count(*) = 0, count(*)
  from cio.people where tiene_app is null or app_push_activo is null
union all
select 'sin app: plataforma y último uso en NULL, sin push', count(*) = 0, count(*)
  from cio.people
 where not tiene_app and (app_plataforma is not null or app_ultimo_uso_at is not null or app_push_activo)
union all
select 'con push activo ⇒ tiene_app', count(*) = 0, count(*)
  from cio.people where app_push_activo and not tiene_app
union all
select 'app_plataforma sólo toma ios | android | ambas', count(*) = 0, count(*)
  from cio.people where app_plataforma not in ('ios', 'android', 'ambas')
union all
select 'con app ⇒ tiene fecha de último uso', count(*) = 0, count(*)
  from cio.people where tiene_app and app_ultimo_uso_at is null
union all
select 'referido sin nombre (el profesional existe pero no trae nombre)', count(*) = 0, count(*)
  from cio.people
 where referido_por_profesional_id is not null and referido_por_profesional_nombre is null
union all
select 'nombre de referidor sólo cuando hay id', count(*) = 0, count(*)
  from cio.people
 where referido_por_profesional_id is null and referido_por_profesional_nombre is not null
union all
select 'link_referido: dominio propio + /r/ + código', count(*) = 0, count(*)
  from cio.people
 where link_referido is not null
   and link_referido !~ '^https://www\.healthier\.com\.ar/r/[^/[:space:]]+$'
union all
select 'link_referido: todo profesional con código lo tiene', count(*) = 0, count(*)
  from cio.people
 where nullif(btrim(referral_code), '') is not null
   and link_referido is distinct from cio.base_url() || '/r/' || btrim(referral_code)
union all
select 'link_referido: sin código ⇒ NULL', count(*) = 0, count(*)
  from cio.people
 where nullif(btrim(referral_code), '') is null and link_referido is not null
union all
select 'ninguna cuenta de prueba sale en cio.people', count(*) = 0, count(*)
  from cio.people
 where email ilike '%@healthier.app' or email ilike '%@staging.healthier.app'
    or email ilike '%@hyppo.io' or email ilike '%.test'

-- Contadores
union all
select 'conteo · personas en cio.people', null, count(*) from cio.people
union all
select 'conteo · con app', null, count(*) from cio.people where tiene_app
union all
select 'conteo · app ios', null, count(*) from cio.people where app_plataforma = 'ios'
union all
select 'conteo · app android', null, count(*) from cio.people where app_plataforma = 'android'
union all
select 'conteo · app ambas', null, count(*) from cio.people where app_plataforma = 'ambas'
union all
select 'conteo · con push activo', null, count(*) from cio.people where app_push_activo
union all
select 'conteo · con app pero sin push (sólo por sesión)', null, count(*) from cio.people where tiene_app and not app_push_activo
union all
select 'conteo · pacientes sin app', null, count(*) from cio.people where role = 'patient' and not tiene_app
union all
select 'conteo · referidos por un profesional', null, count(*) from cio.people where referido_por_profesional_id is not null
union all
select 'conteo · profesionales distintos que refirieron', null, count(distinct referido_por_profesional_id) from cio.people
union all
select 'conteo · con link_referido', null, count(*) from cio.people where link_referido is not null;
