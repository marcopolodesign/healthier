-- ============================================================
-- 184 — Comisión de Healthier por profesional (+ 0% a sus referidos)
--
-- Etapas 1 y 2 del programa de referidos (Mateo, 2026-10-05):
--
--   1. El super admin le puede fijar a un profesional una tasa propia
--      (0% = exento; sirve igual para una intermedia, ej. 5%), con fecha de
--      vencimiento opcional y un motivo obligatorio.
--   2. Las consultas de un paciente que ese MISMO profesional trajo con su link
--      (`profiles.referred_by_professional_id`, migración 115) no pagan
--      comisión de Healthier.
--
-- Una sola fuente para decidir la tasa: `comision_efectiva()`. La llama
-- `mp-payment` (service role) en cada cobro de consulta — agendada, inmediata
-- (pre-autorización) y app/web por igual — y el resultado queda guardado en el
-- pago (`commission_rate_applied` + `commission_source`): se usa la tasa
-- VIGENTE AL MOMENTO DEL COBRO, y cambiarla después no reescribe la historia.
--
-- Por qué una tabla aparte y no columnas en `professional_profiles`: el
-- profesional actualiza su propia fila y `professionalService.upsert()` reenvía
-- el registro entero (ver el comentario de la 115). Con columnas ahí habría que
-- blindarlas con un trigger; con una tabla sin policies de escritura no hay nada
-- que blindar. Además deja el historial completo gratis: es append-only, la
-- fila más nueva de cada profesional es la que manda.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Historial de cambios de comisión (append-only)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.professional_commission_changes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- NULL = vuelve a la comisión general. 0 = exento.
  rate            numeric NULL CHECK (rate IS NULL OR (rate >= 0 AND rate <= 1)),
  -- NULL = sin vencimiento.
  valid_until     timestamptz NULL,
  reason          text NOT NULL CHECK (length(btrim(reason)) > 0),
  set_by          uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_commission_changes_professional
  ON public.professional_commission_changes (professional_id, created_at DESC);

COMMENT ON TABLE public.professional_commission_changes IS
  'Historial append-only de la comisión propia de cada profesional. La fila más nueva manda. Se escribe sólo con fijar_comision_de_profesional().';

ALTER TABLE public.professional_commission_changes ENABLE ROW LEVEL SECURITY;

-- Sólo lectura, y sólo el super admin: el motivo es interno. El profesional ve
-- su tasa por `mi_comision()`, que no devuelve el motivo.
DROP POLICY IF EXISTS "commission_changes_select_super_admin" ON public.professional_commission_changes;
CREATE POLICY "commission_changes_select_super_admin"
  ON public.professional_commission_changes FOR SELECT
  USING (public.get_my_role() = 'super_admin');

-- Append-only: no se corrige una fila, se agrega otra. (El DELETE queda libre
-- para que borrar un perfil cascadee; no hay policy que lo permita desde el
-- cliente.)
CREATE OR REPLACE FUNCTION public.comision_historial_inmutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'El historial de comisiones no se edita: cargá un cambio nuevo.';
END;
$$;

DROP TRIGGER IF EXISTS comision_historial_inmutable ON public.professional_commission_changes;
CREATE TRIGGER comision_historial_inmutable
  BEFORE UPDATE ON public.professional_commission_changes
  FOR EACH ROW EXECUTE FUNCTION public.comision_historial_inmutable();

-- ────────────────────────────────────────────────────────────
-- 2. Lo que se aplicó en cada cobro
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS commission_rate_applied numeric NULL,
  ADD COLUMN IF NOT EXISTS commission_source text NULL;

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_commission_source_check;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_commission_source_check
  CHECK (commission_source IS NULL OR commission_source IN ('general', 'profesional', 'referido'));

COMMENT ON COLUMN public.payments.commission_rate_applied IS
  'Tasa de comisión de Healthier usada en este cobro (0..1). NULL en pagos anteriores a la 184 y en farmacia/emergencias.';
COMMENT ON COLUMN public.payments.commission_source IS
  'De dónde salió la tasa: general (platform_settings) | profesional (tasa propia vigente) | referido (paciente traído por este profesional).';

-- ────────────────────────────────────────────────────────────
-- 3. La tasa propia vigente de un profesional
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.comision_propia_vigente(
  p_professional_id uuid,
  p_at              timestamptz DEFAULT now()
)
RETURNS TABLE (rate numeric, valid_until timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT c.rate, c.valid_until
  FROM (
    SELECT rate, valid_until
    FROM public.professional_commission_changes
    WHERE professional_id = p_professional_id
      AND created_at <= p_at
    ORDER BY created_at DESC
    LIMIT 1
  ) c
  WHERE c.rate IS NOT NULL
    AND (c.valid_until IS NULL OR c.valid_until > p_at);
$$;

-- ────────────────────────────────────────────────────────────
-- 4. comision_efectiva — LA fuente única
--    referido → 0 · tasa propia vigente → esa · si no → la general
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.comision_efectiva(
  p_professional_id uuid,
  p_patient_id      uuid,
  p_at              timestamptz DEFAULT now()
)
RETURNS TABLE (rate numeric, origen text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_rate numeric;
BEGIN
  -- Mira al paciente de la consulta (`consultations.patient_id`). Si es un
  -- familiar (181), cuenta SU atribución, no la del titular que paga.
  IF p_patient_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_patient_id
      AND referred_by_professional_id = p_professional_id
  ) THEN
    RETURN QUERY SELECT 0::numeric, 'referido'::text;
    RETURN;
  END IF;

  SELECT v.rate INTO v_rate FROM public.comision_propia_vigente(p_professional_id, p_at) v;
  IF FOUND THEN
    RETURN QUERY SELECT v_rate, 'profesional'::text;
    RETURN;
  END IF;

  SELECT coalesce(commission_rate, 0.20) INTO v_rate FROM public.platform_settings WHERE id = 1;
  RETURN QUERY SELECT coalesce(v_rate, 0.20), 'general'::text;
END;
$$;

-- Sólo el servidor: dice si un paciente fue referido por un profesional y la
-- tasa de cualquiera. El front usa mi_comision() / comisiones_de_profesionales().
REVOKE ALL ON FUNCTION public.comision_propia_vigente(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.comision_efectiva(uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.comision_propia_vigente(uuid, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.comision_efectiva(uuid, uuid, timestamptz) TO service_role;

-- ────────────────────────────────────────────────────────────
-- 5. fijar_comision_de_profesional — la acción del super admin
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fijar_comision_de_profesional(
  p_professional_id uuid,
  p_rate            numeric,
  p_until           timestamptz,
  p_reason          text
)
RETURNS public.professional_commission_changes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row public.professional_commission_changes;
BEGIN
  IF public.get_my_role() IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'No autorizado' USING errcode = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_professional_id AND role = 'professional') THEN
    RAISE EXCEPTION 'El profesional no existe o no tiene ese rol';
  END IF;

  IF p_rate IS NOT NULL AND (p_rate < 0 OR p_rate > 1) THEN
    RAISE EXCEPTION 'La comisión tiene que estar entre 0%% y 100%%';
  END IF;

  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'Falta el motivo';
  END IF;

  IF p_until IS NOT NULL AND p_until <= now() THEN
    RAISE EXCEPTION 'La fecha de vencimiento tiene que ser futura';
  END IF;

  INSERT INTO public.professional_commission_changes (professional_id, rate, valid_until, reason, set_by)
  VALUES (p_professional_id, p_rate, CASE WHEN p_rate IS NULL THEN NULL ELSE p_until END, btrim(p_reason), auth.uid())
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.fijar_comision_de_profesional(uuid, numeric, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fijar_comision_de_profesional(uuid, numeric, timestamptz, text) TO authenticated;

-- ────────────────────────────────────────────────────────────
-- 6. comisiones_de_profesionales — la columna del panel (super admin)
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.comisiones_de_profesionales()
RETURNS TABLE (
  professional_id uuid,
  rate            numeric,
  valid_until     timestamptz,
  vigente         boolean,
  reason          text,
  set_by_name     text,
  set_at          timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF public.get_my_role() IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'No autorizado' USING errcode = '42501';
  END IF;

  RETURN QUERY
  SELECT DISTINCT ON (c.professional_id)
    c.professional_id,
    c.rate,
    c.valid_until,
    (c.rate IS NOT NULL AND (c.valid_until IS NULL OR c.valid_until > now())) AS vigente,
    c.reason,
    p.full_name,
    c.created_at
  FROM public.professional_commission_changes c
  LEFT JOIN public.profiles p ON p.id = c.set_by
  ORDER BY c.professional_id, c.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.comisiones_de_profesionales() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.comisiones_de_profesionales() TO authenticated;

-- ────────────────────────────────────────────────────────────
-- 7. mi_comision — lo que ve el profesional (sin el motivo)
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mi_comision()
RETURNS TABLE (
  rate                numeric,
  valid_until         timestamptz,
  origen              text,
  general_rate        numeric,
  pacientes_referidos integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_general numeric;
  v_rate    numeric;
  v_until   timestamptz;
  v_refs    integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  SELECT coalesce(commission_rate, 0.20) INTO v_general FROM public.platform_settings WHERE id = 1;
  v_general := coalesce(v_general, 0.20);

  SELECT count(*)::integer INTO v_refs
  FROM public.profiles WHERE referred_by_professional_id = auth.uid();

  SELECT v.rate, v.valid_until INTO v_rate, v_until
  FROM public.comision_propia_vigente(auth.uid()) v;

  IF FOUND THEN
    RETURN QUERY SELECT v_rate, v_until, 'profesional'::text, v_general, v_refs;
  ELSE
    RETURN QUERY SELECT v_general, NULL::timestamptz, 'general'::text, v_general, v_refs;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.mi_comision() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mi_comision() TO authenticated;

-- ────────────────────────────────────────────────────────────
-- 8. reassign_consultation (102) — la deuda usa lo que se cobró de verdad
--
-- Antes calculaba el neto con la comisión general. Con tasas por profesional
-- eso puede no coincidir con lo que el original cobró: el neto en juego es el
-- `net_to_professional` del pago (fijado con la tasa vigente al cobrar). Sin
-- pago, el monto es 0 igual y el neto queda informativo con la tasa general.
-- El resto de la función queda idéntico.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reassign_consultation(
  p_consultation_id     uuid,
  p_new_professional_id uuid,
  p_reason              text default null
)
RETURNS public.consultation_reassignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_consultation       public.consultations%rowtype;
  v_original           uuid;
  v_commission_rate    numeric;
  v_net_amount         numeric;
  v_payment            public.payments%rowtype;
  v_already_recovered  numeric := 0;
  v_result             public.consultation_reassignments;
begin
  if public.get_my_role() <> 'super_admin' then
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
$$;
