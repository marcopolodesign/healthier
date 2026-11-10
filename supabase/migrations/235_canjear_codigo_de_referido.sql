-- ============================================================
-- 235 — Canje del código de referido (fase 2 del programa de referidos)
--
-- Plan: docs/referidos-plan.md. SIN plata: no hay descuentos, créditos ni
-- premios acá. Sólo el canje (quién trajo a quién) y su visibilidad.
--
-- Qué hace:
--   1. `canjear_codigo(codigo, via)`: único camino para atribuir a alguien al
--      dueño de un código (paciente o profesional). SECURITY DEFINER, write-once,
--      sólo antes de la primera consulta (paciente) o de la verificación
--      (profesional), no a uno mismo, no en círculo, no a familiares.
--   2. Cierra el hueco de la 115: `profiles.referred_by_professional_id` ya no
--      lo puede escribir el cliente (ni al registrarse ni después). Antes un
--      paciente podía ponérselo solo y bajar a 0% la comisión de ese profesional.
--      Sólo la función (que levanta una marca de transacción), la service role y
--      SQL directo lo escriben. `comision_efectiva` NO cambia: el paciente
--      referido por un PROFESIONAL sigue quedando en 0% con él. Un paciente
--      referido por otro paciente no toca ninguna comisión (queda sólo en
--      `referral_attributions`).
--   3. `resolver_codigo_de_paciente`: para que /r/<codigo> muestre quién invita
--      cuando el código es de un paciente (sólo el nombre de pila).
--   4. `mi_programa_de_referidos()`: mi código y cuántos se sumaron (paciente y
--      profesional) para la pantalla "Invitá".
--   5. `atribuciones_de_referidos()`: todas las atribuciones con tipo, para el
--      super admin.
--   6. origen nuevo `link_paciente` en referral_attributions.
-- cio: no se redefine nada. `cio.referidos` ya expone `origen` y `tipo`, y
-- cio_reader ya las lee (231).
-- ============================================================

-- 1. origen: el link /r/ de un paciente
ALTER TABLE public.referral_attributions DROP CONSTRAINT IF EXISTS referral_attributions_origen_check;
ALTER TABLE public.referral_attributions
  ADD CONSTRAINT referral_attributions_origen_check
  CHECK (origen IN ('link_profesional', 'link_paciente', 'codigo', 'admin'));

-- 2. El cliente no escribe referred_by_professional_id
CREATE OR REPLACE FUNCTION public.proteger_atribucion_de_referido()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- auth.uid() es null para la service role y para SQL directo: esos pasan.
  IF auth.uid() IS NOT NULL
     AND coalesce(current_setting('healthier.canje', true), '') <> '1' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.referred_by_professional_id := NULL;
    ELSE
      NEW.referred_by_professional_id := OLD.referred_by_professional_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS proteger_atribucion_de_referido ON public.profiles;
CREATE TRIGGER proteger_atribucion_de_referido
  BEFORE INSERT OR UPDATE OF referred_by_professional_id ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.proteger_atribucion_de_referido();

-- 3. El canje
CREATE OR REPLACE FUNCTION public.canjear_codigo(p_codigo text, p_via text DEFAULT 'codigo')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_me      uuid := auth.uid();
  v_yo      public.profiles%ROWTYPE;
  v_codigo  text := lower(trim(coalesce(p_codigo, '')));
  v_ref     uuid;
  v_ref_rol text;
  v_ref_nom text;
  v_tipo    text;
  v_origen  text;
  v_n       integer;
BEGIN
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'sin_sesion');
  END IF;

  SELECT * INTO v_yo FROM public.profiles WHERE id = v_me;
  IF NOT FOUND OR v_yo.role NOT IN ('patient', 'professional') OR v_yo.titular_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'no_aplica');
  END IF;

  SELECT rc.user_id, p.role, coalesce(nullif(trim(p.first_name), ''), split_part(trim(p.full_name), ' ', 1))
    INTO v_ref, v_ref_rol, v_ref_nom
  FROM public.referral_codes rc
  JOIN public.profiles p ON p.id = rc.user_id
  WHERE rc.code = v_codigo AND p.deleted_at IS NULL;
  IF v_ref IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'codigo_invalido');
  END IF;

  IF v_ref = v_me THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'propio');
  END IF;

  -- Write-once: el primero gana.
  IF EXISTS (SELECT 1 FROM public.referral_attributions WHERE referred_id = v_me)
     OR v_yo.referred_by_professional_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'ya_tiene_referente');
  END IF;

  -- Nada de círculos: si yo traje a quien me trae, no vale.
  IF EXISTS (SELECT 1 FROM public.referral_attributions
              WHERE referred_id = v_ref AND referrer_id = v_me) THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'circular');
  END IF;

  -- Ventana: antes de la primera consulta (paciente) o de la verificación (profesional).
  IF v_yo.role = 'patient' THEN
    IF EXISTS (SELECT 1 FROM public.consultations c
                WHERE c.patient_id = v_me AND c.status <> 'cancelled') THEN
      RETURN jsonb_build_object('ok', false, 'motivo', 'ya_consulto');
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM public.professional_profiles pp
                WHERE pp.user_id = v_me AND pp.is_verified) THEN
      RETURN jsonb_build_object('ok', false, 'motivo', 'ya_verificado');
    END IF;
  END IF;

  v_tipo := public.tipo_de_referido(v_ref_rol, v_yo.role);
  IF v_tipo IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'no_aplica');
  END IF;

  v_origen := CASE
    WHEN p_via = 'link' AND v_ref_rol = 'professional' THEN 'link_profesional'
    WHEN p_via = 'link' THEN 'link_paciente'
    ELSE 'codigo'
  END;

  PERFORM set_config('healthier.canje', '1', true);

  INSERT INTO public.referral_attributions
    (referred_id, referrer_id, referrer_rol, referred_rol, tipo, codigo, origen)
  VALUES (v_me, v_ref, v_ref_rol, v_yo.role, v_tipo, v_codigo, v_origen)
  ON CONFLICT (referred_id) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    -- Otro canje se coló entre el chequeo y el insert: el primero gana, no se toca nada.
    PERFORM set_config('healthier.canje', '', true);
    RETURN jsonb_build_object('ok', false, 'motivo', 'ya_tiene_referente');
  END IF;

  -- La comisión 0% (comision_efectiva, 184/185) lee esta columna: sólo se
  -- escribe para un PACIENTE traído por un PROFESIONAL, igual que antes.
  IF v_yo.role = 'patient' AND v_ref_rol = 'professional' THEN
    UPDATE public.profiles SET referred_by_professional_id = v_ref WHERE id = v_me;
  END IF;

  PERFORM set_config('healthier.canje', '', true);

  RETURN jsonb_build_object('ok', true, 'tipo', v_tipo, 'referente_nombre', v_ref_nom);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('healthier.canje', '', true);
  RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.canjear_codigo(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.canjear_codigo(text, text) TO authenticated;

-- 4. /r/<codigo> de un paciente (público, sólo nombre de pila)
DROP FUNCTION IF EXISTS public.resolver_codigo_de_paciente(text);
CREATE OR REPLACE FUNCTION public.resolver_codigo_de_paciente(p_codigo text)
RETURNS TABLE (first_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT coalesce(nullif(trim(p.first_name), ''), split_part(trim(p.full_name), ' ', 1))
  FROM public.referral_codes rc
  JOIN public.profiles p ON p.id = rc.user_id
  WHERE rc.code = lower(trim(p_codigo))
    AND p.role = 'patient' AND p.deleted_at IS NULL;
$$;

GRANT EXECUTE ON FUNCTION public.resolver_codigo_de_paciente(text) TO anon, authenticated;

-- 5. Mi programa: código + cuántos se sumaron
CREATE OR REPLACE FUNCTION public.mi_programa_de_referidos()
RETURNS TABLE (codigo text, se_sumaron bigint, con_consulta bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    (SELECT rc.code FROM public.referral_codes rc WHERE rc.user_id = auth.uid()),
    (SELECT count(*) FROM public.referral_attributions a
       JOIN public.profiles p ON p.id = a.referred_id
      WHERE a.referrer_id = auth.uid() AND p.deleted_at IS NULL),
    (SELECT count(*) FROM public.referral_attributions a
       JOIN public.profiles p ON p.id = a.referred_id
      WHERE a.referrer_id = auth.uid() AND p.deleted_at IS NULL
        AND EXISTS (SELECT 1 FROM public.consultations c
                     WHERE c.patient_id = a.referred_id AND c.status = 'completed'));
$$;

REVOKE ALL ON FUNCTION public.mi_programa_de_referidos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mi_programa_de_referidos() TO authenticated;

-- 6. Super admin: todas las atribuciones con tipo
CREATE OR REPLACE FUNCTION public.atribuciones_de_referidos(p_incluir_prueba boolean DEFAULT false)
RETURNS TABLE (
  referido_id      uuid,
  referido_nombre  text,
  referido_email   text,
  referido_rol     text,
  referente_id     uuid,
  referente_nombre text,
  referente_rol    text,
  tipo             text,
  origen           text,
  codigo           text,
  atribuido_at     timestamptz,
  consultas        bigint,
  es_prueba        boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- get_my_role() es NULL sin sesión y `NULL NOT IN (...)` no dispara el RAISE: coalesce.
  IF coalesce(public.get_my_role(), '') NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'Sólo la administración puede ver las atribuciones de referidos';
  END IF;

  RETURN QUERY
  SELECT
    a.referred_id, d.full_name, d.email, a.referred_rol,
    a.referrer_id, r.full_name, a.referrer_rol,
    a.tipo, a.origen, a.codigo, a.created_at,
    (SELECT count(*) FROM public.consultations c
      WHERE c.patient_id = a.referred_id AND c.status <> 'cancelled'),
    d.es_prueba
  FROM public.referral_attributions a
  JOIN public.profiles d ON d.id = a.referred_id
  LEFT JOIN public.profiles r ON r.id = a.referrer_id
  WHERE d.deleted_at IS NULL
    AND (p_incluir_prueba OR NOT d.es_prueba)
  ORDER BY a.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.atribuciones_de_referidos(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atribuciones_de_referidos(boolean) TO authenticated;
