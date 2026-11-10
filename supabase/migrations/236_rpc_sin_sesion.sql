-- 236 — Las RPC SECURITY DEFINER no se pueden llamar sin sesión.
--
-- El problema: varias guardas eran `IF public.get_my_role() NOT IN (...) THEN RAISE`
-- o `IF x <> auth.uid() THEN RAISE`. Sin sesión `get_my_role()` y `auth.uid()` dan
-- NULL, `NULL NOT IN (...)` y `x <> NULL` dan NULL, el IF no dispara y la función
-- sigue. Encima conservaban EXECUTE para PUBLIC/anon (la 140 sólo revocó las que
-- existían ese día). Reproducido en staging con la anon key, sin token: se leían
-- todos los profesionales con mail y código, los referidos de cualquiera, saldos
-- de crédito y deuda, y se podían liquidar pagos, reasignar consultas, cerrar
-- consultas y mandar push a cualquier usuario.
--
-- Qué hace:
--   1. Guardas a prueba de NULL (coalesce / IS DISTINCT FROM / uid NULL = rechazo).
--      Parte de la definición VIVA de staging, no de la migración vieja.
--   2. REVOKE de PUBLIC y anon en todo lo que necesita sesión; GRANT a authenticated.
--   3. Las de uso interno (cron, Edge Functions con service key, triggers) quedan
--      sólo para service_role: ni anon ni authenticated.
--
-- Quedan públicas a propósito (se llaman antes de iniciar sesión o las usan las
-- policies de RLS): resolver_link_de_referido, resolver_codigo_de_paciente,
-- cuenta_dada_de_baja, y los helpers de RLS (get_my_role, es_operador_de_plataforma,
-- has_shared_consultation, puedo_actuar_como, soy_*, movil_de_guardia, mundo_que_veo,
-- veo_bajas, entidad_de_ambulancia, mi_entidad_de_emergencias, puede_tomar_ondemand,
-- profesionales_en_atencion, profesional_puede_recetar, _aal_actor_es_admin).
-- `bloquear_cambios_tras_rechazo_permanente` (trigger, 097) NO se toca: con NULL deja
-- pasar a la service key a propósito y a anon no lo ejecuta nadie (es trigger).
-- Idempotente: se puede correr dos veces.

-- 1. Guardas a prueba de NULL

CREATE OR REPLACE FUNCTION public.get_credit_balance(p_patient uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_balance numeric;
BEGIN
  -- Sin sesión (uid NULL) sólo pasa la service key; el anon queda afuera acá y
  -- además por el REVOKE.
  IF auth.role() = 'anon'
     OR (auth.uid() IS NOT NULL
         AND auth.uid() IS DISTINCT FROM p_patient
         AND coalesce(public.get_my_role(), '') NOT IN ('admin', 'super_admin')) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  SELECT COALESCE(SUM(amount), 0)
    INTO v_balance
    FROM public.patient_credits
    WHERE patient_id = p_patient;

  RETURN v_balance;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_professional_pending_debt(p_professional uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_debt numeric;
begin
  if auth.role() = 'anon'
     or (auth.uid() is not null
         and auth.uid() is distinct from p_professional
         and coalesce(public.get_my_role(), '') not in ('admin', 'super_admin')) then
    raise exception 'No autorizado';
  end if;

  select coalesce(sum(amount_to_recover_from_original - amount_recovered), 0)
    into v_debt
    from public.consultation_reassignments
    where original_professional_id = p_professional
      and status in ('pending', 'partially_recovered');

  return greatest(v_debt, 0);
end;
$function$;

CREATE OR REPLACE FUNCTION public.referidos_de_profesional(p_professional_id uuid)
 RETURNS TABLE(patient_id uuid, full_name text, email text, created_at timestamp with time zone, consultas bigint, primera_consulta timestamp with time zone, es_prueba boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF coalesce(public.get_my_role(), '') NOT IN ('admin', 'super_admin')
     AND auth.uid() IS DISTINCT FROM p_professional_id THEN
    RAISE EXCEPTION 'Sin acceso a los referidos de ese profesional';
  END IF;

  RETURN QUERY
  SELECT
    pr.id,
    pr.full_name,
    pr.email,
    pr.created_at,
    (SELECT count(*) FROM public.consultations c WHERE c.patient_id = pr.id),
    (SELECT min(c.scheduled_at) FROM public.consultations c WHERE c.patient_id = pr.id),
    pr.es_prueba
  FROM public.profiles pr
  WHERE pr.referred_by_professional_id = p_professional_id
  ORDER BY pr.created_at DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.resumen_de_referidos(p_incluir_prueba boolean DEFAULT false)
 RETURNS TABLE(professional_id uuid, full_name text, email text, specialty text, referral_code text, is_verified boolean, visitas bigint, registros bigint, con_consulta bigint, ultima_visita timestamp with time zone, es_prueba boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF coalesce(public.get_my_role(), '') NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'Sólo la administración puede ver el resumen de referidos';
  END IF;

  -- Los alias `pro_id` no son cosméticos: ver la 115 (columna homónima de un
  -- parámetro OUT → "column reference is ambiguous").
  RETURN QUERY
  SELECT
    p.id,
    p.full_name,
    p.email,
    pp.specialty,
    pp.referral_code,
    pp.is_verified,
    coalesce(v.visitas, 0),
    coalesce(r.registros, 0),
    coalesce(r.con_consulta, 0),
    v.ultima,
    p.es_prueba
  FROM public.profiles p
  JOIN public.professional_profiles pp ON pp.user_id = p.id
  LEFT JOIN (
    SELECT rv.professional_id AS pro_id, count(*) AS visitas, max(rv.created_at) AS ultima
    FROM public.professional_referral_visits rv
    GROUP BY rv.professional_id
  ) v ON v.pro_id = p.id
  LEFT JOIN (
    SELECT
      pr.referred_by_professional_id AS pro_id,
      count(*) AS registros,
      count(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM public.consultations c WHERE c.patient_id = pr.id
      )) AS con_consulta
    FROM public.profiles pr
    WHERE pr.referred_by_professional_id IS NOT NULL
      AND (p_incluir_prueba OR NOT pr.es_prueba)
    GROUP BY pr.referred_by_professional_id
  ) r ON r.pro_id = p.id
  WHERE p.role = 'professional'
    AND (p_incluir_prueba OR NOT p.es_prueba)
  ORDER BY coalesce(r.registros, 0) DESC, coalesce(v.visitas, 0) DESC, p.full_name;
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_reassignment_owed_paid(p_reassignment_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if coalesce(public.get_my_role(), '') <> 'super_admin' then
    raise exception 'No autorizado';
  end if;

  update public.consultation_reassignments
    set owed_settled_at = now(),
        owed_settled_by = auth.uid()
    where id = p_reassignment_id
      and amount_owed_to_covering_professional > 0
      and owed_settled_at is null;

  if not found then
    raise exception 'Transferencia no encontrada o ya liquidada';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.mark_settlement_paid(p_payment uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF coalesce(public.get_my_role(), '') <> 'super_admin' THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  UPDATE public.payments
  SET settled_at = now(),
      settled_by = auth.uid()
  WHERE id = p_payment
    AND manual_settlement_amount > 0
    AND settled_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pago no encontrado o ya liquidado';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reassign_consultation(p_consultation_id uuid, p_new_professional_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS consultation_reassignments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_consultation       public.consultations%rowtype;
  v_original           uuid;
  v_commission_rate    numeric;
  v_net_amount         numeric;
  v_payment            public.payments%rowtype;
  v_already_recovered  numeric := 0;
  v_result             public.consultation_reassignments;
begin
  if coalesce(public.get_my_role(), '') <> 'super_admin' then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  if p_new_professional_id is null then
    raise exception 'Falta el profesional que va a atender la consulta';
  end if;

  if not exists (select 1 from public.profiles where id = p_new_professional_id and role = 'professional') then
    raise exception 'El profesional destino no existe o no tiene ese rol';
  end if;

  select * into v_consultation
    from public.consultations
    where id = p_consultation_id
    for update;

  if not found then
    raise exception 'Consulta no encontrada';
  end if;

  if v_consultation.professional_id = p_new_professional_id then
    raise exception 'La consulta ya está asignada a ese profesional';
  end if;

  v_original := coalesce(v_consultation.original_professional_id, v_consultation.professional_id);

  -- El pago que importa es el que está (o va a quedar) firmado contra el
  -- ORIGINAL — no contra quien esté asignado hoy.
  select * into v_payment
    from public.payments
    where consultation_id = p_consultation_id
      and professional_id = v_original
      and status in ('authorized', 'approved')
    order by created_at desc
    limit 1;

  if v_payment.id is not null and v_payment.net_to_professional is not null then
    v_net_amount := round(v_payment.net_to_professional, 2);
  else
    select coalesce(commission_rate, 0.20) into v_commission_rate
      from public.platform_settings where id = 1;
    v_net_amount := round(coalesce(v_consultation.price_at_booking, 0) * (1 - coalesce(v_commission_rate, 0.20)), 2);
  end if;

  select coalesce(sum(amount_recovered), 0) into v_already_recovered
    from public.consultation_reassignments
    where consultation_id = p_consultation_id
      and status in ('pending', 'partially_recovered');

  update public.consultation_reassignments
    set status = 'superseded',
        amount_owed_to_covering_professional = 0,
        amount_to_recover_from_original = 0,
        notes = coalesce(notes || ' — ', '') || 'Superada por una nueva reasignación el ' || to_char(now(), 'YYYY-MM-DD HH24:MI'),
        updated_at = now()
    where consultation_id = p_consultation_id
      and status in ('pending', 'partially_recovered');

  insert into public.consultation_reassignments (
    consultation_id, payment_id,
    original_professional_id, covering_professional_id,
    reassigned_by, reason,
    gross_amount, net_amount,
    amount_owed_to_covering_professional,
    amount_to_recover_from_original,
    amount_recovered,
    status
  ) values (
    p_consultation_id, v_payment.id,
    v_original, p_new_professional_id,
    auth.uid(), p_reason,
    coalesce(v_consultation.price_at_booking, 0), v_net_amount,
    case when v_payment.id is null then 0 else v_net_amount end,
    case when v_payment.id is null then 0 else greatest(v_net_amount - v_already_recovered, 0) end,
    0,
    case when v_payment.id is null then 'no_payment' else 'pending' end
  )
  returning * into v_result;

  update public.consultations
    set professional_id = p_new_professional_id,
        original_professional_id = v_original
    where id = p_consultation_id;

  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.completar_cierre_de_consulta(p_consultation_id uuid, p_closing_notes text DEFAULT NULL::text, p_motivo_sin_codigo text DEFAULT NULL::text)
 RETURNS consultations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row      public.consultations%rowtype;
  v_duration int;
begin
  select * into v_row from public.consultations where id = p_consultation_id;
  if not found then
    raise exception 'Consulta no encontrada';
  end if;
  if auth.uid() is null or v_row.professional_id is distinct from auth.uid() then
    raise exception 'No autorizado';
  end if;
  if v_row.modality = 'presencial' then
    raise exception 'La consulta presencial se cierra con finalize_consultation, no con este camino';
  end if;
  if v_row.status not in ('closing', 'in_progress') then
    raise exception 'La consulta no está en un estado que se pueda cerrar (estado actual: %)', v_row.status;
  end if;

  -- El código de cierre es lo que habilita esta transición (pedido de Mateo).
  -- La única salida sin código es un motivo explícito y no vacío — el caso
  -- normal es que el paciente ya se fue de la llamada.
  if v_row.closing_code_verified_at is null
     and (p_motivo_sin_codigo is null or btrim(p_motivo_sin_codigo) = '') then
    raise exception 'Hace falta el código verificado o un motivo para cerrar sin código.';
  end if;

  v_duration := greatest(1, (
    extract(epoch from (now() - coalesce(v_row.started_at, v_row.closing_started_at, v_row.scheduled_at))) / 60
  )::int);

  update public.consultations
     set status                       = 'completed',
         completed_at                 = coalesce(completed_at, now()),
         professional_ended_at        = coalesce(professional_ended_at, now()),
         duration_minutes             = coalesce(duration_minutes, v_duration),
         closing_notes                = coalesce(nullif(btrim(p_closing_notes), ''), closing_notes),
         closing_skipped_code_reason  = case
                                           when v_row.closing_code_verified_at is null
                                           then btrim(p_motivo_sin_codigo)
                                           else closing_skipped_code_reason
                                         end,
         updated_at                   = now()
   where id = p_consultation_id
  returning * into v_row;

  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.verificar_codigo_de_cierre(p_consultation_id uuid, p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row          public.consultations%rowtype;
  v_code         text;
  v_max_intentos constant int := 5;
begin
  select * into v_row from public.consultations where id = p_consultation_id;
  if not found then
    raise exception 'Consulta no encontrada';
  end if;
  if auth.uid() is null or v_row.professional_id is distinct from auth.uid() then
    raise exception 'No autorizado';
  end if;
  if v_row.modality = 'presencial' then
    raise exception 'La consulta presencial no usa código de cierre';
  end if;
  if v_row.status not in ('in_progress', 'closing') then
    raise exception 'La consulta no está en curso ni cerrando (estado actual: %)', v_row.status;
  end if;

  -- Idempotente: reintentar tras verificar no debe consumir intentos ni fallar.
  if v_row.closing_code_verified_at is not null then
    return jsonb_build_object(
      'ok', true,
      'intentos_restantes', v_max_intentos,
      'closing_code_verified_at', v_row.closing_code_verified_at
    );
  end if;

  if v_row.closing_code_attempts >= v_max_intentos then
    return jsonb_build_object(
      'ok', false,
      'intentos_restantes', 0,
      'closing_code_verified_at', null,
      'motivo', 'intentos_agotados'
    );
  end if;

  select code into v_code
    from public.consultation_validation_codes
   where consultation_id = p_consultation_id;

  if v_code is distinct from p_code then
    update public.consultations
       set closing_code_attempts = closing_code_attempts + 1
     where id = p_consultation_id
    returning closing_code_attempts into v_row.closing_code_attempts;

    return jsonb_build_object(
      'ok', false,
      'intentos_restantes', greatest(0, v_max_intentos - v_row.closing_code_attempts),
      'closing_code_verified_at', null,
      'motivo', 'codigo_incorrecto'
    );
  end if;

  update public.consultations
     set closing_code_verified_at = now()
   where id = p_consultation_id
  returning closing_code_verified_at into v_row.closing_code_verified_at;

  return jsonb_build_object(
    'ok', true,
    'intentos_restantes', v_max_intentos,
    'closing_code_verified_at', v_row.closing_code_verified_at
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.start_consultation(p_consultation_id uuid, p_code text)
 RETURNS consultations
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_row  public.consultations%ROWTYPE;
  v_code text;
BEGIN
  SELECT * INTO v_row FROM public.consultations WHERE id = p_consultation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Consulta no encontrada'; END IF;
  IF auth.uid() IS NULL OR v_row.professional_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'No autorizado'; END IF;

  SELECT code INTO v_code
    FROM public.consultation_validation_codes
    WHERE consultation_id = p_consultation_id;
  IF v_code IS DISTINCT FROM p_code THEN
    RAISE EXCEPTION 'Código inválido';
  END IF;

  UPDATE public.consultations
    SET status     = 'in_progress',
        started_at = COALESCE(started_at, now())
  WHERE id = p_consultation_id;

  SELECT * INTO v_row FROM public.consultations WHERE id = p_consultation_id;
  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_consultation(p_consultation_id uuid, p_role text, p_code text DEFAULT NULL::text, p_closing_notes text DEFAULT NULL::text, p_prescription_url text DEFAULT NULL::text)
 RETURNS consultations
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_row     public.consultations%ROWTYPE;
  v_code    text;
  v_duration integer;
BEGIN
  SELECT * INTO v_row FROM public.consultations WHERE id = p_consultation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Consulta no encontrada'; END IF;

  IF p_role = 'patient' THEN
    IF auth.uid() IS NULL OR (v_row.patient_id IS DISTINCT FROM auth.uid() AND NOT public.es_titular_de(auth.uid(), v_row.patient_id)) THEN RAISE EXCEPTION 'No autorizado'; END IF;
    UPDATE public.consultations
      SET patient_ended_at = COALESCE(patient_ended_at, now())
      WHERE id = p_consultation_id;

  ELSIF p_role = 'professional' THEN
    IF auth.uid() IS NULL OR v_row.professional_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'No autorizado'; END IF;

    IF v_row.started_at IS NOT NULL THEN
      v_duration := GREATEST(1, EXTRACT(EPOCH FROM (now() - v_row.started_at))::integer / 60);
    END IF;

    IF v_row.modality = 'presencial' THEN
      -- Presencial: direct close, duration already tracked via started_at
      UPDATE public.consultations
        SET professional_ended_at = COALESCE(professional_ended_at, now()),
            status                = 'completed',
            completed_at          = COALESCE(completed_at, now()),
            duration_minutes      = COALESCE(duration_minutes, v_duration),
            closing_notes         = COALESCE(p_closing_notes, closing_notes),
            prescription_url      = COALESCE(p_prescription_url, prescription_url)
        WHERE id = p_consultation_id;
    ELSE
      -- Video: code force-complete or dual-handshake
      IF p_code IS NOT NULL THEN
        SELECT code INTO v_code
          FROM public.consultation_validation_codes
          WHERE consultation_id = p_consultation_id;
        IF v_code IS DISTINCT FROM p_code THEN
          RAISE EXCEPTION 'Código inválido';
        END IF;
        UPDATE public.consultations
          SET professional_ended_at = COALESCE(professional_ended_at, now()),
              status                = 'completed',
              completed_at          = COALESCE(completed_at, now()),
              duration_minutes      = COALESCE(duration_minutes, v_duration),
              closing_notes         = COALESCE(p_closing_notes, closing_notes),
              prescription_url      = COALESCE(p_prescription_url, prescription_url)
          WHERE id = p_consultation_id;
      ELSE
        UPDATE public.consultations
          SET professional_ended_at = COALESCE(professional_ended_at, now()),
              duration_minutes      = COALESCE(duration_minutes, v_duration),
              closing_notes         = COALESCE(p_closing_notes, closing_notes),
              prescription_url      = COALESCE(p_prescription_url, prescription_url)
          WHERE id = p_consultation_id;
      END IF;
    END IF;

  ELSE
    RAISE EXCEPTION 'Rol inválido: debe ser patient o professional';
  END IF;

  -- Auto-complete (video dual-handshake)
  SELECT * INTO v_row FROM public.consultations WHERE id = p_consultation_id;
  IF v_row.patient_ended_at IS NOT NULL
     AND v_row.professional_ended_at IS NOT NULL
     AND v_row.status <> 'completed' THEN
    UPDATE public.consultations
      SET status           = 'completed',
          completed_at     = COALESCE(completed_at, now()),
          duration_minutes = COALESCE(duration_minutes, v_duration)
      WHERE id = p_consultation_id;
  END IF;

  SELECT * INTO v_row FROM public.consultations WHERE id = p_consultation_id;
  RETURN v_row;
END;
$function$;

-- 2. Necesitan sesión: fuera PUBLIC y anon

REVOKE ALL ON FUNCTION public.get_credit_balance(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_credit_balance(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_professional_pending_debt(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_professional_pending_debt(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.referidos_de_profesional(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.referidos_de_profesional(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.resumen_de_referidos(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resumen_de_referidos(boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.mark_reassignment_owed_paid(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_reassignment_owed_paid(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.mark_settlement_paid(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_settlement_paid(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.reassign_consultation(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reassign_consultation(uuid, uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.completar_cierre_de_consulta(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.completar_cierre_de_consulta(uuid, text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.verificar_codigo_de_cierre(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verificar_codigo_de_cierre(uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.start_consultation(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_consultation(uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.finalize_consultation(uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalize_consultation(uuid, text, text, text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.promote_user_to_admin(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.promote_user_to_admin(text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.complete_patient_rcta_data(uuid, uuid, text, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_patient_rcta_data(uuid, uuid, text, text, date) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.accept_ondemand_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_ondemand_request(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.actualizar_item_pedido_medicamentos(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.actualizar_item_pedido_medicamentos(uuid, integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.agregar_item_pedido_medicamentos(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agregar_item_pedido_medicamentos(uuid, integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.marcar_notificaciones_leidas(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.marcar_notificaciones_leidas(uuid[]) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.mis_referidos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mis_referidos() TO authenticated, service_role;

-- 3. Uso interno: sólo service_role (cron, Edge Functions, otras funciones definer)

REVOKE ALL ON FUNCTION public.apply_debt_recovery(uuid, numeric, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_debt_recovery(uuid, numeric, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.enviar_push(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enviar_push(uuid, text, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.cerrar_consultas_colgadas() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cerrar_consultas_colgadas() TO service_role;
REVOKE ALL ON FUNCTION public.recalc_professional_rating(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recalc_professional_rating(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.recalcular_total_pedido_medicamentos(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recalcular_total_pedido_medicamentos(uuid) TO service_role;
