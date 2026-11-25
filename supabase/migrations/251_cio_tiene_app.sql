-- ═══════════════════════════════════════════════════════════════════════════
-- 251 · cio.people — quién tiene la app (y quién vino referido por quién)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Pedido de Hyppo, mail del 2026-11-25 ("sumar un campo que diga si el
-- paciente tiene la app instalada"), OK de Mateo. Ya estaba pedido y aprobado
-- el 2026-11-04 (migración 230), que quedó sólo en staging: estaba escrita
-- sobre la cio.people anterior a la 234, así que aplicarla en producción tal
-- cual deshacía el arreglo de signup_completo.
--
-- Ésta trae lo mismo que la 230 pero editando la definición VIVA de la vista
-- (patrón de la 234): agrega al final las mismas 7 columnas, en el mismo orden
-- que staging, sin tocar nada de lo que ya hay. En staging (ya tiene la 230)
-- no hace nada.
--
--   tiene_app / app_plataforma ('ios' | 'android' | 'ambas') / app_push_activo
--   / app_ultimo_uso_at — por cio.app_instalada(): token de push de Expo (si
--   aceptó las notificaciones) o sesión con el user agent de la app
--   (Healthier/… iOS, okhttp/… Android). Quien instaló la app y nunca entró no
--   figura: no hay forma de saberlo desde la base.
--   referido_por_profesional_id / _nombre / link_referido — como en la 230.
--
-- Sin datos de salud. Control: bash scripts/correr-test.sh cio_tiene_app_251 <entorno>.

create or replace function cio.app_instalada(p_user_id uuid)
returns table (
  tiene_app          boolean,
  app_plataforma     text,
  app_push_activo    boolean,
  app_ultimo_uso_at  timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with senales as (
    select case when t.platform in ('ios', 'android') then t.platform end as plataforma,
           true as es_push,
           t.updated_at as at
      from public.expo_push_tokens t
     where t.user_id = p_user_id
    union all
    select case
             when s.user_agent like 'Healthier/%' then 'ios'
             when s.user_agent like 'okhttp/%'    then 'android'
           end,
           false,
           -- refreshed_at es timestamp sin zona, guardado en UTC: se interpreta
           -- explícito, sin depender del TimeZone de quien consulta.
           greatest(s.refreshed_at at time zone 'UTC', s.updated_at, s.created_at)
      from auth.sessions s
     where s.user_id = p_user_id
       and (s.user_agent like 'Healthier/%' or s.user_agent like 'okhttp/%')
  )
  select count(*) > 0,
         case
           when count(distinct plataforma) > 1 then 'ambas'
           else max(plataforma)
         end,
         coalesce(bool_or(es_push), false),
         max(at)
    from senales
$$;

revoke all on function cio.app_instalada(uuid) from public;
grant execute on function cio.app_instalada(uuid) to cio_reader;
comment on function cio.app_instalada(uuid) is
  'Señal de app instalada para cio.people (migraciones 230/251): token de push de Expo (sólo si abrió la app y aceptó notificaciones) o sesión de auth con user agent de la app (Healthier/… = iOS, okhttp/… = Android).';

DO $$
DECLARE
  v_def text;
  v_from text := E'\n   FROM ((profiles p\n';
  v_where text := E' tel)\n  WHERE';
BEGIN
  IF EXISTS (select 1 from information_schema.columns
              where table_schema = 'cio' and table_name = 'people' and column_name = 'tiene_app') THEN
    RETURN;  -- ya está (staging, por la 230)
  END IF;

  v_def := pg_get_viewdef('cio.people'::regclass);
  IF position(v_from IN v_def) = 0 OR position(v_where IN v_def) = 0 THEN
    RAISE EXCEPTION 'cio.people cambió: no encuentro el FROM/WHERE esperado';
  END IF;

  v_def := replace(v_def, v_from,
       E',\n    app.tiene_app,\n    app.app_plataforma,\n    app.app_push_activo,\n    app.app_ultimo_uso_at,'
    || E'\n    p.referred_by_professional_id AS referido_por_profesional_id,'
    || E'\n    ( SELECT ref.full_name FROM profiles ref WHERE (ref.id = p.referred_by_professional_id)) AS referido_por_profesional_nombre,'
    || E'\n    ((cio.base_url() || ''/r/''::text) || NULLIF(btrim(pp.referral_code), ''''::text)) AS link_referido'
    || E'\n   FROM (((profiles p\n');
  v_def := replace(v_def, v_where,
       E' tel)\n     CROSS JOIN LATERAL cio.app_instalada(p.id) app(tiene_app, app_plataforma, app_push_activo, app_ultimo_uso_at))\n  WHERE');

  EXECUTE 'create or replace view cio.people with (security_invoker = false) as ' || v_def;
END $$;

grant select on cio.people to cio_reader;

comment on column cio.people.tiene_app is 'Tiene la app: token de push o sesión con el user agent de la app (migración 251).';
comment on column cio.people.app_plataforma is 'ios | android | ambas (migración 251).';
comment on column cio.people.app_push_activo is 'Tiene token de push: se le puede mandar una notificación (migración 251).';
comment on column cio.people.app_ultimo_uso_at is 'Aprox. última apertura de la app (migración 251).';
comment on column cio.people.referido_por_profesional_id is 'Profesional que lo refirió (profiles.referred_by_professional_id).';
comment on column cio.people.referido_por_profesional_nombre is 'Nombre del profesional que lo refirió.';
comment on column cio.people.link_referido is 'Link de referido del profesional (base_url/r/código).';
