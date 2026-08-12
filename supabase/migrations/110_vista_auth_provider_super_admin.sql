-- El super admin quiere saber si un prospecto se registró con Google o con
-- email/contraseña directo. Ese dato vive en auth.users (raw_app_meta_data),
-- schema que PostgREST no expone. Esta vista sólo devuelve filas cuando quien
-- consulta es super_admin (mismo patrón que get_my_role()) — para cualquier
-- otro rol autenticado, el resultado es siempre vacío.
create or replace view public.auth_providers_super_admin as
select
  id,
  raw_app_meta_data->>'provider' as auth_provider
from auth.users
where public.get_my_role() = 'super_admin';

grant select on public.auth_providers_super_admin to authenticated;
