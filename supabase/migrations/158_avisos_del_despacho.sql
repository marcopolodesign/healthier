-- ============================================================
-- Migración 158 — Los avisos, ahora que despacha una persona
-- ============================================================
-- La 150 avisaba "te asignaron una emergencia" con un trigger `after insert`
-- sobre `emergencies`, porque hasta la 156 la asignación pasaba en el mismo
-- insert: el sistema sorteaba un profesional y lo escribía ahí.
--
-- Con el flujo nuevo el insert nace SIN nadie asignado (`professional_id` en
-- NULL, estado `pending`), así que ese trigger hacía `return new` y salía sin
-- mandar nada. El aviso más importante del módulo se habría vuelto mudo en
-- silencio — que es exactamente lo que ya pasó una vez cuando el disparo vivía
-- en el front y la app quedó sin avisar a nadie.
--
-- Acá se mueve al momento en que la asignación de verdad ocurre, y se le avisa
-- a TODA la tripulación: el chofer es el que maneja, y hasta hoy no recibía
-- nada porque el aviso iba sólo al médico.
-- ============================================================

-- ── A1 · A la tripulación: salieron ───────────────────────────────────────
create or replace function public.avisar_emergencia_asignada()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_tripulante uuid;
  v_movil      text;
begin
  if new.ambulance_id is null then return new; end if;

  select label into v_movil from public.ambulances where id = new.ambulance_id;

  for v_tripulante in
    select profile_id from public.ambulance_crew
     where ambulance_id = new.ambulance_id and active
  loop
    perform public.enviar_push(
      v_tripulante,
      '🚨 Emergencia asignada',
      'Código ' || coalesce(new.triage_code, '') ||
        case when new.dispatch_code is not null then ' (' || new.dispatch_code || ')' else '' end ||
        case when v_movil is not null then ' · ' || v_movil else '' end ||
        '. Abrí la app para salir.',
      '/profesional/emergencias?id=' || new.id::text
    );
  end loop;

  return new;
end;
$$;

drop trigger if exists emergencies_avisar_asignada on public.emergencies;

-- `after update of ambulance_id`: el momento del despacho. La condición del
-- `when` evita que un update posterior sobre la misma fila (llegó, terminó)
-- vuelva a mandar el aviso.
create trigger emergencies_avisar_asignada
  after update of ambulance_id on public.emergencies
  for each row
  when (new.ambulance_id is not null and new.ambulance_id is distinct from old.ambulance_id)
  execute function public.avisar_emergencia_asignada();

-- ── A4 · Al despacho: entró un pedido a la cola ───────────────────────────
-- Es el aviso que no existía porque no existía la cola. Sin esto, que una
-- solicitud paga se atienda depende de que el operador tenga la pantalla
-- abierta y la esté mirando — y un ROJO no puede depender de eso.
create or replace function public.avisar_pedido_en_cola()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_operador uuid;
begin
  -- Sólo cuando entra a la cola de verdad: paga y triada.
  if new.status is distinct from 'awaiting_dispatch' or new.paid_at is null then
    return new;
  end if;

  -- Todavía no tiene entidad asignada —la elige el operador al tomarla—, así
  -- que se le avisa al staff de todas las entidades activas. Con una sola
  -- entidad es lo mismo; con dos, la primera que la toma se la queda.
  for v_operador in
    select s.profile_id
      from public.emergency_provider_staff s
      join public.emergency_providers p on p.id = s.provider_id
     where s.active and p.active
  loop
    perform public.enviar_push(
      v_operador,
      case when new.triage_code = 'ROJO' then '🔴 Pedido ROJO en cola' else '🚑 Nuevo pedido de ambulancia' end,
      'Código ' || coalesce(new.triage_code, '') || '. Esperando que le asignes un móvil.',
      '/despacho'
    );
  end loop;

  return new;
end;
$$;

drop trigger if exists emergencies_avisar_en_cola on public.emergencies;
create trigger emergencies_avisar_en_cola
  after update of status on public.emergencies
  for each row
  when (new.status = 'awaiting_dispatch' and old.status is distinct from 'awaiting_dispatch')
  execute function public.avisar_pedido_en_cola();

comment on function public.avisar_emergencia_asignada() is
  'Avisa a TODA la tripulación del móvil, no sólo al médico: el chofer es el que maneja. Dispara al asignar la ambulancia (migración 158), no al crear la emergencia.';
