-- ─────────────────────────────────────────────────────────────────────────────
-- 257 · Mover un turno también se valida en la base (2026-11-27, OK de Mateo).
--
-- La 249 valida el INSERT de un turno (horario en la agenda, futuro, libre,
-- precio del servidor), pero los UPDATE quedaban abiertos: la policy
-- `consultations_access` deja que el paciente (y el titular de un familiar)
-- haga UPDATE de su consulta, así que con una llamada a la API podía moverse el
-- turno a cualquier hora (fuera de agenda, encima de otro, al pasado) o
-- cambiarle el precio, el profesional, la modalidad o marcarla inmediata.
--
-- Hoy ningún front reprograma moviendo `scheduled_at` salvo el super admin
-- (`/super-admin/consultas`): el "Agendar próxima consulta" del profesional
-- crea una consulta nueva (INSERT, ya cubierto por la 249), y la app no tiene
-- reprogramar. Esta guardia es para la API, no cambia ninguna pantalla.
--
-- Qué hace, en un UPDATE que toque esas columnas:
--   · Pasan sin revisar: service role / cron (`auth.uid()` nulo), admin y
--     super admin, y la atención de emergencias (la maneja su módulo).
--   · Nadie más puede cambiar `price_at_booking`, `professional_id` ni
--     `is_on_demand`. La `modality` sólo la puede cambiar el profesional de la
--     consulta (la 220 ya valida que tenga precio presencial).
--   · Si cambia `scheduled_at` (al minuto):
--       - sólo un turno vivo (`pending` / `confirmed`);
--       - inmediata: para ahora (±15 min), igual que la 249 en el alta;
--       - el horario nuevo tiene que ser futuro;
--       - el paciente: dentro de una franja de `professional_schedules`,
--         alineado al slot — la misma cuenta que la 249;
--       - el profesional de la consulta es el dueño de la agenda y la 249 ya le
--         deja agendar fuera de su grilla, así que acá tampoco se le exige la
--         grilla. Sí se le exige futuro y que el horario esté libre: mover un
--         turno encima de otro de él mismo deja a dos pacientes con la misma
--         hora, y eso no es una decisión de agenda sino un error;
--       - para todos: sin otra consulta viva del mismo profesional a esa hora
--         (con el mismo lock que la 249, así un alta y un movimiento al mismo
--         horario no se cruzan).
-- Mensajes en castellano y con `hint`, como la 249: los fronts muestran
-- `error.message` tal cual.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.validar_cambio_de_turno()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_rol       text;
  v_es_pro    boolean;
  v_slot      int;
  v_local     timestamp;
  v_hora      time;
  v_dow       int;
  v_en_agenda boolean;
begin
  if v_uid is null or old.emergency_id is not null then
    return new;
  end if;
  v_rol := public.get_my_role();
  if v_rol in ('admin', 'super_admin') then
    return new;
  end if;

  v_es_pro := v_uid = old.professional_id;

  -- 1 · Lo que define cuánto se cobra y a quién, no lo cambia el cliente.
  if new.price_at_booking is distinct from old.price_at_booking
     or new.professional_id is distinct from old.professional_id
     or new.is_on_demand is distinct from old.is_on_demand
     or (not v_es_pro and new.modality is distinct from old.modality) then
    raise exception 'Ese dato del turno no se puede cambiar. Si necesitás otro profesional o modalidad, cancelalo y sacá uno nuevo.'
      using errcode = 'check_violation', hint = 'turno_dato_protegido';
  end if;

  -- 2 · El horario.
  if date_trunc('minute', new.scheduled_at) is not distinct from date_trunc('minute', old.scheduled_at) then
    return new;
  end if;

  if new.scheduled_at is null then
    raise exception 'Elegí un día y un horario para el turno.'
      using errcode = 'check_violation', hint = 'turno_sin_horario';
  end if;

  if coalesce(old.status, '') not in ('pending', 'confirmed') then
    raise exception 'Este turno ya no se puede reprogramar.'
      using errcode = 'check_violation', hint = 'turno_no_reprogramable';
  end if;

  if coalesce(old.is_on_demand, false) then
    if abs(extract(epoch from (new.scheduled_at - now()))) > 900 then
      raise exception 'La consulta inmediata es para ahora. Para otro horario, sacá un turno.'
        using errcode = 'check_violation', hint = 'inmediata_no_es_ahora';
    end if;
    return new;
  end if;

  if new.scheduled_at <= now() then
    raise exception 'Ese horario ya pasó. Elegí otro.'
      using errcode = 'check_violation', hint = 'turno_en_el_pasado';
  end if;

  if not v_es_pro then
    select coalesce(slot_duration_minutes, 15) into v_slot from platform_settings where id = 1;
    v_slot  := coalesce(v_slot, 15);
    v_local := new.scheduled_at at time zone 'America/Argentina/Buenos_Aires';
    v_hora  := v_local::time;
    v_dow   := extract(dow from v_local)::int;
    select exists (
      select 1
      from professional_schedules s
      cross join (select distinct d from unnest(array[v_slot, 15]) as d) dur
      where s.professional_id = new.professional_id
        and s.day_of_week = v_dow
        and v_hora >= s.start_time
        and v_hora + make_interval(mins => dur.d) <= s.end_time
        and (extract(epoch from (v_hora - s.start_time))::int / 60) % dur.d = 0
        and extract(second from v_hora) = 0
    ) into v_en_agenda;
    if not v_en_agenda then
      raise exception 'Ese horario no está en la agenda del profesional. Elegí otro.'
        using errcode = 'check_violation', hint = 'turno_fuera_de_agenda';
    end if;
  end if;

  -- Mismo lock que la 249 (misma clave): un alta y un movimiento al mismo
  -- horario del mismo profesional se ordenan.
  perform pg_advisory_xact_lock(hashtextextended(new.professional_id::text || '|' || extract(epoch from new.scheduled_at)::bigint::text, 249));
  if exists (
    select 1 from consultations c
    where c.professional_id = new.professional_id
      and c.scheduled_at = new.scheduled_at
      and c.id <> new.id
      and c.status in ('pending', 'confirmed', 'in_progress')
      and c.emergency_id is null
  ) then
    raise exception 'Ese horario ya no está libre. Elegí otro.'
      using errcode = 'unique_violation', hint = 'turno_ocupado';
  end if;

  return new;
end;
$$;

comment on function public.validar_cambio_de_turno() is
  'Migración 257. UPDATE de una consulta hecho por el paciente o el profesional: precio, profesional e inmediata no se tocan (modalidad sólo el profesional); mover el horario exige turno vivo, futuro, libre y —para el paciente— dentro de la agenda y alineado al slot. Exime service role, admin/super admin y emergencias.';

drop trigger if exists consultations_validar_cambio_de_turno on public.consultations;
create trigger consultations_validar_cambio_de_turno
  before update of scheduled_at, price_at_booking, professional_id, modality, is_on_demand
  on public.consultations
  for each row execute function public.validar_cambio_de_turno();
