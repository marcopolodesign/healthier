-- 152 — El copy de los avisos sale de un catálogo, y se suman los que faltaban.
--
-- Dos cosas, y la segunda es la que hace falta para la primera.
--
-- ── Por qué ──────────────────────────────────────────────────────────────────
-- Mateo pidió mandarle a revisar al equipo el texto de las notificaciones, como
-- se hizo con los mails. Con el copy escrito a mano dentro de los triggers
-- —repartido en las migraciones 091, 097, 149 y 150— eso no se puede hacer de
-- verdad: nadie puede leerlo de corrido, y cambiar una palabra obliga a escribir
-- una migración.
--
-- Ahora el trigger dice **qué pasó** (`tipo` + los ids) y el texto se arma en
-- `_shared/push/textos.ts`, que es también el que genera la página de revisión.
-- Mismo patrón que los mails con la 146.
--
-- ── Y los que faltaban ───────────────────────────────────────────────────────
-- Comparado con los mails de la 146, al paciente no le llegaba push en tres
-- momentos en los que sí le llega mail: cuando el profesional cierra la consulta
-- (el resumen y la receta), cuando se le emite una receta, y en todo el
-- recorrido del pedido de farmacia. Se suman.
--
-- La consulta inmediata queda fuera a propósito: el paciente acaba de pedirla y
-- está mirando la pantalla; el aviso que importa ahí es "el profesional está
-- listo", que ya existe.

-- ═════════════════════════════════════════════════════════════════════════════
-- 1 · El helper, ahora con `tipo`
-- ═════════════════════════════════════════════════════════════════════════════
-- Se agrega una firma nueva en vez de cambiar la vieja: `enviar_push(uuid, text,
-- text, text)` sigue existiendo porque la usan triggers de otras migraciones y
-- código del front. Las dos pegan contra la misma Edge Function.
create or replace function public.enviar_push_tipo(
  p_user_id uuid,
  p_tipo    text,
  p_datos   jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions', 'vault'
as $$
declare
  v_key  text;
  v_base text;
begin
  if p_user_id is null or p_tipo is null then return; end if;

  select decrypted_secret into v_key
    from vault.decrypted_secrets where name = 'push_service_key' limit 1;
  select decrypted_secret into v_base
    from vault.decrypted_secrets where name = 'functions_base_url' limit 1;

  if v_key is null or v_base is null then
    raise warning 'push: faltan secretos en Vault — no se envió %', p_tipo;
    return;
  end if;

  perform net.http_post(
    url     := rtrim(v_base, '/') || '/send-push-notification',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body    := p_datos || jsonb_build_object('userId', p_user_id, 'tipo', p_tipo)
  );
end;
$$;

revoke all on function public.enviar_push_tipo(uuid, text, jsonb) from public, anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- 2 · Los avisos que faltaban
-- ═════════════════════════════════════════════════════════════════════════════

-- 2a · Post-consulta. Se cuelga del mismo momento que el mail (la 146): cuando
-- el profesional pasa la consulta a `completed`, que es cuando recién existen
-- el resumen, el diagnóstico y las recetas que el aviso promete.
create or replace function public.avisar_cierre_al_paciente()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.patient_id is null then return new; end if;
  perform public.enviar_push_tipo(
    new.patient_id, 'post-consulta',
    jsonb_build_object('consultationId', new.id)
  );
  return new;
end;
$$;

drop trigger if exists consultations_avisar_cierre on public.consultations;
create trigger consultations_avisar_cierre
  after update of status on public.consultations
  for each row
  when (new.status = 'completed' and old.status is distinct from 'completed')
  execute function public.avisar_cierre_al_paciente();

-- 2b · Receta emitida. Una receta agrupa varios medicamentos y cada uno es una
-- fila: el aviso es UNO por receta. Se apoya en la misma marca que usa el mail
-- (`mail_receta_enviado_at`, migración 146) para no mandar uno por fila — si el
-- mail ya salió por esta receta, el push ya salió con él.
create or replace function public.avisar_receta_al_paciente()
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

  perform public.enviar_push_tipo(
    new.patient_id, 'receta-emitida',
    jsonb_build_object('prescriptionId', new.rcta_prescription_id)
  );
  return new;
end;
$$;

drop trigger if exists clinical_medications_avisar_receta on public.clinical_medications;
create trigger clinical_medications_avisar_receta
  after update of rcta_status on public.clinical_medications
  for each row execute function public.avisar_receta_al_paciente();

-- 2c · Farmacia. Mismo criterio que el mail: `en_preparacion` no avisa, porque
-- el de confirmado ya dice que la farmacia lo está preparando y los dos llegan
-- con minutos de diferencia. Dos avisos que dicen lo mismo enseñan a ignorarlos.
create or replace function public.avisar_pedido_al_paciente()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.payment_status = 'pagado'
     and old.payment_status is distinct from 'pagado' then
    perform public.enviar_push_tipo(
      new.patient_id, 'pedido-confirmado',
      jsonb_build_object('orderId', new.id)
    );
    return new;
  end if;

  if new.status is distinct from old.status
     and new.status in ('enviado', 'entregado', 'cancelado') then
    perform public.enviar_push_tipo(
      new.patient_id, 'pedido-' || new.status,
      jsonb_build_object('orderId', new.id)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists medication_orders_avisar_paciente on public.medication_orders;
create trigger medication_orders_avisar_paciente
  after update of payment_status, status on public.medication_orders
  for each row execute function public.avisar_pedido_al_paciente();

-- ═════════════════════════════════════════════════════════════════════════════
-- 3 · Los que ya existían pasan al catálogo
-- ═════════════════════════════════════════════════════════════════════════════
-- Mismo comportamiento, mismo texto: lo único que cambia es de dónde sale. Sin
-- esto, la página de revisión mostraría el copy de unos avisos y no el de otros,
-- que es peor que no tenerla.

create or replace function public.avisar_turno_agendado()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.patient_id is null or new.professional_id is null then return new; end if;
  -- Sólo si lo agendó el profesional; si reservó el paciente, ya lo sabe.
  if auth.uid() is distinct from new.professional_id then return new; end if;
  perform public.enviar_push_tipo(
    new.patient_id, 'turno-agendado', jsonb_build_object('consultationId', new.id));
  return new;
end; $$;

create or replace function public.avisar_estado_al_paciente()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.patient_id is null then return new; end if;
  if new.status = 'confirmed' then
    perform public.enviar_push_tipo(
      new.patient_id, 'turno-confirmado', jsonb_build_object('consultationId', new.id));
  elsif new.status = 'in_progress' then
    perform public.enviar_push_tipo(
      new.patient_id, 'profesional-listo', jsonb_build_object('consultationId', new.id));
  end if;
  return new;
end; $$;

create or replace function public.avisar_consulta_cancelada()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_quien uuid := coalesce(new.cancelled_by, auth.uid());
begin
  if new.patient_id is not null and v_quien is distinct from new.patient_id then
    perform public.enviar_push_tipo(
      new.patient_id, 'consulta-cancelada', jsonb_build_object('consultationId', new.id));
  end if;
  if new.professional_id is not null and v_quien is distinct from new.professional_id then
    perform public.enviar_push_tipo(
      new.professional_id, 'pro-consulta-cancelada', jsonb_build_object('consultationId', new.id));
  end if;
  return new;
end; $$;

-- 🔴 Las guardas de estas tres se copian TAL CUAL de la definición viva: no son
-- decoración, y perder una manda avisos de más a un usuario real. Lo único que
-- cambia acá es de dónde sale el texto.
create or replace function public.avisar_consulta_nueva()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.professional_id is null then return new; end if;

  -- Si la creó el propio profesional (agenda un turno para su paciente), el
  -- aviso no le sirve: al paciente ya se le avisa por otro lado.
  if auth.uid() = new.professional_id then return new; end if;

  perform public.enviar_push_tipo(
    new.professional_id, 'pro-consulta-nueva', jsonb_build_object('consultationId', new.id));

  update public.consultations set pro_avisado_nueva_at = now() where id = new.id;
  return new;
end; $$;

create or replace function public.avisar_pago_recibido()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.professional_id is null or new.pro_avisado_pago_at is not null then
    return new;
  end if;

  -- `mp-capture` también deja `paid`, pero al CERRAR una consulta on-demand:
  -- ahí "te pagaron" llega tarde y confunde. Sólo se avisa cuando la consulta
  -- todavía está por delante.
  if new.status not in ('pending', 'confirmed') then return new; end if;

  perform public.enviar_push_tipo(
    new.professional_id, 'pro-pago-recibido', jsonb_build_object('consultationId', new.id));

  update public.consultations set pro_avisado_pago_at = now() where id = new.id;
  return new;
end; $$;

create or replace function public.avisar_paciente_esperando()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.professional_id is null then return new; end if;
  perform public.enviar_push_tipo(
    new.professional_id, 'pro-paciente-esperando', jsonb_build_object('consultationId', new.id));
  return new;
end; $$;
