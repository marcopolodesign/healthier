-- Verificación de la migración 190 — prender la consulta inmediata es latir.
--
--   bash scripts/correr-test.sh ondemand_190 staging
--   bash scripts/correr-test.sh ondemand_190 prod
--
-- Usa SÓLO `profesional@healthier.app` (regla de Mateo para las pruebas de
-- consulta inmediata). Todo corre dentro de un bloque que termina SIEMPRE con
-- un error a propósito, así que no queda nada cambiado: ni su switch, ni su
-- vigencia, ni avisos. El resultado viaja en el texto de ese error:
-- `RESULTADO_190 ok` o `RESULTADO_190 FALLA: …`.
do $$
declare
  v_pro   uuid;
  v_fila  record;
  v_falla text := '';
begin
  select id into v_pro from public.profiles where email = 'profesional@healthier.app' and titular_id is null limit 1;
  if v_pro is null then raise exception 'RESULTADO_190 FALLA: no existe profesional@healthier.app'; end if;

  -- Punto de partida: apagado.
  update public.professional_profiles set is_on_demand = false where user_id = v_pro;

  -- 1 · El propio profesional lo prende por un UPDATE pelado (sin llamar al
  --     ping): tiene que quedar con vigencia.
  perform set_config('request.jwt.claims', json_build_object('sub', v_pro, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.professional_profiles set is_on_demand = true where user_id = v_pro;
  reset role;
  select is_on_demand, on_demand_last_seen_at, on_demand_since into v_fila
    from public.professional_profiles where user_id = v_pro;
  if v_fila.on_demand_last_seen_at is null or v_fila.on_demand_last_seen_at < now() - interval '1 minute' then
    v_falla := v_falla || ' prender sin ping dejó la vigencia vacía;';
  end if;
  if v_fila.on_demand_since is null then v_falla := v_falla || ' sin on_demand_since;'; end if;

  -- 2 · Lo apaga: la vigencia se borra.
  set local role authenticated;
  update public.professional_profiles set is_on_demand = false where user_id = v_pro;
  reset role;
  select on_demand_last_seen_at into v_fila from public.professional_profiles where user_id = v_pro;
  if v_fila.on_demand_last_seen_at is not null then v_falla := v_falla || ' apagar no borró la vigencia;'; end if;

  -- 3 · Lo prende otro (sin sesión del profesional): no se inventa presencia.
  perform set_config('request.jwt.claims', '', true);
  update public.professional_profiles set is_on_demand = true where user_id = v_pro;
  select on_demand_last_seen_at into v_fila from public.professional_profiles where user_id = v_pro;
  if v_fila.on_demand_last_seen_at is not null then v_falla := v_falla || ' otro lo prendió y se inventó un latido;'; end if;

  -- 4 · En la base no queda nadie con el switch prendido y sin vigencia
  --     (fuera de la fila que este mismo test acaba de tocar).
  if exists (select 1 from public.professional_profiles
              where is_on_demand and on_demand_last_seen_at is null and user_id <> v_pro) then
    v_falla := v_falla || ' hay profesionales con el switch prendido y sin vigencia;';
  end if;

  if v_falla = '' then
    raise exception 'RESULTADO_190 ok';
  else
    raise exception 'RESULTADO_190 FALLA:%', v_falla;
  end if;
end $$;
