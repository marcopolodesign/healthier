-- ============================================================
-- Migration 177 — La atención de una emergencia queda como una consulta
-- ============================================================
-- Mateo, 2026-09-28: al llegar la ambulancia, el médico tiene que poder cargar
-- la atención con lo mismo que usa en cualquier consulta (historia clínica,
-- nota, recetario), y que quede como una consulta dentro de la emergencia.
-- Decisiones suyas:
--   · La carga SÓLO el médico del móvil (`emergencies.professional_id`).
--   · Al abrirla NO se le avisa nada al paciente ("turno confirmado", mail de
--     reserva, aviso al profesional): tiene la ambulancia al lado. Al cerrarla
--     sí, como cualquier consulta (resumen, receta).
--   · La emergencia no se cierra sin registro: o la consulta está cerrada, o
--     se deja un motivo de cierre sin atención (ej. traslado).
--
-- Se reutiliza la consulta presencial que ya existe (la pantalla de la web
-- /profesional/consulta/:id): no hay un tipo nuevo de consulta.
-- ============================================================

-- ── 1. El vínculo ──────────────────────────────────────────
ALTER TABLE public.consultations
  ADD COLUMN IF NOT EXISTS emergency_id uuid NULL REFERENCES public.emergencies(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS consultations_emergency_id_key
  ON public.consultations (emergency_id) WHERE emergency_id IS NOT NULL;
COMMENT ON COLUMN public.consultations.emergency_id IS
  'Emergencia de la que salió esta consulta (la atención en el lugar). NULL = consulta común.';

ALTER TABLE public.emergencies
  ADD COLUMN IF NOT EXISTS cierre_sin_atencion text NULL;
COMMENT ON COLUMN public.emergencies.cierre_sin_atencion IS
  'Por qué se cerró sin consulta (ej. traslado a guardia). NULL = se cerró con su consulta.';

-- ── 2. Sin avisos al abrirla ───────────────────────────────
-- Se cambia sólo la condición de los triggers de alta, no sus funciones.
DROP TRIGGER IF EXISTS consultations_avisar_agendado ON public.consultations;
CREATE TRIGGER consultations_avisar_agendado AFTER INSERT ON public.consultations
  FOR EACH ROW WHEN (NEW.emergency_id IS NULL) EXECUTE FUNCTION public.avisar_turno_agendado();

DROP TRIGGER IF EXISTS consultations_avisar_nueva ON public.consultations;
CREATE TRIGGER consultations_avisar_nueva AFTER INSERT ON public.consultations
  FOR EACH ROW WHEN (NEW.emergency_id IS NULL) EXECUTE FUNCTION public.avisar_consulta_nueva();

DROP TRIGGER IF EXISTS consultations_mail_reserva ON public.consultations;
CREATE TRIGGER consultations_mail_reserva AFTER INSERT ON public.consultations
  FOR EACH ROW WHEN (NEW.emergency_id IS NULL) EXECUTE FUNCTION public.avisar_reserva_por_mail();

-- ── 3. La consulta de la emergencia no se cobra aparte ─────
-- La emergencia ya se pagó: su consulta va `exempt`. El guardia del estado de
-- pago sólo lo permite para el médico del móvil de ESA emergencia.
CREATE OR REPLACE FUNCTION public.proteger_payment_status_consultations()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.role() = 'service_role' or public.get_my_role() = 'super_admin' then
    return new;
  end if;

  -- Atención de una emergencia (migración 177).
  if new.emergency_id is not null and new.payment_status = 'exempt' and exists (
    select 1 from public.emergencies e
    where e.id = new.emergency_id and e.professional_id = auth.uid()
  ) then
    return new;
  end if;

  if new.patient_id = auth.uid() and new.payment_status = 'exempt' then
    if exists (select 1 from public.profiles where id = auth.uid() and payment_exempt = true) then
      return new;
    end if;
    raise exception 'Esta cuenta no tiene la videollamada bonificada.'
      using errcode = '42501';
  end if;

  if new.payment_status = 'pending_payment'
     and (new.patient_id = auth.uid() or new.professional_id = auth.uid()) then
    return new;
  end if;

  raise exception 'No autorizado para modificar el estado de pago de esta consulta.'
    using errcode = '42501';
end;
$function$;

-- ── 4. Abrir (o retomar) la atención ───────────────────────
-- Idempotente: si ya hay consulta para la emergencia, devuelve esa.
CREATE OR REPLACE FUNCTION public.iniciar_atencion_emergencia(p_emergency_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  e public.emergencies%rowtype;
  cid uuid;
begin
  select * into e from public.emergencies where id = p_emergency_id for update;
  if not found then
    raise exception 'No existe la emergencia' using errcode = 'P0002';
  end if;
  if e.professional_id is distinct from auth.uid() then
    raise exception 'Sólo el médico del móvil puede cargar la atención' using errcode = '42501';
  end if;
  if e.status not in ('dispatched', 'in_transit', 'arrived') then
    raise exception 'La emergencia no está en curso (%).', e.status using errcode = 'check_violation';
  end if;

  select id into cid from public.consultations where emergency_id = e.id;
  if cid is not null then
    return cid;
  end if;

  insert into public.consultations (
    patient_id, professional_id, status, modality, payment_status, price_at_booking,
    scheduled_at, started_at, emergency_id
  ) values (
    e.patient_id, e.professional_id, 'in_progress', 'presencial', 'exempt', 0,
    now(), now(), e.id
  ) returning id into cid;

  return cid;
end;
$function$;

REVOKE ALL ON FUNCTION public.iniciar_atencion_emergencia(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.iniciar_atencion_emergencia(uuid) TO authenticated;

-- ── 5. No se cierra sin registro + se libera el móvil ──────
CREATE OR REPLACE FUNCTION public.cerrar_emergencia_con_registro()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  estado_consulta text;
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    -- Vía de escape de siempre: service_role y super admin.
    if auth.uid() is not null and public.get_my_role() is distinct from 'super_admin' then
      select status into estado_consulta from public.consultations where emergency_id = new.id;
      if estado_consulta is distinct from 'completed' and nullif(trim(new.cierre_sin_atencion), '') is null then
        raise exception using
          errcode = 'check_violation',
          message = case when estado_consulta is null
            then 'Antes de cerrar la emergencia cargá la atención, o indicá por qué se cierra sin atención.'
            else 'Antes de cerrar la emergencia cerrá la consulta.' end;
      end if;
    end if;
  end if;

  -- Al terminar (cerrada o cancelada) el móvil vuelve a estar disponible.
  -- Antes se quedaba "en servicio" para siempre y no se le podía asignar otra.
  if new.status in ('completed', 'cancelled') and old.status is distinct from new.status
     and new.ambulance_id is not null then
    update public.ambulances set status = 'disponible'
    where id = new.ambulance_id and status = 'en_servicio';
  end if;

  return new;
end;
$function$;

DROP TRIGGER IF EXISTS emergencies_cierre_con_registro ON public.emergencies;
CREATE TRIGGER emergencies_cierre_con_registro BEFORE UPDATE OF status ON public.emergencies
  FOR EACH ROW EXECUTE FUNCTION public.cerrar_emergencia_con_registro();
