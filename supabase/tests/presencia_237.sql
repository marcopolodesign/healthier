-- Verificación de la migración 237 — presencia de profesionales para analítica.
--
--   bash scripts/correr-test.sh presencia_237 staging
--
-- Usa SÓLO `profesional@healthier.app`. Termina SIEMPRE con un error a propósito
-- (rollback: no deja nada cambiado); el resultado viaja en el texto:
-- `RESULTADO_237 ok` o `RESULTADO_237 FALLA: …`.
do $$
declare
  v_pro    uuid;
  v_n      integer;
  v_m      timestamptz;
  v_falla  text := '';
  v_ultimo bigint;
begin
  select id into v_pro from public.profiles where email = 'profesional@healthier.app' and titular_id is null limit 1;
  if v_pro is null then raise exception 'RESULTADO_237 FALLA: no existe profesional@healthier.app'; end if;

  -- Partir de apagado.
  update public.professional_profiles
     set is_on_demand = false, on_demand_since = null, on_demand_last_seen_at = null
   where user_id = v_pro;
  select coalesce(max(id), 0) into v_ultimo from public.presencia_profesional_eventos;

  -- 1 · Prender (como el propio profesional): un "conecto".
  perform set_config('request.jwt.claims', json_build_object('sub', v_pro, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.professional_profiles set is_on_demand = true where user_id = v_pro;
  reset role;
  select count(*) into v_n from public.presencia_profesional_eventos where id > v_ultimo and professional_id = v_pro and evento = 'conecto';
  if v_n <> 1 then v_falla := v_falla || format(' prender anotó %s conecto (esperaba 1);', v_n); end if;

  -- 2 · Latidos dentro de la hora: no anotan nada.
  set local role authenticated;
  perform public.professional_online_ping();
  perform public.professional_online_ping();
  reset role;
  select count(*) into v_n from public.presencia_profesional_eventos where id > v_ultimo and professional_id = v_pro;
  if v_n <> 1 then v_falla := v_falla || format(' los latidos anotaron eventos (%s en total, esperaba 1);', v_n); end if;

  -- 3 · Vigencia vencida: el barrido anota UN "vencio" con último latido + 1 h,
  --     y no toca la fila del perfil. Repetirlo no duplica.
  update public.professional_profiles set on_demand_last_seen_at = now() - interval '2 hours' where user_id = v_pro;
  select count(*) into v_n from public.presencia_profesional_eventos where id > v_ultimo and professional_id = v_pro;
  if v_n <> 1 then v_falla := v_falla || ' mover el latido hacia atrás anotó un evento;'; end if;
  perform public.presencia_barrido();
  perform public.presencia_barrido();
  select count(*), max(momento) into v_n, v_m from public.presencia_profesional_eventos where id > v_ultimo and professional_id = v_pro and evento = 'vencio';
  if v_n <> 1 then v_falla := v_falla || format(' el barrido anotó %s vencio (esperaba 1);', v_n); end if;
  if v_m is distinct from (select on_demand_last_seen_at + interval '1 hour' from public.professional_profiles where user_id = v_pro) then
    v_falla := v_falla || ' el momento del vencio no es último latido + 1 h;';
  end if;
  if (select on_demand_since from public.professional_profiles where user_id = v_pro) is null then
    v_falla := v_falla || ' el barrido tocó la fila del perfil;';
  end if;

  -- 4 · Latir de nuevo con la vigencia vencida: "conecto" (revive).
  set local role authenticated;
  perform public.professional_online_ping();
  reset role;
  select count(*) into v_n from public.presencia_profesional_eventos where id > v_ultimo and professional_id = v_pro and evento = 'conecto';
  if v_n <> 2 then v_falla := v_falla || format(' revivir no anotó conecto (%s conecto, esperaba 2);', v_n); end if;

  -- 5 · Apagar: "desconecto".
  set local role authenticated;
  update public.professional_profiles set is_on_demand = false where user_id = v_pro;
  reset role;
  select count(*) into v_n from public.presencia_profesional_eventos where id > v_ultimo and professional_id = v_pro and evento = 'desconecto';
  if v_n <> 1 then v_falla := v_falla || format(' apagar anotó %s desconecto (esperaba 1);', v_n); end if;

  -- 6 · Foto de elegibles: hay filas del barrido y respetan elegibles <= con_switch.
  if not exists (select 1 from public.presencia_elegibles_foto where tomada_en = date_trunc('minute', now())) then
    v_falla := v_falla || ' el barrido no sacó la foto de elegibles;';
  end if;
  if exists (select 1 from public.presencia_elegibles_foto where elegibles > con_switch or elegibles_sin_prueba > elegibles) then
    v_falla := v_falla || ' foto inconsistente (elegibles > con_switch);';
  end if;

  -- 7 · Permisos: cio_reader lee las dos vistas; anon y authenticated no leen las tablas.
  set local role cio_reader;
  perform count(*) from cio.presencia_eventos;
  perform count(*) from cio.presencia_elegibles;
  reset role;
  if has_table_privilege('anon', 'public.presencia_profesional_eventos', 'select')
     or has_table_privilege('authenticated', 'public.presencia_profesional_eventos', 'select')
     or has_table_privilege('anon', 'public.presencia_elegibles_foto', 'select') then
    v_falla := v_falla || ' anon/authenticated pueden leer las tablas;';
  end if;
  if has_function_privilege('anon', 'public.presencia_barrido()', 'execute')
     or has_function_privilege('authenticated', 'public.presencia_barrido()', 'execute') then
    v_falla := v_falla || ' anon/authenticated pueden correr el barrido;';
  end if;
  if not exists (select 1 from cron.job where jobname = 'presencia-barrido') then
    v_falla := v_falla || ' falta el cron presencia-barrido;';
  end if;

  if v_falla = '' then raise exception 'RESULTADO_237 ok'; else raise exception 'RESULTADO_237 FALLA:%', v_falla; end if;
end $$;
