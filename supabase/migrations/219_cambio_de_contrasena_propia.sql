-- ─────────────────────────────────────────────────────────────────────────────
-- Cambio de la contraseña propia del super admin (/super-admin/perfil).
--
-- Todo lo que guarda estado o deja registro vive en la base y NO depende de lo
-- que diga el navegador (el chequeo de la "contraseña actual" en pantalla es sólo
-- UX; la protección real del panel es el segundo factor).
--
-- ── Por qué un trigger y no `auth.audit_log_entries` ─────────────────────────
-- En Supabase hosted `auth.audit_log_entries` está VACÍA: GoTrue corre con el
-- audit log de Postgres apagado y manda los eventos a los Auth Logs (Logflare).
-- Verificado el 2026-10-29: 0 filas en staging y en producción, después de
-- decenas de `user_updated_password` y `login` ese mismo día. No sirve de fuente.
-- En su lugar, un trigger sobre `auth.users` anota CADA cambio real de
-- `encrypted_password` (el hash nunca se copia): sale de la misma fila que
-- escribe GoTrue, por cualquier camino (updateUser, recuperación por mail, Admin
-- API), y persiste aunque la sesión se borre. Un patrón ya usado en este proyecto
-- (`crear_perfil_al_registrarse` también cuelga de auth.users).
--
-- ── Qué hay ──────────────────────────────────────────────────────────────────
--   · `_cambios_de_contrasena` — un renglón por cambio real de contraseña
--     (user_id, cuándo, y cuándo se asentó en el registro de admins).
--   · `_contrasena_propia` — marca "esta cuenta puso su contraseña" (la escribe
--     `registrar_cambio_de_contrasena`; no se puede volver a "sin contraseña").
--   · `tengo_contrasena()` — ¿MI cuenta ya tiene una contraseña que conoce? Booleano,
--     nunca el hash. 🔴 `encrypted_password <> ''` NO alcanza: GoTrue le guarda un hash
--     ALEATORIO de 60 caracteres a toda cuenta creada sin contraseña (Admin API, magic
--     link, generate_link) — marcopolo@healthier.app lo tiene — así que se exige además:
--       a) un cambio real anotado por el trigger, o
--       b) la marca `_contrasena_propia`, o
--       c) (cuentas anteriores a esta migración, que no tienen anotación) una sesión
--          viva que nació con contraseña (`auth.mfa_amr_claims` = 'password').
--     Límite: una cuenta con contraseña real anterior a esta migración, con sólo sesiones
--     por magic link y que nunca la cambió, contesta false hasta que entre con ella.
--   · `registrar_cambio_de_contrasena()` — deja el asiento `cambio_de_contrasena` en
--     `admin_action_log` (migración 218). SÓLO asienta si hay un cambio real de la
--     contraseña de auth.uid() en los últimos 5 minutos que todavía no tenga asiento;
--     "primera vez" lo calcula el servidor (no existía contraseña antes de ese cambio).
--     Sin cambio reciente → error y nada asentado. Sólo administradores
--     (`_aal_actor_es_admin`).
-- ─────────────────────────────────────────────────────────────────────────────

-- Cuentas que pusieron su contraseña desde la pantalla (el "_" es a propósito: tabla
-- interna, no entra en la lista de segmentos de Sentry). Sólo la escribe el RPC.
create table if not exists public._contrasena_propia (
  user_id uuid primary key,
  desde   timestamptz not null default now()
);
alter table public._contrasena_propia enable row level security;
revoke all on public._contrasena_propia from public, anon, authenticated, service_role;

-- Un renglón por cambio real de contraseña. Sin FK a auth.users: sobrevive a la cuenta.
create table if not exists public._cambios_de_contrasena (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  created_at  timestamptz not null default now(),
  asentado_at timestamptz
);
create index if not exists idx_cambios_de_contrasena_user on public._cambios_de_contrasena (user_id, created_at desc);
alter table public._cambios_de_contrasena enable row level security;
revoke all on public._cambios_de_contrasena from public, anon, authenticated, service_role;

create or replace function public._anotar_cambio_de_contrasena()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public._cambios_de_contrasena (user_id) values (new.id);
  return null;
end;
$$;
revoke all on function public._anotar_cambio_de_contrasena() from public, anon, authenticated, service_role;

-- Sólo cuando el hash CAMBIA de verdad (no en cualquier UPDATE de la fila).
drop trigger if exists anotar_cambio_de_contrasena on auth.users;
create trigger anotar_cambio_de_contrasena
  after update of encrypted_password on auth.users
  for each row
  when (old.encrypted_password is distinct from new.encrypted_password
        and new.encrypted_password is not null and new.encrypted_password <> '')
  execute function public._anotar_cambio_de_contrasena();

-- ¿Tiene (la cuenta p_id) una contraseña que conoce? Interna: la pública usa auth.uid().
create or replace function public._tiene_contrasena(p_id uuid, p_antes_de timestamptz default null)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select coalesce(
    (select u.encrypted_password is not null and u.encrypted_password <> ''
            and (exists (select 1 from public._contrasena_propia c where c.user_id = u.id)
                 or exists (select 1 from public._cambios_de_contrasena x
                             where x.user_id = u.id and (p_antes_de is null or x.created_at < p_antes_de))
                 or exists (select 1
                              from auth.mfa_amr_claims a
                              join auth.sessions s on s.id = a.session_id
                             where s.user_id = u.id and a.authentication_method = 'password'))
       from auth.users u
      where u.id = p_id),
    false);
$$;
revoke all on function public._tiene_contrasena(uuid, timestamptz) from public, anon, authenticated, service_role;

create or replace function public.tengo_contrasena()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public._tiene_contrasena(auth.uid());
$$;

revoke all on function public.tengo_contrasena() from public, anon;
grant execute on function public.tengo_contrasena() to authenticated, service_role;

-- La versión anterior recibía `primera_vez` del cliente: ya no.
drop function if exists public.registrar_cambio_de_contrasena(boolean);

create or replace function public.registrar_cambio_de_contrasena()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := auth.uid();
  v_cambio  public._cambios_de_contrasena%rowtype;
  v_primera boolean;
begin
  if v_uid is null then
    raise exception 'Hace falta una sesión.' using errcode = '42501';
  end if;
  if not public._aal_actor_es_admin() then
    raise exception 'Sólo un administrador asienta el cambio de su contraseña.' using errcode = '42501';
  end if;

  -- El cambio más reciente (≤ 5 min) que todavía no tiene asiento. FOR UPDATE: dos
  -- llamadas en paralelo no pueden asentar el mismo cambio.
  select * into v_cambio
    from public._cambios_de_contrasena
   where user_id = v_uid and asentado_at is null and created_at > now() - interval '5 minutes'
   order by created_at desc
   limit 1
   for update;
  if not found then
    raise exception 'No hay un cambio de contraseña reciente para asentar.' using errcode = 'P0001';
  end if;

  -- Primera vez = antes de ese cambio la cuenta no tenía contraseña que conociera.
  v_primera := not public._tiene_contrasena(v_uid, v_cambio.created_at);

  update public._cambios_de_contrasena set asentado_at = now() where id = v_cambio.id;
  insert into public._contrasena_propia (user_id) values (v_uid) on conflict (user_id) do nothing;

  perform public._aal_escribir(
    null, 'cambio_de_contrasena', 'cuenta', v_uid::text, v_uid,
    jsonb_build_object('nota', case when v_primera then 'Puso su contraseña por primera vez' else 'Cambió su contraseña' end));
end;
$$;

revoke all on function public.registrar_cambio_de_contrasena() from public, anon;
grant execute on function public.registrar_cambio_de_contrasena() to authenticated, service_role;
