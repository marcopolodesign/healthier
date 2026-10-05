-- ============================================================
-- 186 — Las cuentas de prueba sólo se cruzan con cuentas de prueba
--
-- Qué lo motiva (producción, 2026-10-05 18:54): el paciente demo
-- `paciente@healthier.app` pidió una consulta inmediata, el profesional demo
-- ya había salido del pool (la vigencia de una hora venció a las 17:44) y la
-- única conectada era una médica real. La consulta se le asignó a ella, se
-- canceló a los 2 minutos y le llegó el mail de cancelación.
--
-- Hasta acá la única marca era `professional_profiles.solo_pruebas` (153) y
-- el filtro vivía en el CLIENTE (`lib/featureFlags`): un paciente de prueba
-- no tenía marca, y nada en la base impedía que se cruzara con uno real.
--
-- Regla de Mateo (2026-10-05): "Sí o sí hay que hacerlo siempre a nuestras
-- cuentas de prueba". Prueba ↔ prueba, real ↔ real. Se hace cumplir EN LA
-- BASE, así vale igual para la web, la app y cualquier Edge Function:
--
--   1. `profiles.es_prueba` — la marca, para cualquier rol. La de los
--      profesionales (`solo_pruebas`) pasa a ser un espejo que mantiene un
--      trigger: no se puede despegar de la del perfil.
--   2. RLS restrictiva en `professional_profiles`: cada uno ve sólo a los
--      profesionales de su mundo (búsqueda, mapa, pool de consulta inmediata,
--      perfil público). El propio profesional se sigue viendo, y el staff
--      (super admin, admin, despacho, farmacia) ve a todos.
--   3. Triggers que cortan cualquier fila que junte una cuenta de prueba con
--      una real: consultas (inmediata, agendada, reasignación), emergencias
--      (médico y tripulación de la ambulancia), sala de espera, grupo
--      familiar, seguimientos, planes de nutrición/actividad y reseñas.
--
-- `ve_ambos_mundos` es la excepción para una cuenta interna que tenga que
-- poder usar las dos (no se prende para nadie en esta migración: lo decide
-- Mateo). Sólo la toca el super admin o el backend.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. La marca
-- ────────────────────────────────────────────────────────────
alter table public.profiles
  add column if not exists es_prueba boolean not null default false,
  add column if not exists ve_ambos_mundos boolean not null default false;

comment on column public.profiles.es_prueba is
  'Cuenta de prueba (migración 186). Sólo se cruza con otras cuentas de prueba: no ve profesionales reales, ni se le puede asignar una consulta, emergencia o familiar real. La heredan los familiares creados por un titular de prueba. La cambia sólo el super admin o el backend.';
comment on column public.profiles.ve_ambos_mundos is
  'Excepción interna (migración 186): la cuenta ve y se cruza con cuentas de prueba Y reales. Sólo la cambia el super admin o el backend.';

-- Qué mails son de prueba por definición. Cubre las cuentas demo, las de
-- staging y las que crean los scripts (`prueba.*@healthier.app`, `*.test`).
create or replace function public.correo_de_prueba(p_email text)
returns boolean
language sql
immutable
as $$
  select coalesce(
    lower(btrim(p_email)) like '%@healthier.app'
    or lower(btrim(p_email)) like '%@staging.healthier.app'
    or lower(btrim(p_email)) like '%.test',
    false);
$$;

update public.profiles set es_prueba = true
 where public.correo_de_prueba(email) and not es_prueba;

-- Los familiares de un titular de prueba también son de prueba (comparten el
-- mail del titular, así que ya entraron arriba; esto cubre el caso raro).
update public.profiles f set es_prueba = true
  from public.profiles t
 where f.titular_id = t.id and t.es_prueba and not f.es_prueba;

create index if not exists profiles_es_prueba_idx
  on public.profiles (es_prueba) where es_prueba;

-- ────────────────────────────────────────────────────────────
-- 2. Lecturas de la marca
-- ────────────────────────────────────────────────────────────
create or replace function public.es_cuenta_de_prueba(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce((select es_prueba from public.profiles where id = p_user), false);
$$;

-- `true` si las dos cuentas se pueden cruzar. Si falta alguna (null o perfil
-- inexistente) devuelve true: de eso se encarga la FK, no esta regla.
create or replace function public.cuentas_compatibles(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce((
    select a.es_prueba = b.es_prueba or a.ve_ambos_mundos or b.ve_ambos_mundos
      from public.profiles a, public.profiles b
     where a.id = p_a and b.id = p_b
  ), true);
$$;

-- Qué profesionales puede ver quien hace la consulta: 'todos' (staff o la
-- excepción interna), 'prueba' o 'real'. Sin sesión (landing pública) = real.
create or replace function public.mundo_que_veo()
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce((
    select case
             when p.ve_ambos_mundos
               or p.role in ('admin', 'super_admin', 'emergency_admin',
                             'emergency_operator', 'emergency_crew', 'pharmacy_admin')
               then 'todos'
             when p.es_prueba then 'prueba'
             else 'real'
           end
      from public.profiles p
     where p.id = auth.uid()
  ), 'real');
$$;

revoke all on function public.es_cuenta_de_prueba(uuid) from public, anon, authenticated;
revoke all on function public.cuentas_compatibles(uuid, uuid) from public, anon, authenticated;
grant execute on function public.cuentas_compatibles(uuid, uuid) to service_role;
grant execute on function public.es_cuenta_de_prueba(uuid) to service_role;
-- La usa la policy de abajo, así que la tiene que poder ejecutar cualquiera.
grant execute on function public.mundo_que_veo() to anon, authenticated, service_role;

-- ────────────────────────────────────────────────────────────
-- 3. Nadie se cambia la marca solo
-- ────────────────────────────────────────────────────────────
create or replace function public.profiles_marca_de_prueba()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_privilegiado boolean := auth.uid() is null or public.get_my_role() = 'super_admin';
begin
  if tg_op = 'INSERT' then
    new.es_prueba := (coalesce(new.es_prueba, false) and v_privilegiado)
                     or public.correo_de_prueba(new.email)
                     or (new.titular_id is not null and public.es_cuenta_de_prueba(new.titular_id));
    new.ve_ambos_mundos := coalesce(new.ve_ambos_mundos, false) and v_privilegiado;
    return new;
  end if;

  -- UPDATE: un cliente que reenvía el perfil entero no puede cambiarla. No se
  -- tira error para no romper un "guardar perfil" que la mande sin querer.
  if not v_privilegiado then
    new.es_prueba := old.es_prueba;
    new.ve_ambos_mundos := old.ve_ambos_mundos;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_marca_de_prueba on public.profiles;
create trigger profiles_marca_de_prueba
  before insert or update on public.profiles
  for each row execute function public.profiles_marca_de_prueba();

-- Si el super admin cambia la marca, la siguen el espejo del profesional y los
-- familiares que creó esa cuenta.
create or replace function public.profiles_propagar_marca_de_prueba()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  update public.professional_profiles
     set solo_pruebas = new.es_prueba
   where user_id = new.id and solo_pruebas is distinct from new.es_prueba;
  update public.profiles
     set es_prueba = new.es_prueba
   where titular_id = new.id and es_prueba is distinct from new.es_prueba;
  return new;
end;
$$;

drop trigger if exists profiles_propagar_marca_de_prueba on public.profiles;
create trigger profiles_propagar_marca_de_prueba
  after update of es_prueba on public.profiles
  for each row when (new.es_prueba is distinct from old.es_prueba)
  execute function public.profiles_propagar_marca_de_prueba();

-- `solo_pruebas` es un espejo de `profiles.es_prueba`: siempre se recalcula.
-- (El profesional reenvía su fila entera con `upsert`, así que si no se pisa
-- acá podría desmarcarse a sí mismo.)
create or replace function public.professional_profiles_espejo_de_prueba()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  new.solo_pruebas := public.es_cuenta_de_prueba(new.user_id);
  return new;
end;
$$;

drop trigger if exists professional_profiles_espejo_de_prueba on public.professional_profiles;
create trigger professional_profiles_espejo_de_prueba
  before insert or update on public.professional_profiles
  for each row execute function public.professional_profiles_espejo_de_prueba();

update public.professional_profiles pp
   set solo_pruebas = p.es_prueba
  from public.profiles p
 where p.id = pp.user_id and pp.solo_pruebas is distinct from p.es_prueba;

comment on column public.professional_profiles.solo_pruebas is
  'Espejo de profiles.es_prueba (migración 186), lo mantiene un trigger. Un profesional de prueba sólo lo ven cuentas de prueba (RLS professional_profiles_mismo_mundo) y sólo atiende cuentas de prueba.';

-- ────────────────────────────────────────────────────────────
-- 4. Cada uno ve a los profesionales de su mundo
-- ────────────────────────────────────────────────────────────
-- RESTRICTIVA: se suma (AND) a las policies de lectura que ya existen, así que
-- no abre nada que hoy esté cerrado. Cubre la búsqueda, el mapa, el pool de la
-- consulta inmediata y `buscar_profesionales_cobrables` (es SECURITY INVOKER).
drop policy if exists professional_profiles_mismo_mundo on public.professional_profiles;
create policy professional_profiles_mismo_mundo
  on public.professional_profiles
  as restrictive
  for select
  to public
  using (
    user_id = (select auth.uid())
    or (select public.mundo_que_veo()) = 'todos'
    or solo_pruebas = ((select public.mundo_que_veo()) = 'prueba')
  );

-- ────────────────────────────────────────────────────────────
-- 5. Ninguna fila junta una cuenta de prueba con una real
-- ────────────────────────────────────────────────────────────
-- Genérico: TG_ARGV[0] y TG_ARGV[1] son las dos columnas a comparar. En un
-- UPDATE sólo mira si alguna de las dos cambió, así que las filas viejas que
-- ya quedaron cruzadas siguen pudiendo cancelarse o cerrarse.
create or replace function public.exigir_mismo_mundo()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_new jsonb := to_jsonb(new);
  v_a uuid := nullif(v_new ->> tg_argv[0], '')::uuid;
  v_b uuid := nullif(v_new ->> tg_argv[1], '')::uuid;
  v_old jsonb;
begin
  if v_a is null or v_b is null then return new; end if;
  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    if v_a is not distinct from nullif(v_old ->> tg_argv[0], '')::uuid
       and v_b is not distinct from nullif(v_old ->> tg_argv[1], '')::uuid then
      return new;
    end if;
  end if;
  if not public.cuentas_compatibles(v_a, v_b) then
    raise exception 'Una cuenta de prueba sólo se puede cruzar con otras cuentas de prueba (%).', tg_table_name
      using errcode = 'check_violation',
            hint = 'profiles.es_prueba — migración 186';
  end if;
  return new;
end;
$$;

drop trigger if exists consultations_mismo_mundo on public.consultations;
create trigger consultations_mismo_mundo
  before insert or update of patient_id, professional_id on public.consultations
  for each row execute function public.exigir_mismo_mundo('patient_id', 'professional_id');

drop trigger if exists walk_in_queue_mismo_mundo on public.walk_in_queue;
create trigger walk_in_queue_mismo_mundo
  before insert or update of patient_id, professional_id on public.walk_in_queue
  for each row execute function public.exigir_mismo_mundo('patient_id', 'professional_id');

drop trigger if exists family_members_mismo_mundo on public.family_members;
create trigger family_members_mismo_mundo
  before insert or update of patient_id, familiar_id on public.family_members
  for each row execute function public.exigir_mismo_mundo('patient_id', 'familiar_id');

drop trigger if exists patient_followups_mismo_mundo on public.patient_followups;
create trigger patient_followups_mismo_mundo
  before insert or update of patient_id, professional_id on public.patient_followups
  for each row execute function public.exigir_mismo_mundo('patient_id', 'professional_id');

drop trigger if exists patient_followups_recomendado_mismo_mundo on public.patient_followups;
create trigger patient_followups_recomendado_mismo_mundo
  before insert or update of patient_id, recommended_professional_id on public.patient_followups
  for each row execute function public.exigir_mismo_mundo('patient_id', 'recommended_professional_id');

drop trigger if exists nutrition_plans_mismo_mundo on public.nutrition_plans;
create trigger nutrition_plans_mismo_mundo
  before insert or update of patient_id, professional_id on public.nutrition_plans
  for each row execute function public.exigir_mismo_mundo('patient_id', 'professional_id');

drop trigger if exists activity_plans_mismo_mundo on public.activity_plans;
create trigger activity_plans_mismo_mundo
  before insert or update of patient_id, professional_id on public.activity_plans
  for each row execute function public.exigir_mismo_mundo('patient_id', 'professional_id');

drop trigger if exists reviews_mismo_mundo on public.reviews;
create trigger reviews_mismo_mundo
  before insert or update of patient_id, professional_id on public.reviews
  for each row execute function public.exigir_mismo_mundo('patient_id', 'professional_id');

-- Emergencias: el médico asignado Y la tripulación activa de la ambulancia.
-- Lo llama `asignar_emergencia` (coordinador) y cualquier otro camino.
create or replace function public.emergencias_mismo_mundo()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.patient_id is null then return new; end if;
  if tg_op = 'UPDATE'
     and new.patient_id is not distinct from old.patient_id
     and new.professional_id is not distinct from old.professional_id
     and new.ambulance_id is not distinct from old.ambulance_id then
    return new;
  end if;

  if new.professional_id is not null
     and not public.cuentas_compatibles(new.patient_id, new.professional_id) then
    raise exception 'Una cuenta de prueba sólo se puede cruzar con otras cuentas de prueba (médico de la emergencia).'
      using errcode = 'check_violation', hint = 'profiles.es_prueba — migración 186';
  end if;

  if new.ambulance_id is not null and exists (
    select 1 from public.ambulance_crew c
     where c.ambulance_id = new.ambulance_id and c.active
       and not public.cuentas_compatibles(new.patient_id, c.profile_id)
  ) then
    raise exception 'Una cuenta de prueba sólo se puede cruzar con otras cuentas de prueba (tripulación de la ambulancia).'
      using errcode = 'check_violation', hint = 'profiles.es_prueba — migración 186';
  end if;

  return new;
end;
$$;

drop trigger if exists emergencies_mismo_mundo on public.emergencies;
create trigger emergencies_mismo_mundo
  before insert or update of patient_id, professional_id, ambulance_id on public.emergencies
  for each row execute function public.emergencias_mismo_mundo();

-- Para las Edge Functions de avisos (send-email, send-push-notification): una
-- segunda red por si alguna fila cruzada quedó de antes de esta migración.
create or replace function public.consulta_cruza_mundos(p_consultation_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce((
    select not public.cuentas_compatibles(c.patient_id, c.professional_id)
      from public.consultations c where c.id = p_consultation_id
  ), false);
$$;

revoke all on function public.consulta_cruza_mundos(uuid) from public, anon, authenticated;
grant execute on function public.consulta_cruza_mundos(uuid) to service_role;
