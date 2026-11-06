-- Verificación de la migración 233 — el latido sólo se escribe con el switch prendido.
--
--   bash scripts/correr-test.sh ondemand_233 staging
--
-- Usa SÓLO `profesional@healthier.app`. Termina SIEMPRE con un error a propósito
-- (no deja nada cambiado); el resultado viaja en el texto: `RESULTADO_233 ok` o
-- `RESULTADO_233 FALLA: …`.
do $$
declare
  v_pro   uuid;
  v_fila  record;
  v_falla text := '';
begin
  select id into v_pro from public.profiles where email = 'profesional@healthier.app' and titular_id is null limit 1;
  if v_pro is null then raise exception 'RESULTADO_233 FALLA: no existe profesional@healthier.app'; end if;

  update public.professional_profiles
     set is_on_demand = false, on_demand_since = null, on_demand_last_seen_at = null
   where user_id = v_pro;

  perform set_config('request.jwt.claims', json_build_object('sub', v_pro, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 1 · Apagado: el ping no escribe nada.
  perform public.professional_online_ping();
  reset role;
  select on_demand_since, on_demand_last_seen_at into v_fila from public.professional_profiles where user_id = v_pro;
  if v_fila.on_demand_last_seen_at is not null or v_fila.on_demand_since is not null then
    v_falla := v_falla || ' el ping escribió vigencia con el switch apagado;';
  end if;

  -- 2 · Prendido SIN vigencia (el estado roto de prod): el ping lo cura.
  update public.professional_profiles set is_on_demand = true, on_demand_since = null, on_demand_last_seen_at = null where user_id = v_pro;
  set local role authenticated;
  perform public.professional_online_ping();
  reset role;
  select on_demand_since, on_demand_last_seen_at into v_fila from public.professional_profiles where user_id = v_pro;
  if v_fila.on_demand_last_seen_at is null or v_fila.on_demand_since is null then
    v_falla := v_falla || ' el ping no curó un switch prendido sin vigencia;';
  end if;

  if v_falla = '' then raise exception 'RESULTADO_233 ok'; else raise exception 'RESULTADO_233 FALLA:%', v_falla; end if;
end $$;
