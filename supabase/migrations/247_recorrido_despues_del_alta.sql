-- ============================================================
-- 247 — Recorrido del paciente DESPUÉS del alta
--
-- Pedido de Mateo (2026-11-24): de 62 pacientes nuevos desde el 10/11, 54
-- completan el registro y ninguno reserva, pero no sabemos qué miran después.
-- `profiles.flow_url` (232) se escribe UNA sola vez, al terminar el alta
-- (`registrar_flow_url_perfil` no pisa), así que todo recorrido termina en
-- "Completar registro" / "Onboarding del paciente".
--
-- Por qué una tabla y no seguir escribiendo `profiles.flow_url`:
--   · `profiles` tiene ~20 triggers de UPDATE (updated_at, federador,
--     reverificación, marca de prueba…). Tocar la fila en cada pantalla los
--     dispararía a todos y movería `updated_at` sin que cambie nada del perfil.
--   · Una fila por pantalla se cuenta directo con SQL (embudo, última pantalla).
--   · `profiles.flow_url` sigue siendo "el recorrido hasta el alta", sin cambios.
--
-- Forma de cada fila (la misma en web y app):
--   at · url (ya limpia en el cliente: sin query salvo utm_*, ids → :id) ·
--   name (pantalla legible) · via ('web' | 'app') · hito (null = pantalla; si
--   no, un hito del embudo: vio_horarios, llego_al_pago, pago…)
--
-- Tope: por paciente se guardan las últimas 100 pantallas y los últimos 50
-- hitos (los hitos se recortan aparte para que mucha navegación no borre que
-- llegó al pago). Una pantalla igual a la anterior no se anota.
--
-- Escritura: sólo por la RPC `anotar_recorrido` (security definer), sólo el
-- propio paciente. Lectura: super admin.
-- ============================================================

create table if not exists public.recorrido_paciente (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  at         timestamptz not null,
  url        text not null check (char_length(url) <= 300),
  name       text not null check (char_length(name) <= 100),
  via        text not null check (via in ('web', 'app')),
  hito       text check (hito is null or hito ~ '^[a-z_]{2,40}$'),
  created_at timestamptz not null default now()
);

create index if not exists recorrido_paciente_user_at
  on public.recorrido_paciente (user_id, at desc, id desc);

comment on table public.recorrido_paciente is
  'Migración 247: pantallas e hitos del embudo del paciente logueado (web y app). Últimas 100 pantallas + 50 hitos por paciente. Se escribe sólo con anotar_recorrido().';

alter table public.recorrido_paciente enable row level security;

drop policy if exists recorrido_paciente_super_admin on public.recorrido_paciente;
create policy recorrido_paciente_super_admin on public.recorrido_paciente
  for select using (public.get_my_role() = 'super_admin');

revoke all on public.recorrido_paciente from anon, authenticated;
grant select on public.recorrido_paciente to authenticated; -- filtrado por la policy

-- ── RPC: anotar una o varias entradas del propio paciente ─────────────────
-- p_entradas: array (≤ 25) de { url, name, at, via, hito? }. Devuelve cuántas
-- se guardaron. Nunca tira por datos raros: los descarta.
create or replace function public.anotar_recorrido(p_entradas jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_e       jsonb;
  v_url     text;
  v_name    text;
  v_via     text;
  v_hito    text;
  v_at      timestamptz;
  v_ult_url text;
  v_ult_hito text;
  v_n       int := 0;
begin
  if v_uid is null then
    raise exception 'no autenticado' using errcode = '28000';
  end if;
  if p_entradas is null or jsonb_typeof(p_entradas) <> 'array'
     or jsonb_array_length(p_entradas) = 0 or jsonb_array_length(p_entradas) > 25 then
    return 0;
  end if;
  -- Sólo pacientes: el embudo es de ellos.
  if not exists (select 1 from public.profiles where id = v_uid and role = 'patient') then
    return 0;
  end if;

  for v_e in select value from jsonb_array_elements(p_entradas) loop
    if jsonb_typeof(v_e) <> 'object' then continue; end if;
    v_url  := left(coalesce(v_e->>'url', ''), 300);
    v_name := left(coalesce(nullif(v_e->>'name', ''), v_url), 100);
    v_via  := v_e->>'via';
    v_hito := nullif(v_e->>'hito', '');
    if v_url = '' or v_via is null or v_via not in ('web', 'app') then continue; end if;
    if v_hito is not null and v_hito !~ '^[a-z_]{2,40}$' then continue; end if;

    begin
      v_at := (v_e->>'at')::timestamptz;
    exception when others then
      v_at := null;
    end;
    -- La hora es del teléfono: si viene corrida (futuro o más de 2 días atrás)
    -- se usa la del servidor.
    if v_at is null or v_at > now() + interval '5 minutes' or v_at < now() - interval '2 days' then
      v_at := now();
    end if;

    -- Sin duplicados consecutivos:
    --   · pantalla: igual a la última PANTALLA (un hito en el medio no corta
    --     la racha — volver a la misma pantalla tras un hito no es nueva).
    --   · hito: igual a la última fila (el mismo hito dos veces seguidas).
    if v_hito is null then
      select url into v_ult_url from public.recorrido_paciente
       where user_id = v_uid and hito is null
       order by at desc, id desc limit 1;
      if found and v_ult_url = v_url then continue; end if;
    else
      select hito into v_ult_hito from public.recorrido_paciente
       where user_id = v_uid
       order by at desc, id desc limit 1;
      if found and v_ult_hito is not distinct from v_hito then continue; end if;
    end if;

    insert into public.recorrido_paciente (user_id, at, url, name, via, hito)
    values (v_uid, v_at, v_url, v_name, v_via, v_hito);
    v_n := v_n + 1;
  end loop;

  if v_n > 0 then
    delete from public.recorrido_paciente r
     where r.user_id = v_uid and r.hito is null
       and r.id not in (
         select id from public.recorrido_paciente
          where user_id = v_uid and hito is null
          order by at desc, id desc limit 100);
    delete from public.recorrido_paciente r
     where r.user_id = v_uid and r.hito is not null
       and r.id not in (
         select id from public.recorrido_paciente
          where user_id = v_uid and hito is not null
          order by at desc, id desc limit 50);
  end if;

  return v_n;
end;
$$;

revoke all on function public.anotar_recorrido(jsonb) from public, anon;
grant execute on function public.anotar_recorrido(jsonb) to authenticated;
