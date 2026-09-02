-- Test de aislamiento del rol `cio_reader`.
--
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/cio_aislamiento.sql
--
-- Falla si `cio_reader` puede alcanzar CUALQUIER cosa fuera del esquema `cio`, o si
-- en `cio` aparece una columna que huele a dato de salud. Correrlo después de cada
-- migración que agregue tablas o toque las vistas de `cio`.

\set ON_ERROR_STOP on

-- 1 · Ninguna tabla de `public`, `auth` ni `storage` es alcanzable.
do $$
declare t record; leaked text[] := '{}'; n int; total int;
begin
  set local role cio_reader;
  if current_user <> 'cio_reader' then
    raise exception 'el test no cambió de rol — falta `grant cio_reader to postgres`';
  end if;

  for t in select schemaname, tablename from pg_tables
           where schemaname in ('public','auth','storage') order by 1,2 loop
    begin
      execute format('select count(*) from %I.%I', t.schemaname, t.tablename) into n;
      leaked := leaked || (t.schemaname || '.' || t.tablename);
    exception when insufficient_privilege then null;
    end;
  end loop;

  select count(*) into total from pg_tables where schemaname in ('public','auth','storage');
  if array_length(leaked,1) is not null then
    raise exception 'FUGA — % de % tablas legibles: %', array_length(leaked,1), total, leaked;
  end if;
  raise notice '✓ 0 de % tablas fuera de `cio` alcanzables', total;
end $$;

-- 2 · Tampoco por función: `public` tiene funciones SECURITY DEFINER que en otro
--     setup se podrían llamar para leer por la ventana.
do $$
begin
  set local role cio_reader;
  if has_schema_privilege('cio_reader','public','USAGE') then
    raise exception 'FUGA — cio_reader tiene USAGE en `public`: puede llamar sus funciones SECURITY DEFINER';
  end if;
  raise notice '✓ sin USAGE en `public` — las funciones SECURITY DEFINER quedan fuera de alcance';
end $$;

-- 3 · Las vistas de `cio` sí se leen.
do $$
declare n int;
begin
  set local role cio_reader;
  execute 'select count(*) from cio.people'    into n;
  execute 'select count(*) from cio.events'    into n;
  execute 'select count(*) from cio.reminders' into n;
  raise notice '✓ las tres vistas de `cio` se leen';
end $$;

-- 4 · Ninguna columna expuesta huele a dato de salud. Si agregás una columna
--     legítima que matchea el patrón, cambiá el patrón a conciencia — no al pasar.
do $$
declare bad text;
begin
  select string_agg(table_name||'.'||column_name, ', ') into bad
  from information_schema.columns
  where table_schema = 'cio'
    and column_name ~* ('allerg|blood|dni|birth|height|weight|insurance|diagnos'
                     || '|medication_name|dosage|cie10|snomed|droga|presentacion'
                     || '|notes|nota|motivo|reason|preconsulta|hc_draft|triage'
                     || '|latitude|longitude|affiliate|obra_social|comment|mensaje|message');
  if bad is not null then
    raise exception 'COLUMNA PROHIBIDA en cio: %', bad;
  end if;
  raise notice '✓ ninguna columna prohibida en `cio`';
end $$;
