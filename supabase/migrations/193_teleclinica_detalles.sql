-- 193 · Teleclínica: dos detalles que aparecieron al documentar el flujo (2026-10-08)
--
-- 1. Elegible = cuenta de Mercado Pago de verdad, no sólo el flag.
--    `puede_tomar_ondemand()` miraba `professional_profiles.mp_connected`, y en
--    staging había una profesional con el flag en true y ninguna fila en
--    `mp_accounts`: le sonaba el pedido, lo aceptaba y el cobro fallaba con
--    "Professional does not have a linked MercadoPago account". Ahora además
--    tiene que existir su cuenta activa, que es lo que usa `mp-payment`.
--
-- 2. "Seguir buscando" no pierde la tarjeta.
--    El cron de cada minuto borraba el token apenas el pedido vencía (4 min),
--    pero "Seguir buscando" puede revivirlo hasta 20 minutos desde que se pidió
--    (`BUSQUEDA_MAX_MS` en `ondemand-despacho`). Resultado: al seguir buscando,
--    al paciente se le volvía a pedir el código de seguridad. El token de un
--    vencido se guarda hasta ese techo; uno cancelado se borra enseguida, igual
--    que antes. Sigue cifrado y sólo lo lee el service role.

create or replace function public.puede_tomar_ondemand(p_user uuid, p_especialidades text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from professional_profiles pp
     where pp.user_id = p_user
       and pp.specialty = any (p_especialidades)
       and pp.is_on_demand = true
       and pp.is_verified = true
       and pp.is_active = true
       and pp.mp_connected = true
       and pp.on_demand_last_seen_at >= now() - interval '1 hour'
       and exists (select 1 from mp_accounts ma where ma.professional_id = p_user and ma.active)
  );
$$;

comment on function public.puede_tomar_ondemand(uuid, text[]) is
  'Elegible para un pedido on-demand: verificado, activo, on-demand prendido, cuenta de MP activa en mp_accounts y latido de la última hora (ON_DEMAND_PRESENCE_TTL_MS).';

create or replace function public.expire_ondemand_requests()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  with done as (
    update ondemand_requests set status = 'expired'
     where status = 'pending' and expires_at <= now()
    returning id
  )
  select count(*)::integer into v_n from done;

  -- Cancelado: el token ya no sirve. Vencido: se guarda mientras se pueda
  -- "Seguir buscando" (20 min desde que se pidió, el mismo techo que la
  -- Edge Function).
  delete from ondemand_request_cobros c
   using ondemand_requests r
   where r.id = c.request_id
     and (r.status = 'cancelled'
          or (r.status = 'expired' and r.created_at <= now() - interval '20 minutes'));

  return v_n;
end;
$$;

revoke all on function public.expire_ondemand_requests() from public, anon, authenticated;
