-- ─────────────────────────────────────────────────────────────────────────────
-- 249 · Un turno agendado por el paciente se valida en la base (2026-11-25).
--
-- Hasta acá, el horario y el precio de un turno los decidía el front: el
-- wizard (`/paciente/reservar`, y en la app `booking/selecting-service`) arma
-- la grilla contra `professional_schedules`, descarta lo ya tomado, y manda
-- `scheduled_at` y `price_at_booking` en el INSERT. Nada en la base lo
-- revisaba, y `mp-payment` cobra `price_at_booking` tal cual. Cualquiera con
-- sesión de paciente podía insertar un turno fuera de la agenda, encima de
-- otro, en el pasado, o a otro precio. El perfil del profesional v2 suma
-- `?fecha=&hora=` en la URL del wizard (el horario se puede escribir a mano),
-- así que la guardia pasa a la base.
--
-- Qué hace, sólo en un INSERT de un turno AGENDADO hecho por el paciente:
--   1. El precio sale del profesional según la modalidad, igual que
--      `ofreceModalidad()` (src/lib/modalidad.js / mobile src/lib/modalidad.ts):
--        video      → price_video; si no tiene, session_price sólo para quien
--                     nunca cargó precio presencial.
--        presencial → price_presencial (la 220 ya rechaza si no hay).
--      Se PISA `price_at_booking` con ese valor: el front ya manda el mismo, así
--      que en el uso normal no cambia nada, y un valor manipulado no llega a MP.
--   2. `scheduled_at` tiene que ser futuro, caer dentro de una franja de
--      `professional_schedules` de ese día (hora de Buenos Aires), alineado a la
--      duración del slot (`platform_settings.slot_duration_minutes`) y entero
--      dentro de la franja — la misma cuenta que `buildTimeSlots()`.
--   3. No puede haber otra consulta activa (pending / confirmed / in_progress)
--      de ese profesional a esa misma hora — la misma regla que la grilla.
--
-- Una consulta inmediata (`is_on_demand`) insertada por el paciente (apps
-- viejas) tiene que ser para ahora (±15 min) y toma el precio de la vertical
-- (`vertical_settings.ondemand_price`): si no, marcarla era la forma de
-- saltearse esta guardia.
--
-- Qué NO toca (sigue igual que antes):
--   · la atención de emergencias (`emergency_id`) y lo que inserta el servidor
--     con service role (`auth.uid()` nulo: despacho on-demand, Edge Functions);
--   · lo que agenda el propio profesional (`auth.uid() = professional_id`) o un
--     admin / super admin, que pueden poner un turno fuera de su grilla;
--   · los UPDATE (reprogramar no pasa por acá).
--
-- Mensajes en castellano y con `hint` para que el front los muestre tal cual
-- (los dos clientes ya muestran `error.message`).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.validar_turno_agendado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_rol       text;
  v_pro       professional_profiles%rowtype;
  v_precio    numeric;
  v_slot      int;
  v_local     timestamp;
  v_hora      time;
  v_dow       int;
  v_en_agenda boolean;
  v_od        numeric;
begin
  if new.emergency_id is not null
     or new.professional_id is null
     or v_uid is null
     or v_uid = new.professional_id then
    return new;
  end if;

  v_rol := public.get_my_role();
  if v_rol in ('admin', 'super_admin') then
    return new;
  end if;

  -- Consulta inmediata insertada por el paciente (las apps viejas lo hacen;
  -- el despacho actual entra por service role y no llega acá). Sin esto,
  -- marcar `is_on_demand` era la forma de saltearse la guardia de abajo: un
  -- "turno" a futuro al precio que uno quisiera. La inmediata es para ahora
  -- y cuesta lo que dice la vertical.
  if coalesce(new.is_on_demand, false) then
    if new.scheduled_at is null then
      new.scheduled_at := now();
    elsif abs(extract(epoch from (new.scheduled_at - now()))) > 900 then
      raise exception 'La consulta inmediata es para ahora. Para otro horario, sacá un turno.'
        using errcode = 'check_violation', hint = 'inmediata_no_es_ahora';
    end if;
    select ondemand_price into v_od from vertical_settings where id = new.vertical;
    if v_od is not null and v_od > 0 then
      new.price_at_booking := v_od;
    end if;
    return new;
  end if;

  if new.scheduled_at is null then
    raise exception 'Elegí un día y un horario para el turno.'
      using errcode = 'check_violation', hint = 'turno_sin_horario';
  end if;

  select * into v_pro from professional_profiles where user_id = new.professional_id;
  if not found then
    return new; -- la FK se ocupa de un profesional inexistente
  end if;

  -- 1 · Precio según la modalidad (nunca el que manda el cliente).
  if new.modality = 'presencial' then
    v_precio := nullif(v_pro.price_presencial, 0);
  else
    v_precio := coalesce(
      nullif(v_pro.price_video, 0),
      case when coalesce(v_pro.price_presencial, 0) <= 0 then nullif(v_pro.session_price, 0) end
    );
  end if;
  if v_precio is null or v_precio <= 0 then
    raise exception 'Este profesional no tiene precio cargado para esta modalidad.'
      using errcode = 'check_violation', hint = 'turno_sin_precio';
  end if;
  new.price_at_booking := v_precio;

  -- 2 · El horario existe en su agenda.
  if new.scheduled_at <= now() then
    raise exception 'Ese horario ya pasó. Elegí otro.'
      using errcode = 'check_violation', hint = 'turno_en_el_pasado';
  end if;

  select coalesce(slot_duration_minutes, 15) into v_slot from platform_settings where id = 1;
  v_slot := coalesce(v_slot, 15);

  v_local := new.scheduled_at at time zone 'America/Argentina/Buenos_Aires';
  v_hora  := v_local::time;
  v_dow   := extract(dow from v_local)::int;

  -- Se acepta la grilla de la duración configurada Y la de 15 minutos: la app
  -- arma su grilla con 15 fijos (`SLOT_DURATION_MINUTES`), así que si el super
  -- admin cambia la duración, sus turnos no pueden empezar a rebotar acá. Lo
  -- que esta guardia frena es lo que no está en ninguna grilla (otra hora,
  -- otro día, fuera de la franja), no una diferencia de duración entre clientes.
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

  -- 3 · Nadie más lo tomó. El lock (hasta el fin de la transacción) ordena dos
  -- reservas simultáneas del mismo horario: la segunda espera, y como la
  -- función es volátil su consulta ve la fila de la primera ya confirmada.
  -- La clave va con el epoch (no con el texto del timestamptz, que depende del
  -- TimeZone de la sesión): el mismo instante da siempre el mismo lock.
  perform pg_advisory_xact_lock(hashtextextended(new.professional_id::text || '|' || extract(epoch from new.scheduled_at)::bigint::text, 249));
  if exists (
    select 1 from consultations c
    where c.professional_id = new.professional_id
      and c.scheduled_at = new.scheduled_at
      and c.status in ('pending', 'confirmed', 'in_progress')
      and c.emergency_id is null
  ) then
    raise exception 'Ese horario ya no está libre. Elegí otro.'
      using errcode = 'unique_violation', hint = 'turno_ocupado';
  end if;

  return new;
end;
$$;

comment on function public.validar_turno_agendado() is
  'Migración 249. INSERT de un turno agendado por el paciente: precio según la modalidad (pisa price_at_booking), horario futuro, dentro de la agenda y alineado al slot, y sin otra consulta activa a esa hora. Una inmediata del paciente: para ahora y al precio de la vertical. Exime emergencias, service role, el propio profesional y admins.';

drop trigger if exists consultations_turno_agendado on public.consultations;
create trigger consultations_turno_agendado
  before insert on public.consultations
  for each row execute function public.validar_turno_agendado();
