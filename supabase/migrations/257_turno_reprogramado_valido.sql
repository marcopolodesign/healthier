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
--   · Nadie más puede cambiar `price_at_booking`, `professional_id`,
--     `is_on_demand` ni `modality`. La modalidad tampoco el profesional: el
--     precio depende de ella y lo fija el servidor al reservar; cambiarla sin
--     recalcular dejaría cobrando el precio de la otra. Ningún front la cambia.
--   · Si cambia `scheduled_at` (cualquier diferencia, también de segundos —
--     el turno ocupado se busca por instante exacto en la 249):
--       - sólo un turno vivo (`pending` / `confirmed`);
--       - inmediata: para ahora (±15 min), igual que la 249 en el alta;
--       - el horario nuevo tiene que ser futuro y en minuto redondo;
--       - el paciente: dentro de una franja de `professional_schedules`,
--         alineado al slot — la misma cuenta que la 249;
--       - el profesional de la consulta es el dueño de la agenda y la 249 ya le
--         deja agendar fuera de su grilla, así que acá tampoco se le exige la
--         grilla. Sí se le exige futuro y que el horario esté libre: mover un
--         turno encima de otro de él mismo deja a dos pacientes con la misma
--         hora, y eso no es una decisión de agenda sino un error;
--       - para todos: que no se superponga con otra consulta viva del mismo
--         profesional (rango de un slot, no sólo el mismo instante), con el
--         mismo lock que la 249 para que un alta y un movimiento no se crucen.
--   · La cuenta "el slot entra entero en la franja" se hace en minutos del
--     día (en `time` 23:50 + 15 min da 00:05 y pasaba). La 249 tiene la misma
--     cuenta en `time`; queda anotado para cuando se toque.
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

  v_es_pro := coalesce(v_uid = old.professional_id, false);

  -- 1 · Lo que define cuánto se cobra y a quién, no lo cambia el cliente.
  if new.price_at_booking is distinct from old.price_at_booking
     or new.professional_id is distinct from old.professional_id
     or new.is_on_demand is distinct from old.is_on_demand
     or new.modality is distinct from old.modality then
    raise exception 'Ese dato del turno no se puede cambiar. Si necesitás otro profesional o modalidad, cancelalo y sacá uno nuevo.'
      using errcode = 'check_violation', hint = 'turno_dato_protegido';
  end if;

  -- 2 · El horario.
  if new.scheduled_at is not distinct from old.scheduled_at then
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

  if extract(second from new.scheduled_at) <> 0 then
    raise exception 'Ese horario no está en la agenda del profesional. Elegí otro.'
      using errcode = 'check_violation', hint = 'turno_fuera_de_agenda';
  end if;

  select coalesce(slot_duration_minutes, 15) into v_slot from platform_settings where id = 1;
  v_slot := coalesce(v_slot, 15);

  if not v_es_pro then
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
        and extract(epoch from v_hora) / 60 + dur.d <= extract(epoch from s.end_time) / 60
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
      and c.scheduled_at < new.scheduled_at + make_interval(mins => v_slot)
      and new.scheduled_at < c.scheduled_at + make_interval(mins => v_slot)
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
  'Migración 257. UPDATE de una consulta hecho por el paciente o el profesional: precio, profesional, modalidad e inmediata no se tocan; mover el horario exige turno vivo, futuro, en minuto redondo, sin superponerse con otro turno vivo del profesional y —para el paciente— dentro de la agenda y alineado al slot. Exime service role, admin/super admin y emergencias.';

drop trigger if exists consultations_validar_cambio_de_turno on public.consultations;
create trigger consultations_validar_cambio_de_turno
  before update of scheduled_at, price_at_booking, professional_id, modality, is_on_demand
  on public.consultations
  for each row execute function public.validar_cambio_de_turno();
