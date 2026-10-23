-- ═══════════════════════════════════════════════════════════════════════════
-- 217 · El alta sólo da rol de paciente o de profesional
-- ═══════════════════════════════════════════════════════════════════════════
-- Encontrado el 2026-10-23, probado contra staging por la API pública (con la
-- anon key, sin ninguna llave nuestra):
--
--   1. `crear_perfil_al_registrarse` (095/183) copiaba `raw_user_meta_data.role`
--      tal cual. Un `signUp` con `data: { role: 'super_admin' }` dejaba un
--      super admin. El control de la 094 sólo mira los UPDATE.
--   2. `profiles_insert_own` es `WITH CHECK (auth.uid() = id)`, sin mirar
--      columnas. Un `signUp` SIN rol (el camino de Google/Apple) no crea perfil,
--      y después un `POST /profiles` con `role: 'super_admin'` lo creaba igual.
--   3. `payment_exempt` (135) no tenía ningún control: cualquier paciente con su
--      propio token hacía `PATCH /profiles {payment_exempt: true}` y quedaba con
--      las consultas y los pedidos de farmacia bonificados.
--   4. `bloquear_autoverificacion` (097) es BEFORE UPDATE: un profesional que
--      todavía no tenía legajo lo insertaba con `is_verified: true`, y uno que
--      ya lo tenía podía borrarlo (la policy `prof_profiles_owner_write` es FOR
--      ALL) y volver a insertarlo — incluso saliendo de un rechazo permanente.
--   5. Lateral: la app manda `role: 'paciente'` (en castellano) en el signUp.
--      Con el trigger copiándolo tal cual, chocaba con `profiles_role_check` y
--      el alta por mail desde la app respondía 500.
--
-- Auditoría en producción (sólo lectura, 2026-10-23): roles altos = las 5
-- cuentas nuestras; `payment_exempt` = sólo la cuenta de Mateo; los 67
-- legajos verificados tienen origen (sisa/manual) y fecha. No se explotó.
--
-- Cómo queda — un rol alto se asigna SÓLO por:
--   · `promote_user_to_admin` (super admin, ya existía), o
--   · el service role: un `profiles.upsert` con la service key (lo que ya hacen
--     seed-despacho / seed-staging) o, al crear la cuenta por Admin API,
--     `app_metadata: { role: '<rol>' }` — el usuario no puede escribir su
--     `app_metadata`, sólo su `user_metadata`. Ojo: GoTrue inserta el usuario
--     con `app_metadata` = {provider, providers} y le escribe el resto DESPUÉS,
--     en la misma transacción; por eso el rol de `app_metadata` lo aplica un
--     trigger de UPDATE (sección 1b), no el del alta. Probado contra staging.
--
-- "Desde el cliente" = la sentencia la corre el rol `authenticated`/`anon` de
-- PostgREST. Los triggers nuevos son SECURITY INVOKER a propósito: así
-- `current_user` es quien escribe de verdad. Las funciones SECURITY DEFINER
-- nuestras (`crear_perfil_al_registrarse`, `_crear_cuenta_familiar`, …) corren
-- como `postgres` y siguen pasando; el service role también.
--
-- 🔴 Los upserts del cliente (`register()` en la web, `professionalService.upsert`
-- con el registro entero desde Configuración) disparan el BEFORE INSERT aunque
-- la fila ya exista. Si ahí se pisara `is_verified` con false, el ON CONFLICT
-- DO UPDATE lo copiaría y un profesional verificado se des-verificaría al
-- guardar su configuración. Por eso el control del INSERT sólo actúa cuando la
-- fila NO existe; si existe, la fila pasa al ON CONFLICT DO UPDATE y la cuidan
-- los controles del UPDATE (094 y los de las secciones 2 y 3 de acá).
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 1. El alta (trigger sobre auth.users) ────────────────────────────────────
-- La lista de roles que existen, en un solo lugar (además de profiles_role_check).
-- Un rol mal escrito ('emergency_crw') no se degrada en silencio: corta con error.
create or replace function public.rol_de_servidor_valido(p_rol text)
returns text
language plpgsql
immutable
set search_path = public
as $$
begin
  if p_rol is null or p_rol not in ('patient', 'professional', 'admin', 'super_admin',
                   'pharmacy_admin', 'pharmacy_operator', 'pharmacy_readonly',
                   'emergency_admin', 'emergency_operator', 'emergency_crew') then
    raise exception 'Rol inválido: %', p_rol using errcode = 'check_violation';
  end if;
  return p_rol;
end;
$$;

-- El INSERT de profiles desde auth.users, compartido por el alta y por el rol
-- de servidor. Una cuenta que no es paciente arranca sin bienvenida (el mail es
-- para pacientes) y sin el onboarding de paciente.
create or replace function public._perfil_desde_auth(
  p_id uuid, p_email text, p_meta jsonb, p_rol text, p_es_staff boolean, p_pisar_rol boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, first_name, last_name, role,
                               mail_bienvenida_enviado_at, requiere_onboarding)
  values (
    p_id,
    p_email,
    nullif(trim(coalesce(p_meta->>'full_name', '')), ''),
    nullif(trim(coalesce(p_meta->>'first_name', '')), ''),
    nullif(trim(coalesce(p_meta->>'last_name', '')), ''),
    p_rol,
    case when p_es_staff then now() end,
    case when p_es_staff then false end      -- null = lo decide marcar_paciente_nuevo
  )
  on conflict (id) do nothing;

  if p_pisar_rol then
    update public.profiles
       set role = p_rol,
           requiere_onboarding = case when p_rol = 'patient' then requiere_onboarding else false end
     where id = p_id and role is distinct from p_rol;
  end if;
end;
$$;

revoke all on function public._perfil_desde_auth(uuid, text, jsonb, text, boolean, boolean) from public, anon, authenticated;

create or replace function public.crear_perfil_al_registrarse()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- `app_metadata` sólo lo escribe el service role. En un alta por GoTrue llega
  -- sin rol (ver cabecera); sólo trae rol en un INSERT directo por SQL.
  v_rol_servidor text := nullif(trim(coalesce(new.raw_app_meta_data->>'role', '')), '');
  v_rol_cliente  text := nullif(trim(coalesce(new.raw_user_meta_data->>'role', '')), '');
begin
  if v_rol_servidor is not null then
    v_rol_servidor := public.rol_de_servidor_valido(v_rol_servidor);
    perform public._perfil_desde_auth(new.id, new.email, new.raw_user_meta_data, v_rol_servidor,
                                      v_rol_servidor not in ('patient', 'professional'), false);
  elsif v_rol_cliente is null then
    null;  -- Google u otro OAuth: el rol lo elige después. Ver la migración 095.
  elsif v_rol_cliente in ('patient', 'professional') then
    perform public._perfil_desde_auth(new.id, new.email, new.raw_user_meta_data, v_rol_cliente, false, false);
  elsif v_rol_cliente = 'paciente' then  -- la app lo manda en castellano
    perform public._perfil_desde_auth(new.id, new.email, new.raw_user_meta_data, 'patient', false, false);
  else
    -- Pidió un rol que el alta no da ('super_admin', 'pharmacy_admin', …). Queda
    -- paciente, sin bienvenida ni onboarding: o es alguien probando la API, o es
    -- una cuenta de staff creada por Admin API a la que el service role le pone
    -- el rol enseguida (seed-despacho, seed-staging).
    perform public._perfil_desde_auth(new.id, new.email, new.raw_user_meta_data, 'patient', true, false);
  end if;
  return new;
end;
$$;

comment on function public.crear_perfil_al_registrarse() is
  'Alta: crea profiles desde auth.users. Del user_metadata (lo manda el cliente) sólo acepta patient/professional (y ''paciente'' de la app); cualquier otro valor queda patient, sin bienvenida ni onboarding. Un rol alto viene sólo de app_metadata.role (service role), que aplica sincronizar_rol_de_servidor. Migración 217.';


-- ── 1b. El rol que pone el service role en app_metadata ──────────────────────
create or replace function public.sincronizar_rol_de_servidor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rol text := nullif(trim(coalesce(new.raw_app_meta_data->>'role', '')), '');
begin
  if v_rol is null then
    return new;
  end if;
  v_rol := public.rol_de_servidor_valido(v_rol);
  perform public._perfil_desde_auth(new.id, new.email, new.raw_user_meta_data, v_rol,
                                    v_rol not in ('patient', 'professional'), true);
  return new;
end;
$$;

comment on function public.sincronizar_rol_de_servidor() is
  'Cuando el service role escribe app_metadata.role (Admin API createUser/updateUserById), lo lleva a profiles.role. El usuario no puede escribir su app_metadata. Migración 217.';

drop trigger if exists sincronizar_rol_de_servidor on auth.users;
create trigger sincronizar_rol_de_servidor
  after update of raw_app_meta_data on auth.users
  for each row
  when ((new.raw_app_meta_data->>'role') is distinct from (old.raw_app_meta_data->>'role'))
  execute function public.sincronizar_rol_de_servidor();


-- ── 2. profiles: lo que el cliente no escribe ────────────────────────────────
-- El trigger de abajo es SECURITY INVOKER (necesita el current_user real), y
-- `authenticated` no puede leer auth.users: este helper le da el email de la
-- cuenta sin depender de que el JWT traiga el claim.
create or replace function public.email_de_mi_cuenta()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select email from auth.users where id = auth.uid();
$$;

revoke all on function public.email_de_mi_cuenta() from public, anon;
grant execute on function public.email_de_mi_cuenta() to authenticated;

create or replace function public.blindar_perfil_desde_el_cliente()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  -- Service role, consola SQL o una función SECURITY DEFINER nuestra.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- Upsert sobre una fila que ya existe: decide el UPDATE (ver cabecera). El
    -- email se deja como está: register() lo manda como lo tipeó la persona
    -- ('Juan@Gmail.com') y GoTrue lo guardó en minúsculas; con eso la 094
    -- cortaba el alta por "cambio de email".
    if exists (select 1 from public.profiles where id = new.id) then
      select email into new.email from public.profiles where id = new.id;
      return new;
    end if;

    if coalesce(new.role, 'patient') not in ('patient', 'professional') then
      raise exception 'Ese tipo de cuenta lo asigna sólo Healthier.'
        using errcode = '42501';
    end if;

    -- El email es el de la cuenta, no el que mande el cliente: promote_user_to_admin
    -- busca por email y la 094 ya lo trata como campo sensible (sólo en el UPDATE).
    new.email := public.email_de_mi_cuenta();
    new.payment_exempt := false;
    new.titular_id := null;               -- los familiares los crea _crear_cuenta_familiar
    new.requiere_onboarding := null;      -- lo decide marcar_paciente_nuevo
    new.federador_id := null;
    new.federador_estado := null;
    new.federador_actualizado_at := null;
    new.federador_intentos := 0;
    new.federador_proximo_intento := null;
    new.federador_error := null;
    -- es_prueba / ve_ambos_mundos: ya los cuida profiles_marca_de_prueba.
    return new;
  end if;

  -- UPDATE. El rol y el email los cuida impedir_autoascenso_de_rol (094).
  -- Estos dos no tiran error, se conservan: un cliente que reenvía el perfil
  -- entero no tiene que romper el "guardar". Sólo el super admin, igual que
  -- es_prueba / ve_ambos_mundos (profiles_marca_de_prueba).
  if (new.payment_exempt is distinct from old.payment_exempt
      or new.titular_id is distinct from old.titular_id)
     and coalesce(public.get_my_role(), '') <> 'super_admin' then
    new.payment_exempt := old.payment_exempt;
    new.titular_id := old.titular_id;
  end if;
  return new;
end;
$$;

comment on function public.blindar_perfil_desde_el_cliente() is
  'profiles, escrito por authenticated/anon: el INSERT de una fila nueva sólo acepta rol patient/professional y arranca sin payment_exempt, titular ni datos del Federador; en el UPDATE payment_exempt y titular_id sólo los cambia un super admin. Migración 217.';

-- El nombre empieza con "b" a propósito: los BEFORE corren en orden alfabético
-- y éste tiene que correr antes que marcar_paciente_nuevo y compañía.
drop trigger if exists blindar_perfil_desde_el_cliente on public.profiles;
create trigger blindar_perfil_desde_el_cliente
  before insert or update on public.profiles
  for each row
  execute function public.blindar_perfil_desde_el_cliente();


-- ── 3. professional_profiles: el legajo nace sin verificar ───────────────────
create or replace function public.legajo_nace_sin_verificar()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  -- El latido de presencia y los guardados comunes no tocan nada de esto: se
  -- salen sin consultar el rol.
  if tg_op = 'UPDATE'
     and (new.mp_connected, new.mp_account_label, new.average_rating, new.total_reviews,
          new.verification_source, new.verified_at, new.verified_by, new.sisa_status,
          new.sisa_matricula, new.sisa_raw, new.sisa_verified_at, new.has_signature)
         is not distinct from
         (old.mp_connected, old.mp_account_label, old.average_rating, old.total_reviews,
          old.verification_source, old.verified_at, old.verified_by, old.sisa_status,
          old.sisa_matricula, old.sisa_raw, old.sisa_verified_at, old.has_signature) then
    return new;
  end if;

  if public.es_operador_de_plataforma() then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'El legajo profesional no se puede borrar desde la aplicación. Contactá a Healthier.'
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' then
    -- Lo que escriben sólo Healthier, sisa-verify, mp-connect o sync_has_signature.
    -- Se conserva sin error (Configuración reenvía el legajo entero). Que
    -- is_verified no pase a true lo cuida bloquear_autoverificacion; a false sí
    -- puede pasar a propósito (el onboarding lo manda al reenviar el legajo para
    -- volver a revisión), igual que el rechazo, así que ésos no se congelan.
    new.mp_connected := old.mp_connected;
    new.mp_account_label := old.mp_account_label;
    new.average_rating := old.average_rating;
    new.total_reviews := old.total_reviews;
    new.verification_source := old.verification_source;
    new.verified_at := old.verified_at;
    new.verified_by := old.verified_by;
    new.sisa_status := old.sisa_status;
    new.sisa_matricula := old.sisa_matricula;
    new.sisa_raw := old.sisa_raw;
    new.sisa_verified_at := old.sisa_verified_at;
    new.has_signature := old.has_signature;
    return new;
  end if;

  -- Upsert sobre un legajo que ya existe: decide el UPDATE (ver cabecera).
  if exists (select 1 from public.professional_profiles where user_id = new.user_id) then
    return new;
  end if;

  new.is_verified := false;
  new.is_active := false;
  new.verified_at := null;
  new.verified_by := null;
  new.verification_source := null;
  new.sisa_status := null;
  new.sisa_matricula := null;
  new.sisa_raw := null;
  new.sisa_verified_at := null;
  new.rejection_reason := null;
  new.rejection_type := null;
  new.rejected_at := null;
  new.reverification_pending := false;
  new.reverification_requested_at := null;
  new.reverification_changes := null;
  new.average_rating := 0;
  new.total_reviews := 0;
  new.mp_connected := false;
  new.mp_account_label := null;
  new.dado_de_baja := false;
  new.mail_verificacion_enviado_at := null;
  new.has_signature := false;
  new.refes_id := null;
  new.refes_estado := null;
  new.refes_nombre := null;
  new.refes_raw := null;
  new.refes_actualizado_at := null;
  new.refes_intentos := 0;
  new.refes_proximo_intento := null;
  new.refes_error := null;
  new.refes_revisado_por := null;
  new.refes_revisado_at := null;
  return new;
end;
$$;

comment on function public.legajo_nace_sin_verificar() is
  'professional_profiles, escrito por authenticated/anon: un legajo nuevo arranca sin verificar, sin rating, sin MP y sin estados del ministerio; en el UPDATE MP, rating, verificación y SISA se conservan; el legajo no se borra desde la app (borrar y re-insertar salteaba la verificación y el rechazo permanente). Admin/super admin y service role pasan. Migración 217.';

drop trigger if exists legajo_nace_sin_verificar on public.professional_profiles;
create trigger legajo_nace_sin_verificar
  before insert or update or delete on public.professional_profiles
  for each row
  execute function public.legajo_nace_sin_verificar();


-- ── 4. promote_user_to_admin: promueve LA cuenta de ese mail, no todo perfil ──
-- que diga ese mail. `profiles.email` no es único (los familiares llevan el
-- contacto del titular), así que el UPDATE por email promovía también a los
-- familiares. Se resuelve por auth.users, que sí es único, y si no existe la
-- cuenta se avisa en vez de no hacer nada en silencio.
create or replace function public.promote_user_to_admin(target_email text, new_role text default 'admin'::text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
begin
  if not exists (
    select 1 from profiles where id = auth.uid() and role = 'super_admin'
  ) then
    raise exception 'only super_admin can promote';
  end if;
  perform public.rol_de_servidor_valido(new_role);

  begin
    select id into strict v_id from auth.users where lower(email) = lower(trim(target_email));
  exception
    when no_data_found then
      raise exception 'No hay ninguna cuenta con el mail %.', target_email using errcode = 'no_data_found';
    when too_many_rows then
      raise exception 'Hay más de una cuenta con el mail %: cambiá el rol desde la base.', target_email;
  end;

  update profiles set role = new_role where id = v_id;
  if not found then
    raise exception 'La cuenta % todavía no completó el registro (no tiene perfil).', target_email using errcode = 'no_data_found';
  end if;
end;
$$;
