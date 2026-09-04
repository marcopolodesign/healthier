-- El mail de reserva se dispara desde la base, no desde el browser.
--
-- Hasta acá el único que pedía el mail de confirmación era
-- `consultationsService.createConsultation` con un `functions.invoke`
-- fire-and-forget. Eso tiene los dos problemas que la migración 091 ya había
-- resuelto para las push:
--
--   1. Si el paciente cierra la pestaña antes de que salga el invoke, el mail
--      se pierde y nadie se entera.
--   2. **Ese código sólo existe en el website.** Una reserva hecha desde la app
--      mobile nunca generó un mail de confirmación, ni al paciente ni al
--      profesional.
--
-- Mismo patrón que 091: pg_net (asíncrono, así un fallo de la Edge Function no
-- puede abortar la transacción que crea la consulta) + una marca en la fila
-- para que dos writers no manden el mismo mail dos veces.
--
-- El invoke del website se saca en el mismo cambio: con el trigger puesto,
-- dejarlo mandaría dos mails por cada reserva hecha desde la web.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. La marca de "ya se mandó"
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.consultations
  add column if not exists mail_reserva_enviado_at timestamptz;

comment on column public.consultations.mail_reserva_enviado_at is
  'Cuándo salió el mail de confirmación de la reserva (trigger consultations_mail_reserva). NULL = todavía no salió.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. El helper de envío
-- ─────────────────────────────────────────────────────────────────────────────
-- Dos secretos del Vault, los dos obligatorios:
--
--   · `push_service_key` — la service key con la que la base llama a CUALQUIER
--     Edge Function. El nombre quedó de cuando la única que llamaba era
--     `send-push-notification` (migración 091); un segundo secreto con el mismo
--     valor sería una cosa más que mantener sincronizada.
--   · `functions_base_url` — a qué proyecto se le pega. La 091 hardcodeó la URL
--     de producción dentro de la función, así que en staging esas push salen
--     contra las funciones de PRODUCCIÓN. Acá no se repite: la base dice a
--     dónde llama, y staging llama a staging.
--
-- Si falta cualquiera de los dos, no rompe nada: avisa y no manda.
create or replace function public.enviar_mail_reserva(p_consultation_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions', 'vault'
as $$
declare
  v_key  text;
  v_base text;
begin
  if p_consultation_id is null then return; end if;

  select decrypted_secret into v_key
    from vault.decrypted_secrets where name = 'push_service_key' limit 1;

  select decrypted_secret into v_base
    from vault.decrypted_secrets where name = 'functions_base_url' limit 1;

  if v_key is null or v_base is null then
    raise warning 'mail: faltan secretos en Vault (push_service_key / functions_base_url) — no se envió el de la consulta %', p_consultation_id;
    return;
  end if;

  perform net.http_post(
    url     := rtrim(v_base, '/') || '/send-booking-email',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body    := jsonb_build_object('consultationId', p_consultation_id)
  );
end;
$$;

revoke all on function public.enviar_mail_reserva(uuid) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. El trigger
-- ─────────────────────────────────────────────────────────────────────────────
-- On-demand se calla, con el mismo criterio que ya usaba el website: la fila se
-- crea cuando el paciente se compromete a pagar, y el copy del mail es de turno
-- agendado ("Ingresá 5 minutos antes"), que no es lo que está pasando.
create or replace function public.avisar_reserva_por_mail()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if coalesce(new.is_on_demand, false) then return new; end if;
  if new.mail_reserva_enviado_at is not null then return new; end if;

  perform public.enviar_mail_reserva(new.id);

  update public.consultations
     set mail_reserva_enviado_at = now()
   where id = new.id;

  return new;
end;
$$;

drop trigger if exists consultations_mail_reserva on public.consultations;
create trigger consultations_mail_reserva
  after insert on public.consultations
  for each row execute function public.avisar_reserva_por_mail();
