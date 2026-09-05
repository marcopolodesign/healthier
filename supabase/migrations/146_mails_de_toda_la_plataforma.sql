-- Los mails de Healthier salen de la base, no del browser.
--
-- La migración 143 hizo esto para UN mail (la reserva de un turno) y el patrón
-- funcionó: pg_net asíncrono para que un fallo del mail no aborte la
-- transacción, y una marca en la fila para que dos writers no manden el mismo
-- mail dos veces. Acá se generaliza a todos los demás.
--
-- Por qué desde la base y no desde el front: el website y la app mobile son dos
-- clientes distintos del mismo backend. Cada mail que se dispara con un
-- `functions.invoke` del front hay que escribirlo dos veces, y el día que se
-- olvida uno, media plataforma deja de avisar sin que nada falle. Ya pasó: la
-- reserva hecha desde la app nunca mandó mail hasta la 143.
--
-- Todo va a la Edge Function `send-email`, que reemplaza a `send-booking-email`
-- (una sola función: un solo remitente, un solo armazón HTML, un solo lugar
-- donde se loguea el error de Resend).

-- ═══════════════════════════════════════════════════════════════════════════
-- 1 · El helper genérico
-- ═══════════════════════════════════════════════════════════════════════════
-- Reemplaza a `enviar_mail_reserva(uuid)`. Mismos dos secretos del Vault:
--   · `push_service_key`    — la service key con la que la base llama a
--     cualquier Edge Function. El nombre quedó de la 091, cuando la única era
--     `send-push-notification`; un segundo secreto con el mismo valor sería una
--     cosa más para mantener sincronizada.
--   · `functions_base_url`  — a qué proyecto se le pega, para que staging llame
--     a staging y no a producción.
--
-- Si falta cualquiera de los dos, avisa y no manda. Nunca tira: un mail que no
-- sale no puede voltear la transacción que lo originó.
create or replace function public.enviar_mail(p_payload jsonb)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions', 'vault'
as $$
declare
  v_key  text;
  v_base text;
begin
  if p_payload is null then return; end if;

  select decrypted_secret into v_key
    from vault.decrypted_secrets where name = 'push_service_key' limit 1;
  select decrypted_secret into v_base
    from vault.decrypted_secrets where name = 'functions_base_url' limit 1;

  if v_key is null or v_base is null then
    raise warning 'mail: faltan secretos en Vault (push_service_key / functions_base_url) — no se envió %', p_payload->>'tipo';
    return;
  end if;

  perform net.http_post(
    url     := rtrim(v_base, '/') || '/send-email',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body    := p_payload
  );
end;
$$;

revoke all on function public.enviar_mail(jsonb) from public, anon, authenticated;

-- `enviar_mail_reserva` se deja como envoltorio de compatibilidad: si quedó
-- alguna referencia suelta, sigue funcionando y apunta a la función nueva.
create or replace function public.enviar_mail_reserva(p_consultation_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_consultation_id is null then return; end if;
  perform public.enviar_mail(jsonb_build_object('tipo', 'reserva', 'consultationId', p_consultation_id));
end;
$$;

revoke all on function public.enviar_mail_reserva(uuid) from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2 · Las marcas de "ya se mandó"
-- ═══════════════════════════════════════════════════════════════════════════
-- Una columna por mail, y no un booleano: saber CUÁNDO salió es lo que después
-- permite responder "¿le llegó el aviso o no?" sin adivinar.
alter table public.consultations
  add column if not exists mail_ondemand_enviado_at    timestamptz,
  add column if not exists mail_post_enviado_at        timestamptz,
  add column if not exists mail_cancelacion_enviado_at timestamptz;

comment on column public.consultations.mail_ondemand_enviado_at is
  'Cuándo salió el mail de consulta inmediata asignada. NULL = todavía no salió.';
comment on column public.consultations.mail_post_enviado_at is
  'Cuándo salió el mail de resumen post-consulta. NULL = todavía no salió.';
comment on column public.consultations.mail_cancelacion_enviado_at is
  'Cuándo salió el mail de turno cancelado. NULL = todavía no salió.';

alter table public.medication_orders
  add column if not exists mail_confirmado_enviado_at timestamptz,
  add column if not exists mail_estado_enviado        text;

comment on column public.medication_orders.mail_confirmado_enviado_at is
  'Cuándo salió el mail de pedido confirmado (al acreditarse el pago).';
comment on column public.medication_orders.mail_estado_enviado is
  'Último estado del pedido por el que YA se avisó por mail. Evita repetir el aviso si el estado se re-escribe.';

alter table public.clinical_medications
  add column if not exists mail_receta_enviado_at timestamptz;

comment on column public.clinical_medications.mail_receta_enviado_at is
  'Cuándo salió el mail de receta emitida. Se marca en TODAS las filas de la misma receta: el mail es uno solo por receta, no uno por medicamento.';

alter table public.professional_profiles
  add column if not exists mail_verificacion_enviado_at timestamptz;

comment on column public.professional_profiles.mail_verificacion_enviado_at is
  'Cuándo salió el último mail de resultado de la verificación (aprobado u observado).';

alter table public.profiles
  add column if not exists mail_bienvenida_enviado_at timestamptz;

comment on column public.profiles.mail_bienvenida_enviado_at is
  'Cuándo salió el mail de bienvenida. NULL = todavía no salió.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 3 · Consultas — alta
-- ═══════════════════════════════════════════════════════════════════════════
-- Reemplaza a `avisar_reserva_por_mail`, que se callaba en on-demand porque no
-- existía un copy para ese caso. Ahora existe: la consulta inmediata ya nace
-- asignada a un profesional (ver la regla del pool en CLAUDE.md), así que el
-- mail que corresponde es "te está esperando en la sala", no "llegá 5 minutos
-- antes".
create or replace function public.avisar_reserva_por_mail()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if coalesce(new.is_on_demand, false) then
    if new.mail_ondemand_enviado_at is null then
      perform public.enviar_mail(jsonb_build_object('tipo', 'ondemand', 'consultationId', new.id));
      update public.consultations set mail_ondemand_enviado_at = now() where id = new.id;
    end if;
    return new;
  end if;

  if new.mail_reserva_enviado_at is null then
    perform public.enviar_mail(jsonb_build_object('tipo', 'reserva', 'consultationId', new.id));
    update public.consultations set mail_reserva_enviado_at = now() where id = new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists consultations_mail_reserva on public.consultations;
create trigger consultations_mail_reserva
  after insert on public.consultations
  for each row execute function public.avisar_reserva_por_mail();

-- ═══════════════════════════════════════════════════════════════════════════
-- 4 · Consultas — cierre y cancelación
-- ═══════════════════════════════════════════════════════════════════════════
-- El mail de post-consulta se dispara al pasar a `completed`, que es cuando el
-- profesional cerró la historia clínica: recién ahí existen el resumen, el
-- diagnóstico, las indicaciones y las recetas que el mail va a listar. Mandarlo
-- antes daría un mail vacío.
create or replace function public.avisar_cierre_de_consulta_por_mail()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'completed' and new.mail_post_enviado_at is null then
      perform public.enviar_mail(jsonb_build_object('tipo', 'post-consulta', 'consultationId', new.id));
      update public.consultations set mail_post_enviado_at = now() where id = new.id;

    elsif new.status = 'cancelled' and new.mail_cancelacion_enviado_at is null then
      perform public.enviar_mail(jsonb_build_object('tipo', 'cancelada', 'consultationId', new.id));
      update public.consultations set mail_cancelacion_enviado_at = now() where id = new.id;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists consultations_mail_cierre on public.consultations;
create trigger consultations_mail_cierre
  after update of status on public.consultations
  for each row execute function public.avisar_cierre_de_consulta_por_mail();

-- ═══════════════════════════════════════════════════════════════════════════
-- 5 · Farmacia
-- ═══════════════════════════════════════════════════════════════════════════
-- Dos avisos distintos y a propósito:
--   · Al acreditarse el pago → "pedido confirmado", con el detalle y el total.
--   · Al salir o entregarse  → el cambio de estado.
--
-- `en_preparacion` NO manda mail: el de confirmación ya dice que la farmacia lo
-- está preparando, y los dos llegan con minutos de diferencia. Dos mails que
-- dicen lo mismo enseñan a ignorar los mails de Healthier.
create or replace function public.avisar_pedido_de_farmacia_por_mail()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.payment_status = 'pagado'
     and old.payment_status is distinct from 'pagado'
     and new.mail_confirmado_enviado_at is null then
    perform public.enviar_mail(jsonb_build_object('tipo', 'pedido-confirmado', 'orderId', new.id));
    update public.medication_orders
       set mail_confirmado_enviado_at = now(), mail_estado_enviado = new.status
     where id = new.id;
    return new;
  end if;

  if new.status is distinct from old.status
     and new.status in ('enviado', 'entregado', 'cancelado')
     and new.mail_estado_enviado is distinct from new.status then
    perform public.enviar_mail(jsonb_build_object(
      'tipo',   'pedido-estado',
      'orderId', new.id,
      'estado',  new.status,
      'motivo',  new.cancellation_reason
    ));
    update public.medication_orders set mail_estado_enviado = new.status where id = new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists medication_orders_mail on public.medication_orders;
create trigger medication_orders_mail
  after update on public.medication_orders
  for each row execute function public.avisar_pedido_de_farmacia_por_mail();

-- ═══════════════════════════════════════════════════════════════════════════
-- 6 · Receta electrónica emitida
-- ═══════════════════════════════════════════════════════════════════════════
-- Una receta agrupa varios medicamentos (mismo `rcta_prescription_id`) y cada
-- uno es una fila. El mail es UNO por receta: se marcan todas las filas del
-- grupo de una, así la segunda fila que pase a `issued` ya no dispara nada.
create or replace function public.avisar_receta_emitida_por_mail()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_ya timestamptz;
begin
  if new.rcta_status is not distinct from 'issued'
     or old.rcta_status is not distinct from new.rcta_status
     or new.rcta_prescription_id is null then
    return new;
  end if;

  select max(mail_receta_enviado_at) into v_ya
    from public.clinical_medications
   where rcta_prescription_id = new.rcta_prescription_id;

  if v_ya is not null then return new; end if;

  perform public.enviar_mail(jsonb_build_object(
    'tipo', 'receta', 'prescriptionId', new.rcta_prescription_id
  ));

  update public.clinical_medications
     set mail_receta_enviado_at = now()
   where rcta_prescription_id = new.rcta_prescription_id;

  return new;
end;
$$;

drop trigger if exists clinical_medications_mail_receta on public.clinical_medications;
create trigger clinical_medications_mail_receta
  after update of rcta_status on public.clinical_medications
  for each row execute function public.avisar_receta_emitida_por_mail();

-- ═══════════════════════════════════════════════════════════════════════════
-- 7 · Resultado de la verificación del profesional
-- ═══════════════════════════════════════════════════════════════════════════
-- Hasta acá el profesional se enteraba de que lo habían verificado (o de que le
-- faltaba un papel) sólo si volvía a entrar a la app. El que quedó observado es
-- justamente el que menos vuelve.
create or replace function public.avisar_verificacion_por_mail()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.is_verified and not coalesce(old.is_verified, false) then
    perform public.enviar_mail(jsonb_build_object('tipo', 'pro-verificado', 'userId', new.user_id));
    update public.professional_profiles set mail_verificacion_enviado_at = now() where id = new.id;

  elsif new.rejected_at is not null and old.rejected_at is distinct from new.rejected_at then
    perform public.enviar_mail(jsonb_build_object(
      'tipo', 'pro-observado', 'userId', new.user_id, 'motivo', new.rejection_reason
    ));
    update public.professional_profiles set mail_verificacion_enviado_at = now() where id = new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists professional_profiles_mail_verificacion on public.professional_profiles;
create trigger professional_profiles_mail_verificacion
  after update on public.professional_profiles
  for each row execute function public.avisar_verificacion_por_mail();

-- ═══════════════════════════════════════════════════════════════════════════
-- 8 · Bienvenida
-- ═══════════════════════════════════════════════════════════════════════════
-- Sólo pacientes: el profesional tiene su propio recorrido (onboarding →
-- verificación → el mail del punto 7) y una bienvenida genérica en el medio no
-- le dice nada que no esté viendo en pantalla.
create or replace function public.avisar_bienvenida_por_mail()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.role is distinct from 'patient' then return new; end if;
  if new.email is null then return new; end if;
  if new.mail_bienvenida_enviado_at is not null then return new; end if;

  perform public.enviar_mail(jsonb_build_object('tipo', 'bienvenida', 'userId', new.id));
  update public.profiles set mail_bienvenida_enviado_at = now() where id = new.id;

  return new;
end;
$$;

drop trigger if exists profiles_mail_bienvenida on public.profiles;
create trigger profiles_mail_bienvenida
  after insert on public.profiles
  for each row execute function public.avisar_bienvenida_por_mail();
