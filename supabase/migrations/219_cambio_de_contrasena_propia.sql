-- ─────────────────────────────────────────────────────────────────────────────
-- Cambio de la contraseña propia del super admin (/super-admin/perfil).
--
-- Dos funciones, las dos para auth.uid() y nada más:
--
--   · `tengo_contrasena()` — ¿MI cuenta ya tiene una contraseña QUE CONOCE? La
--     pantalla la usa para pedir la actual sólo cuando existe (una cuenta que
--     entró siempre por magic link, como marcopolo@healthier.app, la pone sin ella).
--     Devuelve un booleano: nunca el hash ni nada de auth.users.
--     🔴 `encrypted_password <> ''` NO alcanza: GoTrue le guarda un hash ALEATORIO
--     de 60 caracteres a toda cuenta creada sin contraseña (Admin API, magic link,
--     generate_link), así que esa condición da "tiene" para marcopolo@ y la
--     dejaría sin poder ponerla (verificado en staging y producción, 2026-10-29).
--     Por eso además se exige una señal de que la persona la usó o la puso:
--       a) alguna sesión suya nació con contraseña (`auth.mfa_amr_claims` = 'password'), o
--       b) la puso por esta pantalla (`_contrasena_propia`, la escribe el RPC de abajo).
--     Límite conocido: una cuenta con contraseña real pero con sólo sesiones por
--     magic link y nunca cambiada acá contesta false (se cambia sin pedir la actual,
--     como hoy); en cuanto entra con la contraseña, o la cambia por esta pantalla,
--     pasa a true.
--
--   · `registrar_cambio_de_contrasena(primera_vez)` — deja el asiento
--     `cambio_de_contrasena` en `admin_action_log` (migración 218) con la
--     persona como actor. Sin el valor de la contraseña. El cambio en sí lo
--     hace GoTrue (`updateUser`), que no pasa por ninguna tabla nuestra, así
--     que el asiento lo pide el front DESPUÉS de que el cambio salió bien.
--     Sólo para admin / super_admin: cualquier otro rol recibe 42501.
--
-- Supabase Auth no pide la contraseña actual ni reautenticación en este
-- proyecto (config de staging y producción), por eso el chequeo de la actual
-- vive en el front (signInWithPassword con un cliente descartable).
-- ─────────────────────────────────────────────────────────────────────────────

-- Cuentas que pusieron su contraseña desde la pantalla (el "_" es a propósito: tabla interna, no entra en la lista de segmentos de Sentry). Sólo la escribe el RPC de
-- abajo (sin policies, sin permisos): una cuenta no puede volver a "sin contraseña".
create table if not exists public._contrasena_propia (
  user_id uuid primary key,
  desde   timestamptz not null default now()
);
alter table public._contrasena_propia enable row level security;
revoke all on public._contrasena_propia from public, anon, authenticated, service_role;

create or replace function public.tengo_contrasena()
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select coalesce(
    (select u.encrypted_password is not null and u.encrypted_password <> ''
            and (exists (select 1 from public._contrasena_propia c where c.user_id = u.id)
                 or exists (select 1
                              from auth.mfa_amr_claims a
                              join auth.sessions s on s.id = a.session_id
                             where s.user_id = u.id and a.authentication_method = 'password'))
       from auth.users u
      where u.id = auth.uid()),
    false);
$$;

revoke all on function public.tengo_contrasena() from public, anon;
grant execute on function public.tengo_contrasena() to authenticated, service_role;

create or replace function public.registrar_cambio_de_contrasena(p_primera_vez boolean default false)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Hace falta una sesión.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = v_uid and role in ('admin', 'super_admin')) then
    raise exception 'Sólo un administrador asienta el cambio de su contraseña.' using errcode = '42501';
  end if;

  insert into public._contrasena_propia (user_id) values (v_uid) on conflict (user_id) do nothing;

  perform public._aal_escribir(
    null, 'cambio_de_contrasena', 'cuenta', v_uid::text, v_uid,
    jsonb_build_object('nota', case when p_primera_vez then 'Puso su contraseña por primera vez' else 'Cambió su contraseña' end));
end;
$$;

revoke all on function public.registrar_cambio_de_contrasena(boolean) from public, anon;
grant execute on function public.registrar_cambio_de_contrasena(boolean) to authenticated, service_role;
