-- ═══════════════════════════════════════════════════════════════════════════
-- 195 · Derivaciones
-- ═══════════════════════════════════════════════════════════════════════════
-- Pedido de Mateo (2026-10-10): "un profesional puede derivar a otro profesional
-- con nombre y apellido o directamente a otra vertical".
--
-- Decisiones suyas que esta migración implementa:
--   · Se deriva a un profesional concreto (verificado) O a una especialidad, con
--     motivo obligatorio. Desde el cierre de la consulta o desde la ficha.
--   · El que recibe NO acepta: se le avisa y el paciente reserva directo. La
--     consulta del derivado se paga como cualquier otra.
--   · El destinatario ve la nota de derivación siempre; la historia clínica
--     completa SÓLO si el paciente da su consentimiento, que queda registrado.
--
-- ── Lo delicado: la historia clínica ─────────────────────────────────────────
-- Hasta acá, cualquier profesional con UNA consulta con el paciente veía toda
-- su historia (las policies `*_read_shared` de la 033 y `has_shared_consultation`
-- de la 005). Con eso, reservar la consulta derivada le abría la HC al que
-- recibe aunque el paciente hubiera dicho que no. Se centraliza la regla en
-- `profesional_ve_hc(paciente)`:
--   · una consulta normal (sin derivación) da acceso, como siempre;
--   · una consulta que nació de una derivación da acceso sólo si el paciente
--     consintió;
--   · el destinatario de una derivación vigente con consentimiento ve la HC
--     desde antes de la reserva (para preparar la consulta).
-- Las policies de lectura compartida de la HC pasan a usar esa función.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1 · La tabla
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.derivaciones (
  id                      uuid primary key default gen_random_uuid(),
  patient_id              uuid not null references public.profiles(id) on delete restrict,
  derivado_por            uuid not null references public.profiles(id) on delete restrict,
  consulta_origen_id      uuid references public.consultations(id) on delete set null,
  -- Destino: un profesional concreto, O una vertical (con especialidad
  -- opcional dentro de ella: "Clínica · Cardiología", o "Nutrición" a secas).
  profesional_destino_id  uuid references public.profiles(id) on delete restrict,
  vertical_destino        text,
  especialidad_destino    text,
  motivo                  text not null,
  estado                  text not null default 'pendiente'
                          check (estado in ('pendiente', 'reservada', 'vencida', 'cancelada')),
  -- null = el paciente todavía no respondió. false = dijo que no.
  consentimiento_hc       boolean,
  consentimiento_at       timestamptz,
  consentimiento_por      uuid references public.profiles(id) on delete restrict,
  consulta_reservada_id   uuid references public.consultations(id) on delete set null,
  reservada_at            timestamptz,
  vence_at                timestamptz not null default (now() + interval '60 days'),
  cancelada_at            timestamptz,
  cancelada_por           uuid references public.profiles(id) on delete restrict,
  mail_enviado_at         timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint derivaciones_un_destino check (
    (profesional_destino_id is null) <> (vertical_destino is null)
  ),
  constraint derivaciones_especialidad_con_vertical check (
    especialidad_destino is null or vertical_destino is not null
  ),
  constraint derivaciones_motivo_no_vacio check (length(btrim(motivo)) >= 3),
  constraint derivaciones_no_a_si_mismo check (profesional_destino_id is distinct from derivado_por)
);

comment on table public.derivaciones is
  'Derivaciones de un profesional a otro profesional o a una especialidad (migración 195). Es parte de la historia clínica: no se borra.';
comment on column public.derivaciones.consentimiento_hc is
  'Si el paciente autorizó compartir su historia clínica con quien recibe. NULL = no respondió. El historial completo de respuestas está en derivacion_consentimientos.';

create index if not exists idx_derivaciones_paciente on public.derivaciones(patient_id, created_at desc);
create index if not exists idx_derivaciones_derivado_por on public.derivaciones(derivado_por, created_at desc);
create index if not exists idx_derivaciones_destino on public.derivaciones(profesional_destino_id) where profesional_destino_id is not null;
create index if not exists idx_derivaciones_reservada on public.derivaciones(consulta_reservada_id) where consulta_reservada_id is not null;

drop trigger if exists derivaciones_updated_at on public.derivaciones;
create trigger derivaciones_updated_at
  before update on public.derivaciones
  for each row execute function public.set_updated_at();

-- Una cuenta de prueba no se deriva a (ni la deriva) una real — migración 186.
drop trigger if exists derivaciones_mismo_mundo_paciente on public.derivaciones;
create trigger derivaciones_mismo_mundo_paciente
  before insert on public.derivaciones
  for each row execute function public.exigir_mismo_mundo('patient_id', 'derivado_por');
drop trigger if exists derivaciones_mismo_mundo_destino on public.derivaciones;
create trigger derivaciones_mismo_mundo_destino
  before insert on public.derivaciones
  for each row execute function public.exigir_mismo_mundo('patient_id', 'profesional_destino_id');

-- El historial de respuestas al consentimiento. Append-only: cada vez que el
-- paciente dice que sí o que no queda una fila, con quién y cuándo.
create table if not exists public.derivacion_consentimientos (
  id             uuid primary key default gen_random_uuid(),
  derivacion_id  uuid not null references public.derivaciones(id) on delete restrict,
  acepta         boolean not null,
  respondido_por uuid not null references public.profiles(id) on delete restrict,
  created_at     timestamptz not null default now()
);
create index if not exists idx_derivacion_consentimientos on public.derivacion_consentimientos(derivacion_id, created_at desc);

-- La consulta que se reserva desde una derivación queda vinculada.
alter table public.consultations
  add column if not exists derivacion_id uuid references public.derivaciones(id) on delete set null;
create index if not exists idx_consultations_derivacion on public.consultations(derivacion_id) where derivacion_id is not null;
comment on column public.consultations.derivacion_id is
  'La derivación desde la que se reservó esta consulta (migración 195). Sin consentimiento de la derivación, esta consulta no le abre la historia clínica al profesional.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2 · Quién ve qué (RLS)
-- ═══════════════════════════════════════════════════════════════════════════
-- Toda escritura va por RPC (abajo): no hay policies de insert/update/delete.
alter table public.derivaciones enable row level security;
alter table public.derivacion_consentimientos enable row level security;

-- ¿El usuario actual es una de las partes de esta derivación? SECURITY DEFINER
-- para poder mirar la consulta reservada sin depender de la RLS de consultations.
create or replace function public.es_parte_de_derivacion(p_derivacion_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.derivaciones d
     where d.id = p_derivacion_id
       and (
         d.patient_id = auth.uid()
         or public.es_titular_de(auth.uid(), d.patient_id)
         or d.derivado_por = auth.uid()
         or d.profesional_destino_id = auth.uid()
         or exists (select 1 from public.consultations c
                     where c.id = d.consulta_reservada_id and c.professional_id = auth.uid())
       )
  );
$$;
revoke all on function public.es_parte_de_derivacion(uuid) from public, anon;
grant execute on function public.es_parte_de_derivacion(uuid) to authenticated;

drop policy if exists derivaciones_partes_leen on public.derivaciones;
create policy derivaciones_partes_leen on public.derivaciones
  for select to authenticated
  using (public.es_parte_de_derivacion(id));

drop policy if exists derivaciones_super_admin_lee on public.derivaciones;
create policy derivaciones_super_admin_lee on public.derivaciones
  for select to authenticated
  using (public.get_my_role() = 'super_admin');

drop policy if exists derivacion_consentimientos_leen on public.derivacion_consentimientos;
create policy derivacion_consentimientos_leen on public.derivacion_consentimientos
  for select to authenticated
  using (public.es_parte_de_derivacion(derivacion_id) or public.get_my_role() = 'super_admin');

-- El que recibe tiene que poder ver el nombre del paciente antes de la reserva
-- (y el paciente, al que lo derivó). Función SECURITY DEFINER: una policy de
-- `profiles` nunca consulta `profiles` directo (42P17, ver CLAUDE.md).
create or replace function public.tiene_derivacion_con(other_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.derivaciones d
     where d.estado in ('pendiente', 'reservada')
       and (
         (d.patient_id = other_user_id and (d.profesional_destino_id = auth.uid() or d.derivado_por = auth.uid()))
         or (d.patient_id = auth.uid() and (d.profesional_destino_id = other_user_id or d.derivado_por = other_user_id))
       )
  );
$$;
revoke all on function public.tiene_derivacion_con(uuid) from public, anon;
grant execute on function public.tiene_derivacion_con(uuid) to authenticated;

drop policy if exists profiles_read_derivacion_parties on public.profiles;
create policy profiles_read_derivacion_parties on public.profiles
  for select using (public.tiene_derivacion_con(id));

-- ═══════════════════════════════════════════════════════════════════════════
-- 3 · La regla de acceso a la historia clínica
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.profesional_ve_hc(p_paciente uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select auth.uid() is not null and p_paciente is not null and (
    -- Una consulta con el paciente que no nació de una derivación, o que nació
    -- de una derivación con consentimiento.
    exists (
      select 1
        from public.consultations c
        left join public.derivaciones d on d.id = c.derivacion_id
       where c.professional_id = auth.uid()
         and c.patient_id = p_paciente
         and (c.derivacion_id is null or d.consentimiento_hc is true)
    )
    -- Destinatario de una derivación vigente con consentimiento, aunque todavía
    -- no haya turno.
    or exists (
      select 1 from public.derivaciones d
       where d.patient_id = p_paciente
         and d.profesional_destino_id = auth.uid()
         and d.consentimiento_hc is true
         and d.estado in ('pendiente', 'reservada')
    )
  );
$$;
revoke all on function public.profesional_ve_hc(uuid) from public, anon;
grant execute on function public.profesional_ve_hc(uuid) to authenticated;

comment on function public.profesional_ve_hc(uuid) is
  'Si el profesional actual puede leer la historia clínica del paciente (migración 195). Toda policy de lectura compartida de la HC tiene que pasar por acá.';

-- Las policies de lectura compartida, reescritas sobre la función.
drop policy if exists ce_professional_shared on public.clinical_encounters;
create policy ce_professional_shared on public.clinical_encounters
  for select using (public.profesional_ve_hc(patient_id));

drop policy if exists cen_professional_read_shared on public.clinical_entries;
create policy cen_professional_read_shared on public.clinical_entries
  for select using (public.profesional_ve_hc(patient_id));

drop policy if exists cc_professional_read_shared on public.clinical_conditions;
create policy cc_professional_read_shared on public.clinical_conditions
  for select using (public.profesional_ve_hc(patient_id));

drop policy if exists ca_professional_read_shared on public.clinical_allergies;
create policy ca_professional_read_shared on public.clinical_allergies
  for select using (public.profesional_ve_hc(patient_id));

drop policy if exists co_professional_read_shared on public.clinical_observations;
create policy co_professional_read_shared on public.clinical_observations
  for select using (public.profesional_ve_hc(patient_id));

drop policy if exists cm_professional_read_shared on public.clinical_medications;
create policy cm_professional_read_shared on public.clinical_medications
  for select using (public.profesional_ve_hc(patient_id));

drop policy if exists clinical_notes_shared_patient on public.clinical_notes;
create policy clinical_notes_shared_patient on public.clinical_notes
  for select using (public.profesional_ve_hc(patient_id));

drop policy if exists professionals_read_patient_reports on public.diagnostic_reports;
create policy professionals_read_patient_reports on public.diagnostic_reports
  for select using (public.profesional_ve_hc(patient_id));

drop policy if exists docs_professional_select on public.medical_documents;
create policy docs_professional_select on public.medical_documents
  for select using (public.profesional_ve_hc(patient_id));

drop policy if exists activity_plans_pro_read_shared on public.activity_plans;
create policy activity_plans_pro_read_shared on public.activity_plans
  for select to authenticated using (public.profesional_ve_hc(patient_id));

drop policy if exists patient_docs_biovisor_shared_professional on storage.objects;
create policy patient_docs_biovisor_shared_professional on storage.objects
  for select using (
    bucket_id = 'patient-docs'
    and (storage.foldername(name))[2] = 'biovisor'
    and (storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    and public.profesional_ve_hc(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists patient_docs_documentos_shared_professional on storage.objects;
create policy patient_docs_documentos_shared_professional on storage.objects
  for select using (
    bucket_id = 'patient-docs'
    and (storage.foldername(name))[2] = 'documentos'
    and (storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    and public.profesional_ve_hc(((storage.foldername(name))[1])::uuid)
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- 4 · Las acciones (RPC)
-- ═══════════════════════════════════════════════════════════════════════════

-- 4a · Derivar. Lo hace un profesional que atendió (o tiene turno con) el paciente.
create or replace function public.crear_derivacion(
  p_patient_id             uuid,
  p_motivo                 text,
  p_profesional_destino_id uuid default null,
  p_vertical_destino       text default null,
  p_especialidad_destino   text default null,
  p_consulta_origen_id     uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_yo  uuid := auth.uid();
  v_id  uuid;
  v_vert text := nullif(btrim(coalesce(p_vertical_destino, '')), '');
  v_esp  text := nullif(btrim(coalesce(p_especialidad_destino, '')), '');
begin
  if v_yo is null then
    raise exception 'Tenés que iniciar sesión.' using errcode = '42501';
  end if;
  if public.get_my_role() is distinct from 'professional' then
    raise exception 'Sólo un profesional puede derivar.' using errcode = '42501';
  end if;
  if p_patient_id is null then
    raise exception 'Falta el paciente.' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_motivo, ''))) < 3 then
    raise exception 'Contá el motivo de la derivación.' using errcode = '22023';
  end if;
  if (p_profesional_destino_id is null) = (v_vert is null) then
    raise exception 'Elegí un profesional o una especialidad (uno de los dos).' using errcode = '22023';
  end if;
  if v_vert is not null and not exists (select 1 from public.vertical_settings vs where vs.id = v_vert) then
    raise exception 'Esa especialidad no existe.' using errcode = '22023';
  end if;
  if v_esp is not null and not exists (
    select 1 from public.specialties s where s.slug = v_esp and s.vertical_id = v_vert and s.active
  ) then
    raise exception 'Esa especialidad no corresponde al área elegida.' using errcode = '22023';
  end if;
  if p_profesional_destino_id = v_yo then
    raise exception 'No podés derivarte a vos mismo.' using errcode = '22023';
  end if;

  if not exists (select 1 from public.consultations c
                  where c.professional_id = v_yo and c.patient_id = p_patient_id) then
    raise exception 'Sólo podés derivar a pacientes que atendiste o que tienen turno con vos.' using errcode = '42501';
  end if;

  if p_consulta_origen_id is not null and not exists (
    select 1 from public.consultations c
     where c.id = p_consulta_origen_id and c.professional_id = v_yo and c.patient_id = p_patient_id
  ) then
    raise exception 'La consulta de origen no es de este paciente.' using errcode = '22023';
  end if;

  if p_profesional_destino_id is not null and not exists (
    select 1
      from public.profiles p
      join public.professional_profiles pp on pp.user_id = p.id
     where p.id = p_profesional_destino_id
       and p.role = 'professional'
       and pp.is_verified
       and coalesce(pp.is_active, true)
       and not coalesce(pp.dado_de_baja, false)
  ) then
    raise exception 'Ese profesional no está disponible para recibir derivaciones.' using errcode = '22023';
  end if;

  insert into public.derivaciones (
    patient_id, derivado_por, consulta_origen_id,
    profesional_destino_id, vertical_destino, especialidad_destino, motivo
  ) values (
    p_patient_id, v_yo, p_consulta_origen_id,
    p_profesional_destino_id, v_vert, v_esp, btrim(p_motivo)
  )
  returning id into v_id;

  return v_id;
end;
$$;
revoke all on function public.crear_derivacion(uuid, text, uuid, text, text, uuid) from public, anon;
grant execute on function public.crear_derivacion(uuid, text, uuid, text, text, uuid) to authenticated;

-- 4b · El paciente (o su titular) responde el consentimiento. Puede cambiarlo
-- después: cada respuesta queda en el historial.
create or replace function public.responder_consentimiento_derivacion(p_derivacion_id uuid, p_acepta boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_yo uuid := auth.uid();
  d    public.derivaciones%rowtype;
begin
  if p_acepta is null then
    raise exception 'Falta la respuesta.' using errcode = '22023';
  end if;
  select * into d from public.derivaciones where id = p_derivacion_id;
  if not found or not (d.patient_id = v_yo or public.es_titular_de(v_yo, d.patient_id)) then
    raise exception 'No encontramos esa derivación.' using errcode = '42501';
  end if;
  if d.estado in ('cancelada', 'vencida') then
    raise exception 'Esta derivación ya no está vigente.' using errcode = '22023';
  end if;

  update public.derivaciones
     set consentimiento_hc = p_acepta, consentimiento_at = now(), consentimiento_por = v_yo
   where id = p_derivacion_id;

  insert into public.derivacion_consentimientos (derivacion_id, acepta, respondido_por)
  values (p_derivacion_id, p_acepta, v_yo);
end;
$$;
revoke all on function public.responder_consentimiento_derivacion(uuid, boolean) from public, anon;
grant execute on function public.responder_consentimiento_derivacion(uuid, boolean) to authenticated;

-- 4c · Cancelar. El que derivó (o el super admin), mientras no esté reservada.
create or replace function public.cancelar_derivacion(p_derivacion_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_yo uuid := auth.uid();
  d    public.derivaciones%rowtype;
begin
  select * into d from public.derivaciones where id = p_derivacion_id;
  if not found or not (d.derivado_por = v_yo or public.get_my_role() = 'super_admin') then
    raise exception 'No encontramos esa derivación.' using errcode = '42501';
  end if;
  if d.estado <> 'pendiente' then
    raise exception 'Sólo se puede cancelar una derivación pendiente.' using errcode = '22023';
  end if;
  update public.derivaciones
     set estado = 'cancelada', cancelada_at = now(), cancelada_por = v_yo
   where id = p_derivacion_id;
end;
$$;
revoke all on function public.cancelar_derivacion(uuid) from public, anon;
grant execute on function public.cancelar_derivacion(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5 · La reserva queda vinculada
-- ═══════════════════════════════════════════════════════════════════════════
-- Antes de guardar la consulta: la derivación tiene que ser de ese paciente,
-- estar vigente y el profesional tiene que ser el destino (o de la especialidad).
create or replace function public.validar_consulta_derivada()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  d      public.derivaciones%rowtype;
  v_esp  text;
  v_vert text;
begin
  if new.derivacion_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.derivacion_id is not distinct from old.derivacion_id then return new; end if;

  select * into d from public.derivaciones where id = new.derivacion_id;
  if not found or d.patient_id is distinct from new.patient_id then
    raise exception 'La derivación no corresponde a este paciente.' using errcode = '22023';
  end if;
  -- Una reserva que quedó sin pagar (el pago falló o se abandonó) no bloquea:
  -- el turno nace `pending_payment` antes del cobro, y sin esto un reintento
  -- de pago o una reserva nueva chocaba contra la derivación ya "reservada".
  if d.vence_at < now() or not (
       d.estado = 'pendiente'
       or (d.estado = 'reservada' and exists (
             select 1 from public.consultations c
              where c.id = d.consulta_reservada_id
                and c.status = 'pending' and c.payment_status = 'pending_payment'))
     ) then
    raise exception 'La derivación ya no está vigente.' using errcode = '22023';
  end if;
  if d.profesional_destino_id is not null then
    if new.professional_id is distinct from d.profesional_destino_id then
      raise exception 'La derivación es para otro profesional.' using errcode = '22023';
    end if;
  else
    select pp.specialty, s.vertical_id into v_esp, v_vert
      from public.professional_profiles pp
      left join public.specialties s on s.slug = pp.specialty
     where pp.user_id = new.professional_id;
    if v_vert is distinct from d.vertical_destino
       or (d.especialidad_destino is not null and v_esp is distinct from d.especialidad_destino) then
      raise exception 'Ese profesional no es de la especialidad de la derivación.' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists consultations_validar_derivacion on public.consultations;
create trigger consultations_validar_derivacion
  before insert or update of derivacion_id on public.consultations
  for each row execute function public.validar_consulta_derivada();

-- Después: la derivación pasa a "reservada". Si el turno se cancela, vuelve a
-- pendiente (si no venció) para que el paciente pueda reservar de nuevo.
create or replace function public.marcar_derivacion_reservada()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.derivacion_id is null then return new; end if;

  if tg_op = 'INSERT' or new.derivacion_id is distinct from old.derivacion_id then
    update public.derivaciones
       set estado = 'reservada', consulta_reservada_id = new.id, reservada_at = now()
     where id = new.derivacion_id and estado in ('pendiente', 'reservada');
  elsif new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    update public.derivaciones
       set estado = case when vence_at < now() then 'vencida' else 'pendiente' end,
           consulta_reservada_id = null, reservada_at = null
     where id = new.derivacion_id and consulta_reservada_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists consultations_marcar_derivacion on public.consultations;
create trigger consultations_marcar_derivacion
  after insert or update of derivacion_id, status on public.consultations
  for each row execute function public.marcar_derivacion_reservada();

-- ═══════════════════════════════════════════════════════════════════════════
-- 6 · Avisos (push + mail, patrón 146/152)
-- ═══════════════════════════════════════════════════════════════════════════
-- Al paciente: push + mail. Al profesional destino (si es uno concreto): push.
-- El mail al profesional sale en el mismo envío que el del paciente.
-- Si es a una especialidad, el profesional se entera al reservarse el turno,
-- con el aviso de consulta nueva de siempre y la marca "Derivado por" en el turno.
create or replace function public.avisar_derivacion_nueva()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.enviar_push_tipo(new.patient_id, 'derivacion-nueva',
    jsonb_build_object('derivacionId', new.id));
  if new.profesional_destino_id is not null then
    perform public.enviar_push_tipo(new.profesional_destino_id, 'pro-derivacion-recibida',
      jsonb_build_object('derivacionId', new.id));
  end if;
  if new.mail_enviado_at is null then
    perform public.enviar_mail(jsonb_build_object('tipo', 'derivacion', 'derivacionId', new.id));
    update public.derivaciones set mail_enviado_at = now() where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists derivaciones_avisar_nueva on public.derivaciones;
create trigger derivaciones_avisar_nueva
  after insert on public.derivaciones
  for each row execute function public.avisar_derivacion_nueva();

-- ═══════════════════════════════════════════════════════════════════════════
-- 7 · Vencimiento
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.vencer_derivaciones()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_n integer;
begin
  update public.derivaciones set estado = 'vencida'
   where estado = 'pendiente' and vence_at < now();
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.vencer_derivaciones() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'vencer-derivaciones';
    perform cron.schedule('vencer-derivaciones', '17 3 * * *', 'select public.vencer_derivaciones()');
  end if;
end $$;
