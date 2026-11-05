-- ============================================================
-- 232 — Recorrido de navegación (`flow_url`)
--
-- Pedido de Mateo (2026-11-04): entender el comportamiento de quienes terminan
-- reservando una consulta. Hoy `profiles` sólo guarda el primer toque (utm_*,
-- referrer_url). Falta el camino: por qué pantallas pasó antes de registrarse
-- y antes de reservar. Es el mismo concepto que `flow_url` de BIGG.
--
-- Forma del dato (la misma en la web y en la app): array de
--   { "url": "https://…/ruta" | "app:/ruta", "name": "Pantalla", "at": "ISO" }
-- La URL ya viene limpia desde el cliente (sin query salvo utm_*, sin hash,
-- ids reemplazados por :id); acá sólo se valida forma y tamaño.
--
-- Qué agrega (todo aditivo):
--   1. `profiles.flow_url` — el recorrido hasta el alta. Se escribe UNA vez.
--   2. `consultations.flow_url` — el recorrido desde la reserva anterior hasta
--      ésta.
--   3. Un CHECK de forma y tamaño en las dos columnas (cualquier escritura,
--      también la directa por `profiles_update_own`, queda acotada).
--   4. Dos RPC chicas, security definer, que el propio usuario llama: no
--      pisan lo que ya está escrito y sólo tocan SU perfil / SU consulta.
-- ============================================================

create or replace function public.flow_url_valido(p_flow jsonb)
returns boolean
language sql
immutable
as $$
  select p_flow is null or (
    jsonb_typeof(p_flow) = 'array'
    and jsonb_array_length(p_flow) <= 60
    and pg_column_size(p_flow) <= 20000
  );
$$;

alter table public.profiles
  add column if not exists flow_url jsonb;
alter table public.consultations
  add column if not exists flow_url jsonb;

alter table public.profiles
  drop constraint if exists profiles_flow_url_forma;
alter table public.profiles
  add constraint profiles_flow_url_forma check (public.flow_url_valido(flow_url));

alter table public.consultations
  drop constraint if exists consultations_flow_url_forma;
alter table public.consultations
  add constraint consultations_flow_url_forma check (public.flow_url_valido(flow_url));

comment on column public.profiles.flow_url is
  'Migración 232: recorrido de navegación hasta el alta — array de {url,name,at}. Se escribe una sola vez (registrar_flow_url_perfil).';
comment on column public.consultations.flow_url is
  'Migración 232: recorrido de navegación desde la reserva anterior hasta ésta — array de {url,name,at} (registrar_flow_url_consulta).';

-- ── RPC: el perfil propio, sólo si todavía no tiene recorrido ─────────────
create or replace function public.registrar_flow_url_perfil(p_flow jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_filas int;
begin
  if auth.uid() is null then
    raise exception 'no autenticado' using errcode = '28000';
  end if;
  if p_flow is null or not public.flow_url_valido(p_flow) or jsonb_array_length(p_flow) = 0 then
    return false;
  end if;

  update public.profiles
     set flow_url = p_flow
   where id = auth.uid()
     and flow_url is null;
  get diagnostics v_filas = row_count;
  return v_filas > 0;
end;
$$;

-- ── RPC: la consulta del paciente (o de su familiar a cargo) ──────────────
create or replace function public.registrar_flow_url_consulta(p_consultation_id uuid, p_flow jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_filas int;
begin
  if auth.uid() is null then
    raise exception 'no autenticado' using errcode = '28000';
  end if;
  if p_flow is null or not public.flow_url_valido(p_flow) or jsonb_array_length(p_flow) = 0 then
    return false;
  end if;

  update public.consultations c
     set flow_url = p_flow
   where c.id = p_consultation_id
     and c.flow_url is null
     and public.puedo_actuar_como(c.patient_id);
  get diagnostics v_filas = row_count;
  return v_filas > 0;
end;
$$;

revoke all on function public.registrar_flow_url_perfil(jsonb) from public, anon;
revoke all on function public.registrar_flow_url_consulta(uuid, jsonb) from public, anon;
grant execute on function public.registrar_flow_url_perfil(jsonb) to authenticated;
grant execute on function public.registrar_flow_url_consulta(uuid, jsonb) to authenticated;
