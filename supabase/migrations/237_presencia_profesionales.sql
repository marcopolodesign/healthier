-- ═══════════════════════════════════════════════════════════════════════════
-- 237 · Presencia de profesionales para analítica (Hyppo)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Por qué (2026-11-11, sala de Trini, OK de Mateo): Olivia (Hyppo) investiga por
-- qué los pacientes que llegan por Meta no terminan reservando. Hoy no hay forma
-- de saber, para un momento dado, cuántos profesionales podían atender una
-- consulta inmediata: `professional_profiles` guarda sólo el estado de AHORA.
--
-- Dos registros, sin datos personales:
--
--   1. `presencia_profesional_eventos` — cada vez que un profesional se conecta,
--      se desconecta o se le vence la vigencia (1 h sin latido).
--        · conecto / desconecto: trigger sobre `professional_profiles`. Se
--          dispara cuando cambia `on_demand_since`, o cuando un latido revive
--          una vigencia que ya estaba vencida (`on_demand_since` no cambia en
--          ese caso: el ping de la 233 hace coalesce). NO corre con cada latido.
--        · vencio: lo anota un barrido cada 5 minutos, con momento = último
--          latido + 1 hora. No toca la fila del perfil.
--   2. `presencia_elegibles_foto` — cada 5 minutos, por especialidad, cuántos
--      cumplen el criterio de `puede_tomar_ondemand` (elegibles) y cuántos tienen
--      el switch prendido (con_switch). Con y sin cuentas de prueba.
--
-- Customer.io / Hyppo los leen por dos vistas nuevas del esquema `cio`
-- (`cio.presencia_eventos`, `cio.presencia_elegibles`). No se toca ninguna vista
-- cio existente. Las tablas tienen RLS prendida y ninguna policy: ni anon ni
-- authenticated las leen; las vistas (dueño postgres, como las otras de `cio`)
-- son la única ventana.
--
-- Control: `bash scripts/correr-test.sh presencia_237 staging`.

-- ── 1. Tablas ────────────────────────────────────────────────────────────────
create table if not exists public.presencia_profesional_eventos (
  id              bigint generated always as identity primary key,
  professional_id uuid not null references public.profiles(id) on delete cascade,
  specialty       text,
  evento          text not null check (evento in ('conecto', 'desconecto', 'vencio')),
  momento         timestamptz not null default now(),
  es_prueba       boolean not null default false
);

comment on table public.presencia_profesional_eventos is
  'Conexiones, desconexiones y vencimientos de la disponibilidad on-demand (migración 237). Sólo analítica; la escriben un trigger y un barrido.';
comment on column public.presencia_profesional_eventos.momento is
  'conecto/desconecto: cuándo cambió. vencio: último latido + 1 hora.';
comment on column public.presencia_profesional_eventos.es_prueba is
  'Copia de professional_profiles.solo_pruebas al momento del evento.';

-- Un vencimiento por vigencia: el barrido puede repetirse sin duplicar.
create unique index if not exists presencia_eventos_vencio_unico
  on public.presencia_profesional_eventos (professional_id, momento) where evento = 'vencio';
create index if not exists presencia_eventos_momento_idx
  on public.presencia_profesional_eventos (momento);

create table if not exists public.presencia_elegibles_foto (
  tomada_en             timestamptz not null,
  specialty             text not null,
  elegibles             integer not null,
  con_switch            integer not null,
  elegibles_sin_prueba  integer not null,
  con_switch_sin_prueba integer not null,
  primary key (tomada_en, specialty)
);

comment on table public.presencia_elegibles_foto is
  'Foto cada 5 min por especialidad: elegibles = criterio de puede_tomar_ondemand; con_switch = switch prendido, verificado y activo (aunque falte latido o MP). Migración 237.';

alter table public.presencia_profesional_eventos enable row level security;
alter table public.presencia_elegibles_foto      enable row level security;
revoke all on public.presencia_profesional_eventos from anon, authenticated;
revoke all on public.presencia_elegibles_foto      from anon, authenticated;

-- ── 2. Trigger: conecto / desconecto ─────────────────────────────────────────
create or replace function public.presencia_anotar_cambio()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.on_demand_since is null then
    -- Se apagó (o `professional_offline`). Sólo si antes estaba.
    if old.on_demand_since is not null then
      insert into presencia_profesional_eventos (professional_id, specialty, evento, momento, es_prueba)
      values (new.user_id, new.specialty, 'desconecto', now(), coalesce(new.solo_pruebas, false));
    end if;
  else
    -- Prendió por primera vez, o volvió a latir con la vigencia ya vencida.
    insert into presencia_profesional_eventos (professional_id, specialty, evento, momento, es_prueba)
    values (new.user_id, new.specialty, 'conecto', now(), coalesce(new.solo_pruebas, false));
  end if;
  return new;
end;
$$;

revoke all on function public.presencia_anotar_cambio() from public, anon, authenticated;

drop trigger if exists professional_profiles_presencia on public.professional_profiles;
-- Sin `update of <columnas>`: esa lista mira el SET de la sentencia, y prender el
-- switch escribe `on_demand_since` desde el trigger BEFORE de la 190, no desde
-- el SET. El filtro real es el WHEN, que es barato y corre en cada update.
create trigger professional_profiles_presencia
  after update on public.professional_profiles
  for each row
  when (
    old.on_demand_since is distinct from new.on_demand_since
    or (
      new.on_demand_since is not null
      and new.on_demand_last_seen_at is not null
      and old.on_demand_last_seen_at is not null
      and old.on_demand_last_seen_at < new.on_demand_last_seen_at - interval '1 hour'
    )
  )
  execute function public.presencia_anotar_cambio();

-- ── 3. Barrido: vencio + foto de elegibles ───────────────────────────────────
create or replace function public.presencia_barrido()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  -- Vencimientos: vigencia viva en la fila (on_demand_since puesto) pero sin
  -- latido hace más de una hora. Momento = último latido + 1 h, así que repetir
  -- el barrido no duplica (índice único parcial).
  with nuevos as (
    insert into presencia_profesional_eventos (professional_id, specialty, evento, momento, es_prueba)
    select pp.user_id, pp.specialty, 'vencio', pp.on_demand_last_seen_at + interval '1 hour', coalesce(pp.solo_pruebas, false)
      from professional_profiles pp
     where pp.on_demand_since is not null
       and pp.on_demand_last_seen_at is not null
       and pp.on_demand_last_seen_at + interval '1 hour' <= now()
    on conflict (professional_id, momento) where evento = 'vencio' do nothing
    returning 1
  )
  select count(*)::integer into v_n from nuevos;

  -- Foto: por especialidad de profesionales verificados y activos (las que no
  -- tienen a nadie también, para que el cero quede registrado).
  insert into presencia_elegibles_foto (tomada_en, specialty, elegibles, con_switch, elegibles_sin_prueba, con_switch_sin_prueba)
  select date_trunc('minute', now()), x.specialty,
         count(*) filter (where x.elegible),
         count(*) filter (where x.switch),
         count(*) filter (where x.elegible and not x.prueba),
         count(*) filter (where x.switch and not x.prueba)
    from (
      select pp.specialty,
             coalesce(pp.solo_pruebas, false) as prueba,
             (pp.is_on_demand = true) as switch,
             (pp.is_on_demand = true
               and pp.mp_connected = true
               and pp.on_demand_last_seen_at >= now() - interval '1 hour'
               and exists (select 1 from mp_accounts ma where ma.professional_id = pp.user_id and ma.active)) as elegible
        from professional_profiles pp
       where pp.is_verified = true
         and pp.is_active = true
         and pp.specialty is not null
    ) x
   group by x.specialty
  on conflict (tomada_en, specialty) do nothing;

  return v_n;
end;
$$;

revoke all on function public.presencia_barrido() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'presencia-barrido';
    perform cron.schedule('presencia-barrido', '*/5 * * * *', 'select public.presencia_barrido()');
  end if;
end $$;

-- ── 4. Vistas para Customer.io / Hyppo ───────────────────────────────────────
create or replace view cio.presencia_eventos with (security_invoker = false) as
select e.id, e.professional_id, e.specialty, e.evento, e.momento, e.es_prueba
  from public.presencia_profesional_eventos e;

create or replace view cio.presencia_elegibles with (security_invoker = false) as
select f.tomada_en, f.specialty, f.elegibles, f.con_switch, f.elegibles_sin_prueba, f.con_switch_sin_prueba
  from public.presencia_elegibles_foto f;

revoke all on cio.presencia_eventos   from public, anon, authenticated;
revoke all on cio.presencia_elegibles from public, anon, authenticated;
grant select on cio.presencia_eventos   to cio_reader;
grant select on cio.presencia_elegibles to cio_reader;

-- Punto de partida: los que ya están conectados hoy, para que la serie no
-- arranque vacía. Un "conecto" con el momento de su on_demand_since.
insert into public.presencia_profesional_eventos (professional_id, specialty, evento, momento, es_prueba)
select pp.user_id, pp.specialty, 'conecto', pp.on_demand_since, coalesce(pp.solo_pruebas, false)
  from public.professional_profiles pp
 where pp.on_demand_since is not null
   and not exists (select 1 from public.presencia_profesional_eventos e where e.professional_id = pp.user_id);
