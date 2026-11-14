-- 239 — La baja también suelta los logins de Google/Apple (auth.identities).
--
-- La baja (delete-account desde la app, dar-de-baja-usuario desde el panel)
-- pasa el mail de auth.users a un alias y banea el usuario, pero la identidad
-- de Google/Apple seguía atada a ese usuario con el mail real. Resultado: quien
-- volvía a entrar con Google caía en la cuenta baneada y no podía registrarse
-- de nuevo (pazavalos.a@gmail.com, 2026-11-13).
--
-- Al soltarla, el próximo "Continuar con Google" crea una cuenta nueva. Si en
-- cambio la persona recupera la vieja (reactivar-cuenta le devuelve el mail y
-- una contraseña), Supabase le vuelve a vincular Google solo, por el mail.

create or replace function public.soltar_identidades_externas(p_user uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_borradas integer;
begin
  -- Sólo sobre cuentas ya dadas de baja: nunca le corta el login a una activa.
  if not exists (select 1 from public.profiles where id = p_user and deleted_at is not null) then
    raise exception 'La cuenta % no está dada de baja.', p_user using errcode = 'check_violation';
  end if;

  delete from auth.identities where user_id = p_user and provider <> 'email';
  get diagnostics v_borradas = row_count;
  return v_borradas;
end;
$$;

revoke all on function public.soltar_identidades_externas(uuid) from public, anon, authenticated;
grant execute on function public.soltar_identidades_externas(uuid) to service_role;

-- Las que ya estaban dadas de baja.
delete from auth.identities i
 using public.profiles p
 where p.id = i.user_id and p.deleted_at is not null and i.provider <> 'email';
