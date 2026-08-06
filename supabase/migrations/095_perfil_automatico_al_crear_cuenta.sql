-- ⚠️ Renumerada de 082_perfil_automatico_al_crear_cuenta.sql a 095_perfil_automatico_al_crear_cuenta.sql el 2026-08-06.
-- El archivo original se escribió en el worktree `fix-alta-cuenta-y-obra-social`,
-- que nunca se mergeó a main: el SQL sí llegó a producción pero ni el archivo ni
-- el registro en `supabase_migrations` quedaron en el repo. Todo lo de abajo es
-- idempotente y ya está aplicado — esta migración sólo devuelve el historial a
-- un estado reproducible. Ver la regla de huérfanas en CLAUDE.md.

-- ─────────────────────────────────────────────────────────────────────────────
-- El perfil se crea junto con la cuenta, no después y desde el navegador.
--
-- Mateo (2026-07-31): "dejó de funcionar el crear cuenta… ¿cómo prevenimos que
-- esto pase? lo intenté con principitodps@gmail.com — ¿ya tenía cuenta?".
--
-- Sí tenía, desde el 17 de julio. Pero era media cuenta: existía en `auth.users`
-- y NO tenía fila en `profiles`. Con eso la app no puede hacer nada —no hay rol,
-- no hay nombre, no hay a dónde mandarlo— y al intentar registrarse de nuevo
-- Supabase contesta que el mail ya existe. Se ve como "el alta dejó de
-- funcionar" cuando en realidad nunca había terminado.
--
-- No era un caso aislado: hay 4 usuarios de auth sin perfil (2026-05-04,
-- 2026-07-03 ×2, 2026-07-23). No se reparan acá: son cuentas de prueba y se van
-- con la limpieza de la semana que viene. Lo que sobrevive a la limpieza es el
-- código que las produce, que es lo que arregla esta migración.
--
-- La causa es estructural: `authService.register` hace dos pasos desde el browser
--   1. supabase.auth.signUp()   → crea la cuenta
--   2. insert into profiles     → crea el perfil
-- y entre los dos no hay transacción. Si el segundo falla —RLS, red, el usuario
-- cierra la pestaña, un error de validación— la cuenta queda creada y el perfil
-- no. Y no se puede reintentar: el segundo intento muere en el paso 1 con "email
-- already registered". El navegador no es un lugar donde se pueda garantizar que
-- dos escrituras ocurran juntas.
--
-- Este trigger mueve el paso 2 a la base, donde sí es atómico con la creación de
-- la cuenta. El cliente sigue escribiendo lo suyo (UTMs, teléfono), pero como
-- UPDATE sobre una fila que ya existe: si eso falla se pierde la atribución de
-- marketing, no la cuenta.
--
-- ⚠️ Sólo aplica al alta con mail y contraseña, y por eso mira que venga un
-- `role` explícito en el metadata. Con Google no viene ninguno, y ahí el perfil
-- NO se debe crear todavía: `App.jsx` decide mostrar la pantalla de completar
-- registro con `authUser && !profile`. Si esta función le creara el perfil a un
-- usuario de Google, esa pantalla no aparecería nunca y todo el que entre con
-- Google quedaría como paciente sin poder elegir profesional. El alta con Google
-- además se auto-repara —si el insert falla, el próximo login lo manda otra vez
-- a completar registro—, así que no tiene el problema que arregla esto.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.crear_perfil_al_registrarse()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.raw_user_meta_data->>'role', '') = '' then
    return new;  -- Google u otro OAuth: el rol lo elige después. Ver comentario arriba.
  end if;

  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    nullif(trim(coalesce(new.raw_user_meta_data->>'full_name', '')), ''),
    new.raw_user_meta_data->>'role'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists crear_perfil_al_registrarse on auth.users;
create trigger crear_perfil_al_registrarse
  after insert on auth.users
  for each row execute function public.crear_perfil_al_registrarse();

comment on function public.crear_perfil_al_registrarse is
  'Crea la fila de profiles junto con la cuenta en el alta con mail. Antes lo hacía el navegador en un segundo paso sin transacción, y cuando fallaba quedaba una cuenta sin perfil: imposible de usar e imposible de volver a registrar. No corre para OAuth a propósito — ver el comentario de la migración 082.';

-- ── Tokens en NULL: rompen el listado de usuarios de GoTrue ──────────────────
-- Aparte del alta, y encontrado mientras se investigaba esto: hoy
-- `GET /auth/v1/admin/users` devuelve 500 "Database error finding users".
-- La causa son 10 profesionales demo sembrados el 2026-06-11 con INSERT directo
-- en auth.users, sin pasar por GoTrue, que dejaron estas columnas en NULL; GoTrue
-- las escanea a un string de Go y explota. La migración 005 ya había hecho esta
-- misma reparación una vez y el seed posterior la reintrodujo: si hace falta
-- volver a sembrar usuarios, tiene que ser por la API de auth, no con INSERT.
update auth.users set
  confirmation_token         = coalesce(confirmation_token, ''),
  recovery_token             = coalesce(recovery_token, ''),
  email_change               = coalesce(email_change, ''),
  email_change_token_new     = coalesce(email_change_token_new, ''),
  email_change_token_current = coalesce(email_change_token_current, ''),
  reauthentication_token     = coalesce(reauthentication_token, '')
where confirmation_token is null
   or recovery_token is null
   or email_change is null
   or email_change_token_new is null
   or email_change_token_current is null
   or reauthentication_token is null;
