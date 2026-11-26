-- ─────────────────────────────────────────────────────────────────────────────
-- 255 · Turno reprogramado desde el admin: mail a los dos y sala limpia
--       (2026-11-26, pedido de Mateo).
--
-- Hasta acá, cuando el equipo cambiaba la fecha de una consulta desde
-- `/super-admin/consultas`, no se enteraba nadie: el mail de reserva sale sólo
-- en el INSERT (143/146). El paciente seguía con la fecha vieja en la cabeza.
--
-- Dos triggers, los dos acotados a `scheduled_at`:
--
-- 1 · BEFORE — la sala de video vieja se suelta.
--     `daily-token` crea una sala nueva cuando la guardada venció, pero la
--     reclamaba con `daily_room_name IS NULL`: si el nombre viejo seguía en la
--     fila, el reclamo no afectaba filas, se borraba la sala recién creada y se
--     devolvía la vencida. La consulta reprogramada quedaba sin videollamada.
--     Se arregla de los dos lados: acá se limpia la sala al reprogramar, y
--     `daily-token` ahora reclama contra el nombre que tenía (ver la función).
--     No toca emergencias (su sala la maneja la atención de emergencia).
--     Vale para cualquiera que reprograme, no sólo el admin: una sala armada
--     para otro horario nunca sirve para el nuevo (vencen a las 24 h).
--
-- 2 · AFTER — el mail `reprogramada` al paciente y al profesional.
--     Sólo si quien cambia la fecha es admin / super admin (`get_my_role()`):
--     es lo que se pidió. El service role (`auth.uid()` nulo) no manda.
--     No sale para inmediatas, emergencias, turnos que ya no están vivos
--     (sólo `pending` / `confirmed`) ni si la fecha nueva ya pasó (corregir un
--     registro viejo no es avisarle a nadie).
--     La comparación es al minuto: el form del super admin manda la fecha en
--     cada guardado (datetime-local, sin segundos), y guardar el estado o el
--     pago sin tocar la fecha no puede disparar un mail.
--     Sin marca de "ya se mandó": cada reprogramación es un aviso nuevo.
--
-- Los recordatorios ya se reinician solos al cambiar la fecha (041).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.reprogramacion_suelta_la_sala()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if date_trunc('minute', new.scheduled_at) is distinct from date_trunc('minute', old.scheduled_at)
     and not coalesce(new.is_on_demand, false)
     and new.emergency_id is null
     and new.status in ('pending', 'confirmed') then
    new.daily_room_url  := null;
    new.daily_room_name := null;
  end if;
  return new;
end;
$$;

comment on function public.reprogramacion_suelta_la_sala() is
  'Migración 255. Al cambiar scheduled_at de un turno vivo (pending/confirmed, no inmediato ni emergencia) limpia daily_room_url/daily_room_name: la sala vieja es de otro horario y daily-token arma una nueva al entrar.';

drop trigger if exists consultations_reprogramada_sala on public.consultations;
create trigger consultations_reprogramada_sala
  before update of scheduled_at on public.consultations
  for each row execute function public.reprogramacion_suelta_la_sala();


create or replace function public.avisar_reprogramacion_por_mail()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if date_trunc('minute', new.scheduled_at) is not distinct from date_trunc('minute', old.scheduled_at)
     or new.scheduled_at is null
     or new.scheduled_at <= now()
     or coalesce(new.is_on_demand, false)
     or new.emergency_id is not null
     or coalesce(new.status, '') not in ('pending', 'confirmed') then
    return new;
  end if;

  if coalesce(public.get_my_role(), '') not in ('admin', 'super_admin') then
    return new;
  end if;

  perform public.enviar_mail(jsonb_build_object(
    'tipo',           'reprogramada',
    'consultationId', new.id,
    'anterior',       old.scheduled_at
  ));
  return new;
end;
$$;

comment on function public.avisar_reprogramacion_por_mail() is
  'Migración 255. Cuando admin/super admin cambia scheduled_at de un turno vivo y futuro, manda el mail reprogramada (paciente + profesional) con la fecha anterior.';

revoke all on function public.avisar_reprogramacion_por_mail() from public, anon, authenticated;

drop trigger if exists consultations_mail_reprogramada on public.consultations;
create trigger consultations_mail_reprogramada
  after update of scheduled_at on public.consultations
  for each row execute function public.avisar_reprogramacion_por_mail();
