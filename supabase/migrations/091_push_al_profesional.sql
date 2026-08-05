-- Push al profesional, disparadas desde la base (Mateo, 2026-08-05).
--
-- Hasta ahora TODAS las push salían del navegador del otro usuario con un
-- `functions.invoke` fire-and-forget: si esa pestaña se cerraba, el aviso se
-- perdía, y una reserva hecha desde la app mobile no avisaba a nadie porque
-- ese código sólo existe en el website. Tres eventos, tres triggers:
--
--   1. Consulta nueva asignada          → "Nueva consulta"
--   2. El paciente pagó                 → "Te pagaron la consulta"
--   3. El paciente está esperando       → "Entrá a la sala"
--
-- El envío es asíncrono (pg_net): un fallo de la Edge Function nunca puede
-- abortar la transacción que creó la consulta.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Helper de envío
-- ─────────────────────────────────────────────────────────────────────────────
-- La key va en Vault y no en el archivo: una migración se commitea. El secreto
-- `push_service_key` se carga una sola vez por fuera del repo (ver
-- docs/estados-consulta.md). Si no está, la función no rompe nada: no manda.
create or replace function public.enviar_push(
  p_user_id uuid,
  p_titulo  text,
  p_cuerpo  text,
  p_url     text
)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions', 'vault'
as $$
declare
  v_key text;
begin
  if p_user_id is null then return; end if;

  select decrypted_secret into v_key
    from vault.decrypted_secrets
   where name = 'push_service_key'
   limit 1;

  if v_key is null then
    raise warning 'push: falta el secreto push_service_key en Vault — no se envió a %', p_user_id;
    return;
  end if;

  perform net.http_post(
    url     := 'https://aixjejdoofervrkggbkd.supabase.co/functions/v1/send-push-notification',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body    := jsonb_build_object(
      'userId', p_user_id,
      'title',  p_titulo,
      'body',   p_cuerpo,
      'url',    p_url
    )
  );
end;
$$;

revoke all on function public.enviar_push(uuid, text, text, text) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Marcas de "ya avisado"
-- ─────────────────────────────────────────────────────────────────────────────
-- Mismo patrón que `reminder_sent` en 040/041: la marca vive en la fila, así
-- que dos writers (mp-payment y el webhook de MP, por ejemplo) no mandan dos
-- veces el mismo aviso.
alter table public.consultations
  add column if not exists pro_avisado_nueva_at timestamptz,
  add column if not exists pro_avisado_pago_at  timestamptz;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Evento 1 — consulta nueva para el profesional
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.avisar_consulta_nueva()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.professional_id is null then return new; end if;

  -- Si la creó el propio profesional (agenda un turno para su paciente), el
  -- aviso no le sirve: el website ya le avisa al paciente en ese caso.
  if auth.uid() = new.professional_id then return new; end if;

  perform public.enviar_push(
    new.professional_id,
    case when new.is_on_demand then 'Consulta inmediata disponible' else 'Nueva consulta reservada' end,
    case when new.is_on_demand
      then 'Un paciente está buscando atención ahora.'
      else 'Un paciente reservó un turno con vos.'
    end,
    '/profesional/dashboard'
  );

  update public.consultations set pro_avisado_nueva_at = now() where id = new.id;
  return new;
end;
$$;

drop trigger if exists consultations_avisar_nueva on public.consultations;
create trigger consultations_avisar_nueva
  after insert on public.consultations
  for each row execute function public.avisar_consulta_nueva();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Evento 2 — el paciente pagó
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.avisar_pago_recibido()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.professional_id is null or new.pro_avisado_pago_at is not null then
    return new;
  end if;

  -- `mp-capture` también deja `paid`, pero al CERRAR una consulta on-demand:
  -- ahí "te pagaron" llega tarde y confunde. Sólo avisamos cuando la consulta
  -- todavía está por delante.
  if new.status not in ('pending', 'confirmed') then return new; end if;

  perform public.enviar_push(
    new.professional_id,
    'Te pagaron la consulta',
    'El paciente ya abonó. El turno queda confirmado.',
    '/profesional/dashboard'
  );

  update public.consultations set pro_avisado_pago_at = now() where id = new.id;
  return new;
end;
$$;

drop trigger if exists consultations_avisar_pago on public.consultations;
create trigger consultations_avisar_pago
  after update of payment_status on public.consultations
  for each row
  when (new.payment_status = 'paid' and old.payment_status is distinct from 'paid')
  execute function public.avisar_pago_recibido();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Evento 3 — el paciente está esperando en la sala
-- ─────────────────────────────────────────────────────────────────────────────
-- La marca es la propia transición NULL → no NULL de `patient_waiting_since`,
-- que ya es una vez por estadía (ver 064). `clearPatientWaiting` la vuelve a
-- NULL al salir, así que si el paciente entra de nuevo se avisa de nuevo — que
-- es lo correcto.
create or replace function public.avisar_paciente_esperando()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.professional_id is null then return new; end if;

  perform public.enviar_push(
    new.professional_id,
    case when new.is_on_demand then 'Consulta inmediata — paciente listo' else 'Tenés un paciente esperando' end,
    'Entrá a la sala para atenderlo.',
    '/profesional/videollamada/' || new.id::text
  );

  return new;
end;
$$;

drop trigger if exists consultations_avisar_esperando on public.consultations;
create trigger consultations_avisar_esperando
  after update of patient_waiting_since on public.consultations
  for each row
  when (new.patient_waiting_since is not null and old.patient_waiting_since is null)
  execute function public.avisar_paciente_esperando();
