-- ═══════════════════════════════════════════════════════════════════════════
-- 188 · "Eliminar" usuario desde el super admin pasa a ser una baja lógica
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Por qué (2026-10-06): `adminService.deleteProfiles` hacía `profiles.delete()`.
--   · La fila de `auth.users` quedaba viva, con el mail tomado: la persona no
--     se podía volver a registrar (Jacqueline Abramzon; 119 casos en prod).
--   · Las FK hacia `profiles` en CASCADE / SET NULL se llevaban parte de la
--     historia clínica (consultas, notas, documentos, planes, reseñas…). La
--     Ley 26.529 (art. 18) exige conservarla 10 años.
--
-- Decisión de Mateo (A+C, conservar todo):
--   1. Nunca más se borra un perfil. Se lo da de baja: `deleted_at`/`deleted_by`,
--      mail cambiado a un alias (en `profiles` y en `auth.users`, así se libera
--      el real), sin foto ni teléfono, sesiones cerradas y usuario baneado.
--   2. Lo que se le saca queda en `bajas_de_usuarios`, que sólo lee el service
--      role. Con eso, si la persona vuelve con el mismo mail, puede recuperar
--      su cuenta con su historia clínica (`reactivar-cuenta`).
--   3. Las FK de la historia clínica pasan a RESTRICT: un DELETE de un perfil
--      con HC falla en vez de arrastrarla. El control que lo vigila es
--      `scripts/verificar-fk-de-profiles.mjs`.
--
-- La lógica de base vive en dos funciones SECURITY DEFINER que sólo puede
-- llamar el service role (las Edge Functions `dar-de-baja-usuario` y
-- `reactivar-cuenta`). El cambio de mail y el baneo de `auth.users` los hacen
-- esas funciones con el Admin API de Auth, que también actualiza
-- `auth.identities` (tocar `auth.users.email` por SQL lo dejaría desparejo).

-- ────────────────────────────────────────────────────────────
-- 1. Columnas
-- ────────────────────────────────────────────────────────────
-- `deleted_at` ya existe (117, la baja que pide la propia persona desde la app).
alter table public.profiles add column if not exists deleted_by uuid references public.profiles(id) on delete set null;

comment on column public.profiles.deleted_at is
  'Baja lógica (117 desde la app, 188 desde el super admin). El perfil nunca se borra: la historia clínica se conserva 10 años (Ley 26.529).';
comment on column public.profiles.deleted_by is
  'Quién dio de baja el perfil desde el super admin (188). NULL si se dio de baja la propia persona.';

-- Un profesional dado de baja no aparece más en búsquedas, mapa ni pool.
alter table public.professional_profiles add column if not exists dado_de_baja boolean not null default false;
comment on column public.professional_profiles.dado_de_baja is
  'Espejo de profiles.deleted_at (188). Con true el profesional sólo lo ve el staff (RLS professional_profiles_sin_bajas).';

-- ────────────────────────────────────────────────────────────
-- 2. Lo que se le saca al perfil, guardado aparte
-- ────────────────────────────────────────────────────────────
create table if not exists public.bajas_de_usuarios (
  user_id               uuid primary key references public.profiles(id) on delete restrict,
  email_original        text not null,
  datos_originales      jsonb not null default '{}'::jsonb,
  dado_de_baja_at       timestamptz not null default now(),
  dado_de_baja_por      uuid references public.profiles(id) on delete set null,
  -- Link de "recuperá tu cuenta" (reactivar-cuenta → send-email). Mismo patrón
  -- que los códigos de email_change_requests: la tabla no tiene una sola
  -- policy, así que sólo el service role lo puede leer.
  reactivacion_token    text,
  reactivacion_vence_at timestamptz,
  reactivado_at         timestamptz
);

comment on table public.bajas_de_usuarios is
  'Bajas lógicas de usuarios (188): el mail real y los datos que se le sacaron al perfil. Sin policies: sólo service role. Sirve para reactivar la cuenta si la persona vuelve con el mismo mail.';

create index if not exists bajas_de_usuarios_email_vigente
  on public.bajas_de_usuarios (lower(email_original))
  where reactivado_at is null;

alter table public.bajas_de_usuarios enable row level security;
revoke all on public.bajas_de_usuarios from anon, authenticated;
grant all on public.bajas_de_usuarios to service_role;

-- ────────────────────────────────────────────────────────────
-- 3. Las FK de la historia clínica pasan a RESTRICT
-- ────────────────────────────────────────────────────────────
-- Las clinical_* ya están en NO ACTION, y payments / medication_orders se
-- dejan como están (decisión de Mateo). Se recrean por nombre de columna, no
-- de constraint, para no depender de cómo se llamó cada una al crearse.
do $$
declare
  v_fk record;
  v_objetivo constant text[][] := array[
    ['consultations', 'patient_id'], ['consultations', 'professional_id'],
    ['clinical_notes', 'patient_id'], ['clinical_notes', 'professional_id'],
    ['medical_documents', 'patient_id'],
    ['diagnostic_reports', 'patient_id'],
    ['patient_followups', 'patient_id'], ['patient_followups', 'professional_id'],
    ['nutrition_plans', 'patient_id'], ['nutrition_plans', 'professional_id'],
    ['nutrition_plan_adherence', 'patient_id'],
    ['activity_plans', 'patient_id'], ['activity_plans', 'professional_id'],
    ['emergencies', 'patient_id'],
    ['consultation_arrivals', 'patient_id'], ['consultation_arrivals', 'professional_id'],
    ['emergency_tracking', 'patient_id'], ['emergency_tracking', 'professional_id'],
    ['family_members', 'patient_id'], ['family_members', 'familiar_id'],
    ['reviews', 'patient_id'], ['reviews', 'professional_id'],
    ['rcta_issue_log', 'patient_id'], ['rcta_issue_log', 'professional_id']
  ];
  i int;
begin
  for i in 1 .. array_length(v_objetivo, 1) loop
    for v_fk in
      select c.conname, c.confdeltype
        from pg_constraint c
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
       where c.contype = 'f'
         and c.conrelid = format('public.%I', v_objetivo[i][1])::regclass
         and c.confrelid = 'public.profiles'::regclass
         and array_length(c.conkey, 1) = 1
         and a.attname = v_objetivo[i][2]
    loop
      if v_fk.confdeltype <> 'r' then
        execute format('alter table public.%I drop constraint %I', v_objetivo[i][1], v_fk.conname);
        execute format(
          'alter table public.%I add constraint %I foreign key (%I) references public.profiles(id) on delete restrict',
          v_objetivo[i][1], v_fk.conname, v_objetivo[i][2]);
      end if;
    end loop;
  end loop;
end $$;

-- ────────────────────────────────────────────────────────────
-- 4. Un profesional dado de baja no lo ve nadie más que el staff
-- ────────────────────────────────────────────────────────────
-- RESTRICTIVA, igual que professional_profiles_mismo_mundo (186): se suma a
-- las policies que ya existen, no abre nada. `ve_ambos_mundos` (Mateo/Nacho)
-- no cuenta como staff acá: un dado de baja no tiene que aparecer en su
-- búsqueda de paciente.
create or replace function public.veo_bajas()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce((
    select p.role in ('admin', 'super_admin', 'emergency_admin',
                      'emergency_operator', 'emergency_crew', 'pharmacy_admin')
      from public.profiles p
     where p.id = auth.uid()
  ), false);
$$;
grant execute on function public.veo_bajas() to anon, authenticated, service_role;

drop policy if exists professional_profiles_sin_bajas on public.professional_profiles;
create policy professional_profiles_sin_bajas
  on public.professional_profiles
  as restrictive
  for select
  to public
  using (
    not dado_de_baja
    or user_id = (select auth.uid())
    or (select public.veo_bajas())
  );

-- Los que ya estaban dados de baja desde la app (117).
update public.professional_profiles pp
   set dado_de_baja = true
  from public.profiles p
 where p.id = pp.user_id and p.deleted_at is not null and not pp.dado_de_baja;

-- ────────────────────────────────────────────────────────────
-- 5. Dar de baja (sólo service role)
-- ────────────────────────────────────────────────────────────
create or replace function public.dar_de_baja_perfil(p_target uuid, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_perfil public.profiles%rowtype;
  v_alias  text := 'deleted+' || p_target::text || '@deleted.healthier.app';
begin
  if p_target = p_actor then
    raise exception 'No podés darte de baja a vos mismo desde el panel.' using errcode = 'check_violation';
  end if;

  select * into v_perfil from public.profiles where id = p_target for update;
  if not found then
    raise exception 'No existe el usuario %.', p_target using errcode = 'no_data_found';
  end if;
  if v_perfil.titular_id is not null then
    raise exception 'Es un familiar de otra cuenta: se da de baja desde el grupo familiar del titular.' using errcode = 'check_violation';
  end if;

  -- Ya estaba dado de baja: no se pisa el mail original guardado con el alias.
  if v_perfil.deleted_at is null then
    insert into public.bajas_de_usuarios (user_id, email_original, datos_originales, dado_de_baja_por)
    values (p_target, v_perfil.email,
            jsonb_build_object('phone', v_perfil.phone, 'avatar_url', v_perfil.avatar_url),
            p_actor)
    on conflict (user_id) do update
       set email_original = excluded.email_original,
           datos_originales = excluded.datos_originales,
           dado_de_baja_at = now(),
           dado_de_baja_por = excluded.dado_de_baja_por,
           reactivacion_token = null,
           reactivacion_vence_at = null,
           reactivado_at = null;

    update public.profiles
       set email = v_alias, phone = null, avatar_url = null,
           deleted_at = now(), deleted_by = p_actor
     where id = p_target;
  end if;

  update public.professional_profiles set dado_de_baja = true where user_id = p_target;

  -- Cierra todas las sesiones: sin refresh token no puede renovar el acceso.
  delete from auth.sessions where user_id = p_target;
  delete from auth.refresh_tokens where user_id = p_target::text;

  return jsonb_build_object(
    'alias', v_alias,
    'email_original', (select email_original from public.bajas_de_usuarios where user_id = p_target)
  );
end;
$$;

revoke all on function public.dar_de_baja_perfil(uuid, uuid) from public, anon, authenticated;
grant execute on function public.dar_de_baja_perfil(uuid, uuid) to service_role;

-- ────────────────────────────────────────────────────────────
-- 6. Reactivar (sólo service role)
-- ────────────────────────────────────────────────────────────
create or replace function public.reactivar_perfil(p_target uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_baja public.bajas_de_usuarios%rowtype;
begin
  select * into v_baja from public.bajas_de_usuarios
   where user_id = p_target and reactivado_at is null
   for update;
  if not found then
    raise exception 'Esa cuenta no está dada de baja.' using errcode = 'no_data_found';
  end if;

  update public.profiles
     set email = v_baja.email_original,
         phone = coalesce(phone, v_baja.datos_originales->>'phone'),
         avatar_url = coalesce(avatar_url, v_baja.datos_originales->>'avatar_url'),
         deleted_at = null, deleted_by = null
   where id = p_target;

  update public.professional_profiles set dado_de_baja = false where user_id = p_target;

  update public.bajas_de_usuarios
     set reactivado_at = now(), reactivacion_token = null, reactivacion_vence_at = null
   where user_id = p_target;

  return jsonb_build_object('email', v_baja.email_original);
end;
$$;

revoke all on function public.reactivar_perfil(uuid) from public, anon, authenticated;
grant execute on function public.reactivar_perfil(uuid) to service_role;

-- Para que reactivar-cuenta no le devuelva el mail a alguien si ya hay otra
-- cuenta viva con ese mail (la persona eligió crear una nueva).
create or replace function public.auth_user_por_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select id from auth.users where lower(email) = lower(trim(p_email)) limit 1;
$$;

revoke all on function public.auth_user_por_email(text) from public, anon, authenticated;
grant execute on function public.auth_user_por_email(text) to service_role;
