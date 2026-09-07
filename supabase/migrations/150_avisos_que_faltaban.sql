-- 150 — Los avisos que faltaban, y los que se perdían.
--
-- Auditoría del 2026-09-06 (pedido de Mateo: "¿todo esto está con push para el
-- paciente y para el profesional? Lo mismo para las reservas y on-demand").
-- Resultado: sólo TRES avisos salían de la base, y los tres eran para el
-- profesional (migración 091). Todo lo que recibe el PACIENTE salía de un
-- `functions.invoke` del navegador del website, con dos agujeros:
--
--   1. Se pierde si esa pestaña se cierra antes de que salga la llamada.
--   2. **No sale nunca si la acción se hizo desde la app.** Un profesional que
--      cancela un turno desde su teléfono dejaba al paciente sin ningún aviso,
--      porque ese código sólo existe en `website/src/services`.
--
-- Es exactamente el problema que la 091 vino a resolver para el lado del
-- profesional; el lado del paciente quedó sin migrar. Y las emergencias no
-- tenían nada: el paciente no se enteraba de que el médico salió ni de que
-- llegó, salvo que tuviera la pantalla abierta.
--
-- Todo pasa a triggers, con el helper `enviar_push` de 091/144 (pg_net, así que
-- un fallo de la Edge Function nunca aborta la transacción que lo disparó).
--
-- 🔴 Al aplicar esto hay que SACAR los `functions.invoke('send-push-notification')`
-- equivalentes de `consultationsService.js` y `emergencyService.js`, o llegan
-- dos veces.

-- ═════════════════════════════════════════════════════════════════════════════
-- A. EMERGENCIAS
-- ═════════════════════════════════════════════════════════════════════════════

-- A1 · Al profesional: te asignaron una emergencia.
-- Existía en el website; desde la app no salía ninguna.
create or replace function public.avisar_emergencia_asignada()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.professional_id is null then return new; end if;

  perform public.enviar_push(
    new.professional_id,
    '🚨 Emergencia asignada',
    'Código ' || coalesce(new.triage_code, '') ||
      case when new.dispatch_code is not null then ' (' || new.dispatch_code || ')' else '' end ||
      '. Abrí la app para aceptarla.',
    '/profesional/emergencias?id=' || new.id::text
  );
  return new;
end;
$$;

drop trigger if exists emergencies_avisar_asignada on public.emergencies;
create trigger emergencies_avisar_asignada
  after insert on public.emergencies
  for each row execute function public.avisar_emergencia_asignada();

-- A2/A3 · Al paciente: el médico salió, y el médico llegó.
-- Son los dos momentos en los que puede dejar de mirar la pantalla.
create or replace function public.avisar_emergencia_estado()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.patient_id is null then return new; end if;

  if new.status = 'in_transit' then
    perform public.enviar_push(
      new.patient_id,
      'El médico va en camino',
      'Ya salió hacia tu ubicación. Podés seguirlo en el mapa.',
      '/paciente/sos'
    );
  elsif new.status = 'arrived' then
    perform public.enviar_push(
      new.patient_id,
      'El médico llegó',
      'Está en tu ubicación.',
      '/paciente/sos'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists emergencies_avisar_estado on public.emergencies;
create trigger emergencies_avisar_estado
  after update of status on public.emergencies
  for each row
  when (new.status is distinct from old.status and new.status in ('in_transit', 'arrived'))
  execute function public.avisar_emergencia_estado();

-- A4 · Cancelación: se avisa al OTRO lado, nunca a quien la canceló.
-- `auth.uid()` es quien hizo el request; con service role o desde un cron viene
-- NULL y entonces se avisa a los dos, que es lo correcto.
create or replace function public.avisar_emergencia_cancelada()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_quien uuid := auth.uid();
begin
  if v_quien is distinct from new.patient_id then
    perform public.enviar_push(
      new.patient_id,
      'Tu emergencia se canceló',
      'Podés volver a pedir atención cuando lo necesites.',
      '/paciente/sos'
    );
  end if;

  if new.professional_id is not null and v_quien is distinct from new.professional_id then
    perform public.enviar_push(
      new.professional_id,
      'La emergencia se canceló',
      'El pedido ya no está activo.',
      '/profesional/dashboard'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists emergencies_avisar_cancelada on public.emergencies;
create trigger emergencies_avisar_cancelada
  after update of status on public.emergencies
  for each row
  when (new.status = 'cancelled' and old.status is distinct from 'cancelled')
  execute function public.avisar_emergencia_cancelada();

-- ═════════════════════════════════════════════════════════════════════════════
-- B. CONSULTAS — el lado del paciente, que nunca se migró
-- ═════════════════════════════════════════════════════════════════════════════

-- B1 · Al paciente: te agendaron un turno.
-- Sólo cuando lo agendó el profesional; si reservó el propio paciente, ya lo
-- sabe. No hay columna `booked_by`: quien lo creó es `auth.uid()`, igual que en
-- la 091 pero al revés.
create or replace function public.avisar_turno_agendado()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.patient_id is null or new.professional_id is null then return new; end if;
  if auth.uid() is distinct from new.professional_id then return new; end if;

  perform public.enviar_push(
    new.patient_id,
    'Te agendaron un turno',
    case
      when new.scheduled_at is not null then
        'Tu profesional agendó una consulta para el ' ||
        to_char(new.scheduled_at at time zone 'America/Argentina/Buenos_Aires', 'DD/MM')  ||
        ' a las ' ||
        to_char(new.scheduled_at at time zone 'America/Argentina/Buenos_Aires', 'HH24:MI') || '.'
      else 'Tu profesional agendó una consulta de seguimiento.'
    end,
    '/paciente/consultas'
  );
  return new;
end;
$$;

drop trigger if exists consultations_avisar_agendado on public.consultations;
create trigger consultations_avisar_agendado
  after insert on public.consultations
  for each row execute function public.avisar_turno_agendado();

-- B2/B3 · Al paciente: turno confirmado, y el profesional ya está en la sala.
-- El segundo es el aviso más importante de la plataforma: es el que hace que
-- una videoconsulta empiece. Salía del navegador del profesional.
create or replace function public.avisar_estado_al_paciente()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.patient_id is null then return new; end if;

  if new.status = 'confirmed' then
    perform public.enviar_push(
      new.patient_id,
      'Turno confirmado',
      'Tu consulta fue confirmada por el profesional.',
      '/paciente/consultas'
    );
  elsif new.status = 'in_progress' then
    perform public.enviar_push(
      new.patient_id,
      '¡El profesional está listo!',
      'Tu consulta comenzó. Entrá a la sala ahora.',
      case when new.daily_room_url is not null
        then '/paciente/videollamada/' || new.id::text
        else '/paciente/sala-espera/' || new.id::text
      end
    );
  end if;
  return new;
end;
$$;

drop trigger if exists consultations_avisar_paciente on public.consultations;
create trigger consultations_avisar_paciente
  after update of status on public.consultations
  for each row
  when (new.status is distinct from old.status and new.status in ('confirmed', 'in_progress'))
  execute function public.avisar_estado_al_paciente();

-- B4 · Cancelación: al otro lado. `cancelled_by` cuando está, `auth.uid()` si no.
create or replace function public.avisar_consulta_cancelada()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_quien uuid := coalesce(new.cancelled_by, auth.uid());
begin
  if new.patient_id is not null and v_quien is distinct from new.patient_id then
    perform public.enviar_push(
      new.patient_id,
      'Consulta cancelada',
      'Tu consulta fue cancelada. Podés reservar un nuevo turno.',
      '/paciente/consultas'
    );
  end if;

  if new.professional_id is not null and v_quien is distinct from new.professional_id then
    perform public.enviar_push(
      new.professional_id,
      'Un paciente canceló',
      'Se liberó el turno en tu agenda.',
      '/profesional/agenda'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists consultations_avisar_cancelada on public.consultations;
create trigger consultations_avisar_cancelada
  after update of status on public.consultations
  for each row
  when (new.status = 'cancelled' and old.status is distinct from 'cancelled')
  execute function public.avisar_consulta_cancelada();

-- ═════════════════════════════════════════════════════════════════════════════
-- C. Recordatorio al profesional, 1 h antes
-- ═════════════════════════════════════════════════════════════════════════════
-- Marca propia: la del paciente (`reminder_sent`) ya está puesta cuando el cron
-- llega hasta acá, así que compartirla dejaría al profesional sin recordatorio.
-- Lo manda `appointment-reminders`, no un trigger: es un evento de tiempo, no
-- de cambio de fila.
alter table public.consultations
  add column if not exists pro_reminder_1h_sent boolean not null default false;

comment on column public.consultations.pro_reminder_1h_sent is
  'Recordatorio de 1 h enviado al profesional. Separado de reminder_sent, que es el del paciente.';
