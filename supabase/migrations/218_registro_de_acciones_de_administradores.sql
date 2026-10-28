-- ─────────────────────────────────────────────────────────────────────────────
-- Registro de acciones de administradores (convenio RENAPER, 2026-10-28).
--
-- El Manual de Seguridad (declaración jurada) dice que las acciones de los
-- administradores —altas, bajas, cambios de rol, verificación de profesionales—
-- quedan registradas con usuario, fecha y hora, se conservan como mínimo 2 años
-- y no se pueden modificar ni borrar. Hasta ahora sólo había rastros sueltos
-- (professional_verification_log, impersonation_log, bajas_de_usuarios), cada
-- uno escrito por el front o por una Edge Function, sin lugar único para
-- auditar y sin garantía de que no se editaran.
--
-- Esta migración crea UNA tabla, `admin_action_log`, y la puebla con TRIGGERS
-- de la base: no depende de que el front se acuerde de escribir el asiento, y
-- un cambio hecho por la API, por una Edge Function o por SQL queda igual.
--
--   · Quién: auth.uid() (+ rol, mail y nombre congelados al momento). Si el
--     cambio lo hizo el servidor (service role / consola) sin una persona detrás,
--     `via = 'servidor'` y el actor sale de la columna de la fila que ya lo
--     guarda (verified_by, deleted_by, refund_reviewed_by…) cuando existe.
--   · Qué: `action` + `entity_type`/`entity_id` + `detail` con antes/después
--     MÍNIMOS (sólo lo que cambió; nada de contenido clínico; textos cortados).
--   · Sin FK a profiles: el asiento tiene que sobrevivir a cualquier cosa que
--     le pase al perfil (un ON DELETE CASCADE/SET NULL sería un borrado/UPDATE).
--
-- Append-only: triggers BEFORE UPDATE/DELETE/TRUNCATE que tiran excepción para
-- cualquier rol (también service_role y el dueño), además de revocar los
-- permisos de escritura. Lo único que puede escribir es una función SECURITY
-- DEFINER nuestra (los triggers de abajo). Residual: un superusuario de
-- Postgres puede desactivar el trigger o dropear la tabla; eso queda cubierto
-- por los backups de Supabase y por el procedimiento de acceso a la consola.
--
-- Retención: ≥ 2 años. No existe ninguna rutina de purga y no debe agregarse
-- una que borre filas con menos de 2 años (el trigger igual la frenaría).
--
-- Lo que se registra (action):
--   alta_de_cuenta · cambio_de_rol · baja_de_cuenta · reactivacion_de_cuenta ·
--   eliminacion_de_perfil · edicion_de_perfil_por_admin · cambio_de_exencion_o_titular ·
--   cambio_de_marca_de_prueba · verificacion_profesional · rechazo_profesional ·
--   cambio_de_estado_de_profesional · decision_consultorio · iniciar_sesion_como ·
--   devolucion_aprobada · devolucion_rechazada · devolucion_forzada ·
--   conversion_de_credito_a_mp · cambio_de_comision ·
--   alta/modificacion/eliminacion de configuración (platform_settings, zones,
--   specialties, vertical_settings, cobertura_rnos, emergency_providers y su
--   personal, ambulances, ambulance_crew, pharmacies, farmacia_drogas_bajo_receta) y borrados hechos por el super admin
--   (payments, emergencies, medication_orders, rcta_issue_log, waitlist).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. La tabla ──────────────────────────────────────────────────────────────
create table if not exists public.admin_action_log (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  -- Quién (congelado al momento; sin FK a propósito, ver cabecera).
  actor_id       uuid,
  actor_role     text,
  actor_email    text,
  actor_name     text,
  -- 'usuario' = lo hizo una persona con su sesión; 'servidor' = service role /
  -- consola, sin sesión de persona detrás.
  via            text not null check (via in ('usuario', 'servidor')),
  -- Qué
  action         text not null,
  entity_type    text not null,
  entity_id      text,
  -- Sobre quién (cuando la acción recae sobre una persona).
  target_user_id uuid,
  target_label   text,
  -- {antes, despues} mínimos. Nunca contenido clínico.
  detail         jsonb not null default '{}'::jsonb
);

comment on table public.admin_action_log is
  'Registro append-only de acciones de administradores (altas, bajas, cambios de rol, verificación de profesionales, configuración). Poblado por triggers; sin UPDATE/DELETE/TRUNCATE para nadie. Retención mínima 2 años. Migración 218.';

create index if not exists idx_aal_created_at on public.admin_action_log (created_at desc);
create index if not exists idx_aal_actor      on public.admin_action_log (actor_id, created_at desc);
create index if not exists idx_aal_target     on public.admin_action_log (target_user_id, created_at desc);
create index if not exists idx_aal_action     on public.admin_action_log (action, created_at desc);

-- ── 2. Inmutable ─────────────────────────────────────────────────────────────
create or replace function public.admin_action_log_inmutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'El registro de acciones de administradores no se modifica ni se borra (retención mínima 2 años).'
    using errcode = '42501';
end;
$$;

drop trigger if exists admin_action_log_no_update on public.admin_action_log;
create trigger admin_action_log_no_update
  before update on public.admin_action_log
  for each row execute function public.admin_action_log_inmutable();

drop trigger if exists admin_action_log_no_delete on public.admin_action_log;
create trigger admin_action_log_no_delete
  before delete on public.admin_action_log
  for each row execute function public.admin_action_log_inmutable();

drop trigger if exists admin_action_log_no_truncate on public.admin_action_log;
create trigger admin_action_log_no_truncate
  before truncate on public.admin_action_log
  for each statement execute function public.admin_action_log_inmutable();

-- ── 3. Permisos y RLS: sólo el super admin lee, nadie escribe a mano ─────────
alter table public.admin_action_log enable row level security;

drop policy if exists "aal_super_admin_read" on public.admin_action_log;
create policy "aal_super_admin_read"
  on public.admin_action_log for select
  using (public.get_my_role() = 'super_admin');

revoke all on public.admin_action_log from public, anon, authenticated, service_role;
grant select on public.admin_action_log to authenticated, service_role;

-- ── 4. Helpers (no se exponen por la API) ────────────────────────────────────
create or replace function public._aal_cols_cambiadas(p_old jsonb, p_new jsonb)
returns text[]
language sql
immutable
as $$
  select coalesce(array_agg(k order by k), '{}'::text[])
    from jsonb_object_keys(p_new) k
   where k <> 'updated_at'
     and (p_old -> k) is distinct from (p_new -> k);
$$;

-- Un valor largo (texto libre, arrays de imágenes) se corta: el asiento dice
-- QUÉ cambió, no copia contenido.
create or replace function public._aal_valor_corto(j jsonb)
returns jsonb
language sql
immutable
as $$
  select case
    when j is null then null
    when jsonb_typeof(j) = 'string' and length(j #>> '{}') > 200 then to_jsonb(left(j #>> '{}', 200) || '…')
    when jsonb_typeof(j) in ('object', 'array') and length(j::text) > 300 then to_jsonb(left(j::text, 200) || '…')
    else j
  end;
$$;

create or replace function public._aal_diff(p_old jsonb, p_new jsonb, p_solo text[] default null)
returns jsonb
language sql
immutable
as $$
  select coalesce(jsonb_object_agg(k, jsonb_build_object(
           'antes',   public._aal_valor_corto(p_old -> k),
           'despues', public._aal_valor_corto(p_new -> k))), '{}'::jsonb)
    from unnest(public._aal_cols_cambiadas(p_old, p_new)) k
   where p_solo is null or k = any (p_solo);
$$;

-- El único punto de escritura. Resuelve el actor y arma el asiento.
create or replace function public._aal_escribir(
  p_actor_alternativo uuid,
  p_action            text,
  p_entity_type       text,
  p_entity_id         text,
  p_target            uuid,
  p_detail            jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_actor uuid := coalesce(auth.uid(), p_actor_alternativo);
  v_rol   text;
  v_mail  text;
  v_nombre text;
  v_label text;
begin
  if v_actor is not null then
    select role, email, full_name into v_rol, v_mail, v_nombre
      from public.profiles where id = v_actor;
  end if;
  if p_target is not null then
    select coalesce(nullif(full_name, ''), email) into v_label
      from public.profiles where id = p_target;
  end if;

  insert into public.admin_action_log
    (actor_id, actor_role, actor_email, actor_name, via, action,
     entity_type, entity_id, target_user_id, target_label, detail)
  values
    (v_actor, v_rol, v_mail, v_nombre,
     case when v_uid is not null then 'usuario' else 'servidor' end,
     p_action, p_entity_type, p_entity_id, p_target, v_label,
     coalesce(p_detail, '{}'::jsonb));
end;
$$;

revoke all on function public._aal_escribir(uuid, text, text, text, uuid, jsonb) from public, anon, authenticated, service_role;

-- Roles de administración: los dos de la plataforma y el admin de cada tenant
-- (emergencias, farmacia), que dan de alta y baja a su propio personal.
-- ¿Esta cuenta tiene un rol de administración?
create or replace function public._aal_id_es_admin(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_id is not null and exists (
    select 1 from public.profiles
     where id = p_id and role in ('admin', 'super_admin', 'emergency_admin', 'pharmacy_admin')
  );
$$;

revoke all on function public._aal_id_es_admin(uuid) from public, anon, authenticated, service_role;

-- ¿La persona que hace el cambio (la sesión) es administradora?
create or replace function public._aal_actor_es_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null and public._aal_id_es_admin(auth.uid());
$$;

revoke all on function public._aal_actor_es_admin() from public, anon, authenticated, service_role;
-- Esta sí se concede: el WHEN de los triggers de consultations y professional_profiles
-- se evalúa con los permisos de quien escribe (paciente, profesional…). Sólo
-- contesta si LA PROPIA sesión es de un administrador: no revela nada de nadie más.
grant execute on function public._aal_actor_es_admin() to anon, authenticated, service_role;

-- ── 5. profiles: altas, bajas, cambios de rol, edición por un admin ──────────
create or replace function public.registrar_admin_profiles()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cols  text[];
begin
  if tg_op = 'INSERT' then
    if new.role in ('admin', 'super_admin') or public._aal_actor_es_admin() then
      perform public._aal_escribir(null, 'alta_de_cuenta', 'profiles', new.id::text, new.id,
        jsonb_build_object('rol', new.role));
    end if;
    return null;
  end if;

  if tg_op = 'DELETE' then
    perform public._aal_escribir(null, 'eliminacion_de_perfil', 'profiles', old.id::text, old.id,
      jsonb_build_object('rol', old.role));
    return null;
  end if;

  -- UPDATE
  if new.role is distinct from old.role then
    perform public._aal_escribir(null, 'cambio_de_rol', 'profiles', new.id::text, new.id,
      jsonb_build_object('antes', old.role, 'despues', new.role));
  end if;

  -- Sólo cuando la hace un administrador (la baja del panel entra por service
  -- role con `deleted_by` = el admin). La que se hace la propia persona
  -- (delete-account) y la reactivación por el link del mail no son acciones
  -- de administración: no se asientan acá.
  if old.deleted_at is null and new.deleted_at is not null then
    if coalesce(auth.uid(), new.deleted_by) is distinct from new.id
       and public._aal_id_es_admin(coalesce(auth.uid(), new.deleted_by)) then
      perform public._aal_escribir(new.deleted_by, 'baja_de_cuenta', 'profiles', new.id::text, new.id,
        jsonb_build_object('rol', new.role));
    end if;
  elsif old.deleted_at is not null and new.deleted_at is null then
    if auth.uid() is distinct from new.id and public._aal_actor_es_admin() then
      perform public._aal_escribir(null, 'reactivacion_de_cuenta', 'profiles', new.id::text, new.id,
        jsonb_build_object('rol', new.role));
    end if;
  end if;

  if (new.payment_exempt is distinct from old.payment_exempt
      or new.titular_id is distinct from old.titular_id) and public._aal_actor_es_admin() then
    perform public._aal_escribir(null, 'cambio_de_exencion_o_titular', 'profiles', new.id::text, new.id,
      jsonb_build_object(
        'payment_exempt', jsonb_build_object('antes', old.payment_exempt, 'despues', new.payment_exempt),
        'titular_id',     jsonb_build_object('antes', old.titular_id,     'despues', new.titular_id)));
  end if;

  if (new.es_prueba is distinct from old.es_prueba
      or new.ve_ambos_mundos is distinct from old.ve_ambos_mundos) and public._aal_actor_es_admin() then
    perform public._aal_escribir(null, 'cambio_de_marca_de_prueba', 'profiles', new.id::text, new.id,
      jsonb_build_object(
        'es_prueba',       jsonb_build_object('antes', old.es_prueba,       'despues', new.es_prueba),
        've_ambos_mundos', jsonb_build_object('antes', old.ve_ambos_mundos, 'despues', new.ve_ambos_mundos)));
  end if;

  -- Un admin editando el perfil de OTRA persona: se anotan los nombres de las
  -- columnas (no los valores: son datos personales). El rol, la baja y la
  -- exención ya tienen su propio asiento arriba.
  if auth.uid() is not null and auth.uid() <> new.id and public._aal_actor_es_admin() then
    v_cols := array(
      select c from unnest(public._aal_cols_cambiadas(to_jsonb(old), to_jsonb(new))) c
       where c not in ('role', 'deleted_at', 'deleted_by', 'payment_exempt', 'titular_id',
                       'es_prueba', 've_ambos_mundos', 'email')
    );
    if new.email is distinct from old.email then v_cols := v_cols || 'email'; end if;
    if array_length(v_cols, 1) > 0 then
      perform public._aal_escribir(null, 'edicion_de_perfil_por_admin', 'profiles', new.id::text, new.id,
        jsonb_build_object('columnas', to_jsonb(v_cols)));
    end if;
  end if;
  return null;
end;
$$;

revoke all on function public.registrar_admin_profiles() from public, anon, authenticated, service_role;

drop trigger if exists zz_registro_admin on public.profiles;
drop trigger if exists zz_registro_admin_alta on public.profiles;
drop trigger if exists zz_registro_admin_baja on public.profiles;
create trigger zz_registro_admin_alta
  after insert on public.profiles
  for each row execute function public.registrar_admin_profiles();
create trigger zz_registro_admin_baja
  after delete on public.profiles
  for each row execute function public.registrar_admin_profiles();
-- El UPDATE más común (la propia persona guardando su perfil) no despierta la
-- función: sólo lo que toca algo sensible, o un cambio hecho por OTRA persona.
create trigger zz_registro_admin
  after update on public.profiles
  for each row
  when (
    new.role is distinct from old.role
    or new.deleted_at is distinct from old.deleted_at
    or new.payment_exempt is distinct from old.payment_exempt
    or new.titular_id is distinct from old.titular_id
    or new.es_prueba is distinct from old.es_prueba
    or new.ve_ambos_mundos is distinct from old.ve_ambos_mundos
    -- Edición del perfil de OTRA persona: tiene que haber una sesión y no ser la
    -- propia. Las escrituras del servidor (service role) y los guardados propios
    -- no despiertan la función.
    or (auth.uid() is not null and auth.uid() <> new.id)
  )
  execute function public.registrar_admin_profiles();

-- ── 6. professional_profiles: verificación, rechazo, estado, consultorio ─────
create or replace function public.registrar_admin_professional_profiles()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.is_verified is true then
      perform public._aal_escribir(new.verified_by, 'verificacion_profesional', 'professional_profiles',
        new.id::text, new.user_id,
        jsonb_build_object('antes', null, 'despues', true, 'fuente', new.verification_source));
    end if;
    return null;
  end if;

  if new.is_verified is distinct from old.is_verified then
    perform public._aal_escribir(new.verified_by, 'verificacion_profesional', 'professional_profiles',
      new.id::text, new.user_id,
      jsonb_build_object('antes', old.is_verified, 'despues', new.is_verified,
                         'fuente', new.verification_source));
  end if;

  -- Cuando un ADMIN emite un rechazo o pedido de revisión, o lo repite con otro
  -- motivo. Limpiarlo al reenviar lo hace el propio profesional y no es una
  -- acción de administración (por eso exige actor admin).
  if new.rejection_type is not null
     and (new.rejection_type is distinct from old.rejection_type
          or new.rejection_reason is distinct from old.rejection_reason)
     and public._aal_id_es_admin(coalesce(auth.uid(), new.verified_by)) then
    perform public._aal_escribir(new.verified_by, 'rechazo_profesional', 'professional_profiles',
      new.id::text, new.user_id,
      jsonb_build_object('tipo', new.rejection_type, 'motivo', left(new.rejection_reason, 300)));
  end if;

  if new.is_active is distinct from old.is_active and public._aal_actor_es_admin() then
    perform public._aal_escribir(null, 'cambio_de_estado_de_profesional', 'professional_profiles',
      new.id::text, new.user_id,
      jsonb_build_object('antes', old.is_active, 'despues', new.is_active));
  end if;

  if new.refes_revisado_por is not null
     and (new.refes_revisado_por is distinct from old.refes_revisado_por
          or new.refes_revisado_at is distinct from old.refes_revisado_at) then
    perform public._aal_escribir(new.refes_revisado_por, 'decision_consultorio', 'professional_profiles',
      new.id::text, new.user_id,
      jsonb_build_object('estado', new.refes_estado, 'nota', left(new.refes_error, 300)));
  end if;
  return null;
end;
$$;

revoke all on function public.registrar_admin_professional_profiles() from public, anon, authenticated, service_role;

drop trigger if exists zz_registro_admin on public.professional_profiles;
drop trigger if exists zz_registro_admin_alta on public.professional_profiles;
create trigger zz_registro_admin_alta
  after insert on public.professional_profiles
  for each row when (new.is_verified is true)
  execute function public.registrar_admin_professional_profiles();
-- El latido de disponibilidad escribe esta tabla cada pocos segundos: sólo se
-- despierta la función cuando cambia algo de lo que se registra.
create trigger zz_registro_admin
  after update on public.professional_profiles
  for each row
  when (
    new.is_verified is distinct from old.is_verified
    or new.rejection_type is distinct from old.rejection_type
    or new.rejection_reason is distinct from old.rejection_reason
    or new.is_active is distinct from old.is_active
    or new.refes_revisado_por is distinct from old.refes_revisado_por
    or new.refes_revisado_at is distinct from old.refes_revisado_at
  )
  execute function public.registrar_admin_professional_profiles();

-- ── 7. "Iniciar sesión como" (la escribe la Edge Function con service role) ──
create or replace function public.registrar_admin_impersonacion()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._aal_escribir(new.admin_id, 'iniciar_sesion_como', 'impersonation_log',
    new.id::text, new.target_user_id, '{}'::jsonb);
  return null;
end;
$$;

revoke all on function public.registrar_admin_impersonacion() from public, anon, authenticated, service_role;

drop trigger if exists zz_registro_admin on public.impersonation_log;
create trigger zz_registro_admin
  after insert on public.impersonation_log
  for each row execute function public.registrar_admin_impersonacion();

-- ── 8. Devoluciones decididas por el super admin (mp-refund, service role) ───
create or replace function public.registrar_admin_devolucion()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_accion text;
  v_motivo text := left(coalesce(new.refund_reason, new.refund_reject_reason), 300);
begin
  if new.refund_forced_by is not null and new.refund_forced_by is distinct from old.refund_forced_by then
    v_accion := 'devolucion_forzada';
  elsif new.refund_reviewed_by is not null
        and new.refund_request_status is distinct from old.refund_request_status
        and new.refund_request_status = 'approved' then
    v_accion := 'devolucion_aprobada';
  elsif new.refund_reviewed_by is not null
        and new.refund_request_status is distinct from old.refund_request_status
        and new.refund_request_status = 'rejected' then
    v_accion := 'devolucion_rechazada';
  elsif new.refund_conversion_resolved_at is not null
        and new.refund_conversion_resolved_at is distinct from old.refund_conversion_resolved_at then
    v_accion := 'conversion_de_credito_a_mp';
  else
    return null;
  end if;

  perform public._aal_escribir(coalesce(new.refund_forced_by, new.refund_reviewed_by), v_accion,
    'payments', new.id::text, new.patient_id,
    jsonb_build_object('monto', new.gross_amount, 'tipo', new.refund_type, 'motivo', v_motivo));
  return null;
end;
$$;

revoke all on function public.registrar_admin_devolucion() from public, anon, authenticated, service_role;

drop trigger if exists zz_registro_admin on public.payments;
create trigger zz_registro_admin
  after update on public.payments
  for each row
  when (
    new.refund_forced_by is distinct from old.refund_forced_by
    or new.refund_request_status is distinct from old.refund_request_status
    or new.refund_conversion_resolved_at is distinct from old.refund_conversion_resolved_at
  )
  execute function public.registrar_admin_devolucion();

-- ── 9. Comisión por profesional ──────────────────────────────────────────────
do $$
begin
  if to_regclass('public.professional_commission_changes') is not null then
    execute $f$
      create or replace function public.registrar_admin_comision()
      returns trigger
      language plpgsql
      security definer
      set search_path = public, pg_temp
      as $b$
      begin
        perform public._aal_escribir(new.set_by, 'cambio_de_comision', 'professional_commission_changes',
          new.id::text, new.professional_id,
          jsonb_build_object('tasa', new.rate, 'vigente_hasta', new.valid_until, 'motivo', left(new.reason, 300)));
        return null;
      end;
      $b$
    $f$;
    execute 'revoke all on function public.registrar_admin_comision() from public, anon, authenticated, service_role';
    execute 'drop trigger if exists zz_registro_admin on public.professional_commission_changes';
    execute 'create trigger zz_registro_admin after insert on public.professional_commission_changes
             for each row execute function public.registrar_admin_comision()';
  end if;
end $$;

-- ── 10. Configuración y borrados hechos desde el panel ───────────────────────
-- Genérico: sólo registra si quien escribe es admin/super_admin (las escrituras
-- del sistema o de otros roles sobre estas mismas tablas no son de este registro).
--   modo 'valores'  → antes/después de las columnas que cambiaron (cortos).
--   modo 'nombres'  → sólo los nombres de las columnas (+ status/payment_status).
create or replace function public.registrar_admin_config()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- Argumentos del trigger (se fijan al crearlo, ver _aal_trigger_config):
  --   0 = modo ('valores' | 'nombres')
  --   1 = columnas de la clave primaria, separadas por coma
  --   2 = columnas operativas que NO se registran (p. ej. ambulances.status)
  --   3 = '1' si el WHEN del trigger ya verificó que quien escribe es admin
  v_modo     text   := coalesce(tg_argv[0], 'valores');
  v_pk       text[] := string_to_array(nullif(tg_argv[1], ''), ',');
  v_ignorar  text[] := string_to_array(nullif(tg_argv[2], ''), ',');
  v_ya_admin boolean := coalesce(tg_argv[3], '') = '1';
  v_old      jsonb;
  v_new      jsonb;
  v_fila     jsonb;
  v_cols     text[];
  v_detail   jsonb;
  v_id       text;
begin
  -- Si el WHEN ya preguntó por el rol, no se vuelve a leer profiles.
  if not v_ya_admin and not public._aal_actor_es_admin() then
    return null;
  end if;

  if tg_op in ('UPDATE', 'DELETE') then v_old := to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then v_new := to_jsonb(new); end if;
  v_fila := coalesce(v_new, v_old);

  if tg_op = 'UPDATE' then
    v_cols := array(select c from unnest(public._aal_cols_cambiadas(v_old, v_new)) c
                     where v_ignorar is null or c <> all (v_ignorar));
    if coalesce(array_length(v_cols, 1), 0) = 0 then return null; end if;
    v_detail := case when v_modo = 'valores'
      then jsonb_build_object('cambios', public._aal_diff(v_old, v_new, v_cols))
      else jsonb_build_object('columnas', to_jsonb(v_cols),
                              'estado', public._aal_diff(v_old, v_new, array['status', 'payment_status']))
    end;
  elsif v_modo = 'valores' then
    v_detail := jsonb_build_object(case when tg_op = 'INSERT' then 'despues' else 'antes' end,
      (select coalesce(jsonb_object_agg(key, public._aal_valor_corto(value)), '{}'::jsonb)
         from jsonb_each(v_fila)));
  else
    v_detail := '{}'::jsonb;
  end if;

  -- El id del asiento es la clave primaria REAL de la tabla (id, rnos, droga…;
  -- si es compuesta, los valores unidos con "/").
  select string_agg(v_fila ->> c, '/' order by o) into v_id from unnest(v_pk) with ordinality u(c, o);

  perform public._aal_escribir(null,
    case tg_op when 'INSERT' then 'alta_' when 'UPDATE' then 'modificacion_' else 'eliminacion_' end || tg_table_name,
    tg_table_name, v_id, null, v_detail);
  return null;
end;
$$;

revoke all on function public.registrar_admin_config() from public, anon, authenticated, service_role;

-- Armado de los triggers de esta sección (se borra al final de la migración).
-- La clave primaria se resuelve UNA vez, al crear el trigger, no en cada fila.
create or replace function public._aal_trigger_config(
  p_tabla   text,
  p_nombre  text,
  p_eventos text,                                    -- 'insert or update or delete', 'delete'…
  p_modo    text,
  p_cuando  text default 'auth.uid() is not null',
  p_ignorar text default ''
)
returns void
language plpgsql
as $$
declare
  v_pk text;
begin
  if to_regclass('public.' || p_tabla) is null then return; end if;
  select string_agg(a.attname, ',' order by array_position(i.indkey::int2[], a.attnum)) into v_pk
    from pg_index i
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
   where i.indrelid = ('public.' || p_tabla)::regclass and i.indisprimary;
  execute format('drop trigger if exists %I on public.%I', p_nombre, p_tabla);
  execute format('create trigger %I after %s on public.%I for each row when (%s)
                  execute function public.registrar_admin_config(%L, %L, %L, %L)',
                 p_nombre, p_eventos, p_tabla, p_cuando, p_modo, coalesce(v_pk, ''), p_ignorar,
                 case when p_cuando like '%_aal_actor_es_admin%' then '1' else '0' end);
end;
$$;

do $$
declare
  t text;
begin
  -- Configuración de la plataforma: altas, cambios y bajas, con antes/después.
  foreach t in array array['platform_settings', 'zones', 'specialties', 'vertical_settings',
                           'cobertura_rnos', 'emergency_providers', 'emergency_provider_staff',
                           'ambulance_crew', 'pharmacies', 'farmacia_drogas_bajo_receta']
  loop
    perform public._aal_trigger_config(t, 'zz_registro_admin', 'insert or update or delete', 'valores');
  end loop;

  -- Las ambulancias: el estado (disponible / en servicio) cambia en cada
  -- asignación del despacho diario y NO es una acción de administración.
  perform public._aal_trigger_config('ambulances', 'zz_registro_admin', 'insert or update or delete',
                                     'valores', 'auth.uid() is not null', 'status');

  -- Borrados que sólo puede hacer el super admin desde el panel: queda quién y qué id.
  foreach t in array array['payments', 'emergencies', 'medication_orders', 'rcta_issue_log',
                           'waitlist', 'professional_profiles']
  loop
    perform public._aal_trigger_config(t, 'zz_registro_admin_baja', 'delete', 'nombres');
  end loop;

  -- La lista de espera la marca como avisada el super admin (nombres, sin datos de contacto).
  perform public._aal_trigger_config('waitlist', 'zz_registro_admin_upd', 'update', 'nombres');

  -- Un legajo profesional dado de alta por un admin (el INSERT verificado ya tiene su asiento).
  perform public._aal_trigger_config('professional_profiles', 'zz_registro_admin_cfg_ins', 'insert', 'nombres',
                                     'auth.uid() is not null and public._aal_actor_es_admin()');

  -- Un legajo editado por un admin (matrícula, dirección del consultorio, tarifas, documentos…):
  -- TODAS las columnas, con los nombres (son datos personales). Las de verificación,
  -- rechazo, estado activo y consultorio ya tienen su propio asiento (trigger de
  -- arriba) y las que se mueven solas con ellas (reverificación, SISA, REFEPS) no son
  -- una edición: quedan afuera para no asentar dos veces lo mismo.
  perform public._aal_trigger_config('professional_profiles', 'zz_registro_admin_cfg_upd', 'update', 'nombres',
    'auth.uid() is not null and public._aal_actor_es_admin()',
    'is_verified,verified_by,verified_at,verification_source,rejection_type,rejection_reason,rejected_at,is_active,'
    'refes_id,refes_estado,refes_nombre,refes_raw,refes_actualizado_at,refes_intentos,refes_proximo_intento,refes_error,'
    'refes_revisado_por,refes_revisado_at,reverification_pending,reverification_requested_at,reverification_changes,'
    'mail_verificacion_enviado_at,sisa_status,sisa_matricula,sisa_raw,sisa_verified_at,dado_de_baja');

  -- Consultas: el super admin las edita (estado, fecha, cobro, profesional, precio…),
  -- las crea y las borra. TODAS las columnas, pero el WHEN deja afuera sin leer
  -- nada a las escrituras del servidor y, con una sola consulta indexada al rol,
  -- a las de pacientes y profesionales (el mismo costo que ya paga la policy).
  perform public._aal_trigger_config('consultations', 'zz_registro_admin', 'insert or update or delete', 'nombres',
                                     'auth.uid() is not null and public._aal_actor_es_admin()');
end $$;

drop function public._aal_trigger_config(text, text, text, text, text, text);
