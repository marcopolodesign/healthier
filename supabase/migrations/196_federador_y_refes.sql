-- ============================================================
-- Migration 196 — Federador Nacional de pacientes + REFES de consultorios
-- ============================================================
-- Dos integraciones nuevas con el bus del Ministerio de Salud (bus.msal.gob.ar),
-- misma credencial 3383 que REFEPS (sisa-verify) y PUCO (cobertura-sugerida).
-- El cliente del bus vive en supabase/functions/_shared/msalBus.ts.
--
-- 1 · Pacientes en el Federador (Edge Function `federador-paciente`)
--     Cuando un paciente tiene DNI + sexo + fecha de nacimiento + nombre, se lo
--     busca en el Federador. Si está, se guarda su id nacional en
--     `profiles.federador_id`. Si no está y la función corre en modo `federar`
--     (secret MSAL_FEDERADOR_MODO), se lo da de alta y se guarda el id devuelto.
--     Invisible para el paciente: el disparo es asíncrono (pg_net) y un fallo
--     del bus deja el estado en `error` con un reintento programado; el
--     registro nunca se frena.
--     Privacidad: sólo identidad (DNI, sexo, nacimiento, nombre). Nada clínico.
--
-- 2 · Consultorios en REFES (Edge Function `refes-consultorio`)
--     Cuando el profesional carga o cambia `professional_profiles.address`, se
--     busca el establecimiento en REFES. Si matchea uno solo, se guarda el id y
--     queda `verificado` ("Consultorio habilitado" en su perfil público). Si no,
--     queda `revisar` y le aparece al super admin en /super-admin/consultorios.
--     No bloquea nada.
--
-- Los dos siguen el patrón de las migraciones 143/146: trigger + pg_net con la
-- service key del Vault (push_service_key / functions_base_url), así cubre web
-- y app. Un cron cada 15 min reintenta lo que quedó en `pendiente` / `error`.
--
-- 🔴 La migración NO marca filas existentes: el backfill es aparte
-- (scripts/federador-backfill.mjs), así aplicarla en producción no dispara
-- consultas masivas al bus.
-- ============================================================

-- ── 0 · Helper: llamar a una Edge Function desde la base ─────
-- Mismo criterio que enviar_mail (146): nunca tira. Si faltan los secretos del
-- Vault, avisa y sigue.
create or replace function public.llamar_edge_function(p_funcion text, p_payload jsonb)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions', 'vault'
as $$
declare
  v_key  text;
  v_base text;
begin
  select decrypted_secret into v_key  from vault.decrypted_secrets where name = 'push_service_key'   limit 1;
  select decrypted_secret into v_base from vault.decrypted_secrets where name = 'functions_base_url' limit 1;
  if v_key is null or v_base is null then
    raise warning 'llamar_edge_function: faltan secretos en Vault — no se llamó a %', p_funcion;
    return;
  end if;
  perform net.http_post(
    url     := rtrim(v_base, '/') || '/' || p_funcion,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body    := coalesce(p_payload, '{}'::jsonb),
    timeout_milliseconds := 60000
  );
exception when others then
  raise warning 'llamar_edge_function(%): %', p_funcion, sqlerrm;
end;
$$;

revoke all on function public.llamar_edge_function(text, jsonb) from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1 · Federador
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.profiles
  add column if not exists federador_id              text,
  add column if not exists federador_estado          text,
  add column if not exists federador_actualizado_at  timestamptz,
  add column if not exists federador_intentos        smallint not null default 0,
  add column if not exists federador_proximo_intento timestamptz,
  add column if not exists federador_error           text;

alter table public.profiles drop constraint if exists profiles_federador_estado_check;
alter table public.profiles add constraint profiles_federador_estado_check
  check (federador_estado is null or federador_estado in
    ('pendiente', 'vinculado', 'federado', 'no_encontrado', 'error', 'sin_datos'));

comment on column public.profiles.federador_id is
  'Id del paciente en el Federador Nacional del Ministerio de Salud (https://federador.msal.gob.ar/patient-id). Migración 196.';
comment on column public.profiles.federador_estado is
  'pendiente · vinculado (ya estaba en el Federador) · federado (lo dimos de alta) · no_encontrado (no está y el modo no permite alta) · error (reintenta) · sin_datos. NULL = nunca se intentó.';

create index if not exists profiles_federador_cola_idx
  on public.profiles (federador_proximo_intento)
  where federador_estado in ('pendiente', 'error');

-- Identidad completa = lo mínimo que pide el Federador para buscar/dar de alta.
create or replace function public.identidad_federable(p public.profiles)
returns boolean
language sql
stable
as $$
  select coalesce(p.role = 'patient'
     and p.deleted_at is null
     and length(regexp_replace(p.dni, '\D', '', 'g')) between 7 and 8
     and p.gender is not null and p.gender <> ''
     and p.birth_date is not null
     and coalesce(nullif(trim(p.last_name), ''), nullif(trim(p.full_name), '')) is not null, false)
$$;

-- Al completar (o cambiar) la identidad: marca pendiente y dispara la búsqueda.
create or replace function public.federar_paciente_al_completar()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.identidad_federable(new) then return new; end if;

  if tg_op = 'UPDATE'
     and new.dni        is not distinct from old.dni
     and new.gender     is not distinct from old.gender
     and new.birth_date is not distinct from old.birth_date
     and new.first_name is not distinct from old.first_name
     and new.last_name  is not distinct from old.last_name
     and new.full_name  is not distinct from old.full_name
     and new.role       is not distinct from old.role
     and old.federador_estado is not null then
    return new;
  end if;

  update public.profiles
     set federador_estado = 'pendiente', federador_intentos = 0,
         federador_proximo_intento = now(), federador_error = null
   where id = new.id;

  perform public.llamar_edge_function('federador-paciente', jsonb_build_object('profileId', new.id));
  return new;
exception when others then
  -- El alta del paciente no se frena NUNCA por esto.
  raise warning 'federar_paciente_al_completar(%): %', new.id, sqlerrm;
  return new;
end;
$$;

drop trigger if exists profiles_federar on public.profiles;
create trigger profiles_federar
  after insert or update of dni, gender, birth_date, first_name, last_name, full_name, role
  on public.profiles
  for each row execute function public.federar_paciente_al_completar();

-- ═══════════════════════════════════════════════════════════════════════════
-- 2 · REFES
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.professional_profiles
  add column if not exists refes_id              text,
  add column if not exists refes_estado          text,
  add column if not exists refes_nombre          text,
  add column if not exists refes_raw             jsonb,
  add column if not exists refes_actualizado_at  timestamptz,
  add column if not exists refes_intentos        smallint not null default 0,
  add column if not exists refes_proximo_intento timestamptz,
  add column if not exists refes_error           text,
  add column if not exists refes_revisado_por    uuid references public.profiles(id) on delete set null,
  add column if not exists refes_revisado_at     timestamptz;

alter table public.professional_profiles drop constraint if exists professional_profiles_refes_estado_check;
alter table public.professional_profiles add constraint professional_profiles_refes_estado_check
  check (refes_estado is null or refes_estado in
    ('pendiente', 'verificado', 'revisar', 'error', 'aprobado_manual', 'rechazado_manual'));

comment on column public.professional_profiles.refes_estado is
  'Consultorio contra REFES (migración 196): pendiente · verificado (match automático) · revisar (sin match o ambiguo: lo ve el super admin) · error (el bus falló, reintenta) · aprobado_manual / rechazado_manual (decisión del super admin). "Consultorio habilitado" se muestra con verificado o aprobado_manual.';

create index if not exists professional_profiles_refes_cola_idx
  on public.professional_profiles (refes_proximo_intento)
  where refes_estado in ('pendiente', 'error');

create or replace function public.verificar_consultorio_al_cambiar()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if tg_op = 'UPDATE' and new.address is not distinct from old.address then return new; end if;

  if nullif(trim(coalesce(new.address, '')), '') is null then
    update public.professional_profiles
       set refes_estado = null, refes_id = null, refes_nombre = null, refes_raw = null,
           refes_error = null, refes_proximo_intento = null, refes_actualizado_at = now()
     where id = new.id;
    return new;
  end if;

  update public.professional_profiles
     set refes_estado = 'pendiente', refes_id = null, refes_nombre = null, refes_raw = null,
         refes_intentos = 0, refes_proximo_intento = now(), refes_error = null,
         refes_revisado_por = null, refes_revisado_at = null
   where id = new.id;

  perform public.llamar_edge_function('refes-consultorio', jsonb_build_object('professionalId', new.id));
  return new;
exception when others then
  raise warning 'verificar_consultorio_al_cambiar(%): %', new.id, sqlerrm;
  return new;
end;
$$;

drop trigger if exists professional_profiles_refes on public.professional_profiles;
create trigger professional_profiles_refes
  after insert or update of address on public.professional_profiles
  for each row execute function public.verificar_consultorio_al_cambiar();

-- ═══════════════════════════════════════════════════════════════════════════
-- 3 · Nadie se autoverifica
-- ═══════════════════════════════════════════════════════════════════════════
-- Las policies dejan que el paciente edite su perfil y el profesional su ficha.
-- Sin esto, cualquiera podría escribirse un federador_id o ponerse
-- "Consultorio habilitado". Pasan: la service role (las Edge Functions), admin
-- y super admin, y los UPDATE que hacen los propios triggers de arriba
-- (pg_trigger_depth() > 1).
create or replace function public.bloquear_autoregistro_ministerio()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if pg_trigger_depth() > 1 or public.es_operador_de_plataforma() then
    return new;
  end if;
  if tg_table_name = 'profiles' then
    if (new.federador_id, new.federador_estado, new.federador_intentos, new.federador_proximo_intento, new.federador_error)
       is distinct from (old.federador_id, old.federador_estado, old.federador_intentos, old.federador_proximo_intento, old.federador_error) then
      raise exception 'El registro en el Federador lo actualiza sólo Healthier.' using errcode = '42501';
    end if;
  else
    if (new.refes_id, new.refes_estado, new.refes_nombre, new.refes_raw, new.refes_revisado_por, new.refes_revisado_at, new.refes_intentos, new.refes_error)
       is distinct from (old.refes_id, old.refes_estado, old.refes_nombre, old.refes_raw, old.refes_revisado_por, old.refes_revisado_at, old.refes_intentos, old.refes_error) then
      raise exception 'La verificación del consultorio la hace sólo Healthier.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_bloquear_federador on public.profiles;
create trigger profiles_bloquear_federador
  before update on public.profiles
  for each row execute function public.bloquear_autoregistro_ministerio();

drop trigger if exists professional_profiles_bloquear_refes on public.professional_profiles;
create trigger professional_profiles_bloquear_refes
  before update on public.professional_profiles
  for each row execute function public.bloquear_autoregistro_ministerio();

-- ═══════════════════════════════════════════════════════════════════════════
-- 4 · Reintentos
-- ═══════════════════════════════════════════════════════════════════════════
-- Cada 15 min: las funciones toman en lotes chicos lo que esté pendiente o en
-- error con el próximo intento vencido (backoff exponencial, tope 8 intentos;
-- lo calcula cada función).
create or replace function public.reintentar_registros_ministerio()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if exists (select 1 from public.profiles
              where federador_estado in ('pendiente', 'error')
                and coalesce(federador_proximo_intento, now()) <= now()
                and federador_intentos < 8) then
    perform public.llamar_edge_function('federador-paciente', jsonb_build_object('lote', 20));
  end if;
  if exists (select 1 from public.professional_profiles
              where refes_estado in ('pendiente', 'error')
                and coalesce(refes_proximo_intento, now()) <= now()
                and refes_intentos < 8) then
    perform public.llamar_edge_function('refes-consultorio', jsonb_build_object('lote', 10));
  end if;
end;
$$;

revoke all on function public.reintentar_registros_ministerio() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'reintentar-registros-ministerio') then
    perform cron.unschedule('reintentar-registros-ministerio');
  end if;
  perform cron.schedule('reintentar-registros-ministerio', '*/15 * * * *',
                        'select public.reintentar_registros_ministerio()');
end $$;
