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
--     `app_metadata`, sólo su `user_metadata`.
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
-- fila NO existe; si existe, lo cuidan los controles del UPDATE.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 1. El alta (trigger sobre auth.users) ────────────────────────────────────
create or replace function public.crear_perfil_al_registrarse()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- `app_metadata` sólo lo escribe el service role (Admin API). Lo que manda el
  -- cliente en el signUp cae en `user_metadata`.
  v_rol_servidor text := nullif(trim(coalesce(new.raw_app_meta_data->>'role', '')), '');
  v_rol_cliente  text := nullif(trim(coalesce(new.raw_user_meta_data->>'role', '')), '');
  v_rol          text;
begin
  if v_rol_servidor is null and v_rol_cliente is null then
    return new;  -- Google u otro OAuth: el rol lo elige después. Ver la migración 095.
  end if;

  if v_rol_servidor in ('patient', 'professional', 'admin', 'super_admin',
                        'pharmacy_admin', 'pharmacy_operator', 'pharmacy_readonly',
                        'emergency_admin', 'emergency_operator', 'emergency_crew') then
    v_rol := v_rol_servidor;
  elsif v_rol_cliente in ('patient', 'professional') then
    v_rol := v_rol_cliente;
  else
    -- Cualquier otra cosa ('super_admin', 'paciente' de la app, basura): paciente.
    v_rol := 'patient';
  end if;

  insert into public.profiles (id, email, full_name, first_name, last_name, role)
  values (
    new.id,
    new.email,
    nullif(trim(coalesce(new.raw_user_meta_data->>'full_name', '')), ''),
    nullif(trim(coalesce(new.raw_user_meta_data->>'first_name', '')), ''),
    nullif(trim(coalesce(new.raw_user_meta_data->>'last_name', '')), ''),
    v_rol
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

comment on function public.crear_perfil_al_registrarse() is
  'Alta: crea profiles desde auth.users. Del user_metadata (lo manda el cliente) sólo acepta patient/professional; cualquier otro valor queda patient. Un rol alto viene sólo de app_metadata.role (Admin API / service role). Migración 217.';


-- ── 2. profiles: lo que el cliente no escribe ────────────────────────────────
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
    -- Upsert sobre una fila que ya existe: decide el UPDATE (ver cabecera).
    if exists (select 1 from public.profiles where id = new.id) then
      return new;
    end if;

    if coalesce(new.role, 'patient') not in ('patient', 'professional') then
      raise exception 'Ese tipo de cuenta lo asigna sólo Healthier.'
        using errcode = '42501';
    end if;

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
  -- entero no tiene que romper el "guardar".
  if coalesce(public.get_my_role(), '') <> 'super_admin' then
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
  if current_user not in ('authenticated', 'anon') or public.es_operador_de_plataforma() then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'El legajo profesional no se puede borrar desde la aplicación. Contactá a Healthier.'
      using errcode = '42501';
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
  'professional_profiles, escrito por authenticated/anon: un legajo nuevo arranca sin verificar, sin rating, sin MP y sin estados del ministerio; el legajo no se borra desde la app (borrar y re-insertar salteaba la verificación y el rechazo permanente). Admin/super admin y service role pasan. Migración 217.';

drop trigger if exists legajo_nace_sin_verificar on public.professional_profiles;
create trigger legajo_nace_sin_verificar
  before insert or delete on public.professional_profiles
  for each row
  execute function public.legajo_nace_sin_verificar();
