-- ============================================================
-- Migration 093 — Un usuario no puede cambiarse el rol a sí mismo
-- ============================================================
-- `profiles_update_own` es `USING (auth.uid() = id)`, sin `WITH CHECK` y sin
-- forma de limitar columnas: una policy de Postgres autoriza filas, no campos.
-- Con eso, cualquier usuario logueado podía hacer
--
--     PATCH /rest/v1/profiles?id=eq.<el suyo>   {"role": "super_admin"}
--
-- y quedar de super admin. No es explotable desde la UI (ninguna pantalla manda
-- `role` ni `email` en un update), pero sí desde la API con el token propio, que
-- vive en el browser de cualquier paciente. Encontrado el 2026-08-06.
--
-- El arreglo es un trigger, por lo mismo que existe la RPC
-- `complete_patient_rcta_data`: cuando lo que hay que limitar son **columnas**,
-- una policy no alcanza.
--
-- `email` va en la misma bolsa: es un espejo de `auth.users.email`, ninguna
-- pantalla lo edita, y `promote_user_to_admin` busca a quién promover
-- **por email** — dejarlo editable es dejar abierta una vía indirecta.
-- ============================================================

create or replace function public.impedir_autoascenso_de_rol()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.role is not distinct from old.role
     and new.email is not distinct from old.email then
    return new;                       -- update normal, nada que revisar
  end if;

  -- Sin JWT no hay usuario: es el service role (Edge Functions, backend) o una
  -- consola SQL. Ahí el control es de quién tiene la llave, no de este trigger.
  if auth.uid() is null then
    return new;
  end if;

  -- El super admin sí puede. Es el camino de `promote_user_to_admin`, que además
  -- valida por su cuenta. `get_my_role()` es SECURITY DEFINER: se puede llamar
  -- desde acá sin volver a chocar con las policies de `profiles`.
  if public.get_my_role() = 'super_admin' then
    return new;
  end if;

  raise exception 'No se puede cambiar el rol ni el email del perfil desde la aplicación.'
    using errcode = 'check_violation';
end;
$$;

drop trigger if exists impedir_autoascenso_de_rol on public.profiles;
create trigger impedir_autoascenso_de_rol
  before update on public.profiles
  for each row
  execute function public.impedir_autoascenso_de_rol();

comment on function public.impedir_autoascenso_de_rol() is
  'Bloquea cambios de `role` y `email` en profiles salvo que los haga un super_admin o el service role. Complementa a `profiles_update_own`, que autoriza la fila pero no puede limitar qué columnas se escriben.';
