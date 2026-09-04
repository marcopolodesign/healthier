-- `enviar_push` le pegaba SIEMPRE a las funciones de producción.
--
-- La 091 hardcodeó `https://aixjejdoofervrkggbkd.supabase.co/functions/v1` dentro
-- del cuerpo de la función. Mientras staging compartió la base con producción eso
-- daba lo mismo; desde que staging tiene base propia (2026-08-24) dejó de darlo:
-- un push disparado en staging sale contra el proyecto de PRODUCCIÓN, firmado con
-- la service key de staging.
--
-- No llegó a mandar nada — el gateway de producción rechaza esa key con
-- `UNAUTHORIZED_LEGACY_JWT` — así que el síntoma era simplemente que las push no
-- funcionaban en staging y nadie sabía por qué. Quedó a la vista al probar el mail
-- de reserva (143): las dos llamadas salen del mismo insert y una volvía 401.
--
-- Ahora la base dice a qué proyecto llama, con el mismo secreto de Vault que usa
-- `enviar_mail_reserva`: staging llama a staging, producción a producción.
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
  v_key  text;
  v_base text;
begin
  if p_user_id is null then return; end if;

  select decrypted_secret into v_key
    from vault.decrypted_secrets where name = 'push_service_key' limit 1;

  select decrypted_secret into v_base
    from vault.decrypted_secrets where name = 'functions_base_url' limit 1;

  if v_key is null or v_base is null then
    raise warning 'push: faltan secretos en Vault (push_service_key / functions_base_url) — no se envió a %', p_user_id;
    return;
  end if;

  perform net.http_post(
    url     := rtrim(v_base, '/') || '/send-push-notification',
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
