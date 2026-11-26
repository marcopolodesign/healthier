-- ============================================================
-- 252 — Socios comerciales (alianza con LIFT): link/código, 20% en la primera
--       consulta y el 5% del socio para liquidar a mano cada mes.
--
-- Lo acordado con LIFT (mail del 06/11, confirmado el 19/11) y las decisiones
-- de Mateo (2026-11-25):
--   · El socio de LIFT entra por un link/QR (/r/lift) o carga el código "lift".
--   · 20% de descuento SÓLO en su primera consulta pagada (una vez por paciente,
--     cualquier especialidad, agendada o inmediata).
--   · El descuento lo pone Healthier de su comisión: el profesional cobra lo
--     mismo que sin descuento.
--   · LIFT se lleva el 5% de cada consulta terminada de sus socios. Se calcula
--     acá y se transfiere a mano una vez por mes (no hay split automático).
--
-- Modelo (estadio MVP, pocos socios):
--   1. `socios_comerciales`: una fila por socio (LIFT es la primera). Código en
--      el mismo espacio que los de referidos (231) — /r/<codigo> resuelve los dos.
--   2. `socio_atribuciones`: qué paciente (titular) vino por qué socio.
--      Write-once y EXCLUYENTE con `referral_attributions`: una persona tiene un
--      solo "quién me trajo" (el primero gana, igual que en la 235).
--   3. `canjear_codigo` (235) aprende los códigos de socio: el registro con link,
--      el campo "¿Tenés un código?" y la carga posterior pasan todos por acá.
--   4. `socio_descuentos`: el descuento reservado/aplicado. Lo reserva
--      `mp-payment` (service role) ANTES de llamar a Mercado Pago, con un índice
--      único por paciente: dos cobros en paralelo no se lo llevan los dos.
--      Se libera si el cobro se rechaza o la consulta se cancela/vence.
--   5. `payments` guarda precio de lista, descuento y socio de cada cobro.
--   6. Super admin: resumen, socios atribuidos y liquidación del mes.
--   7. `cio.socio_consultas`: una fila por consulta terminada de un socio.
--
-- El monto NUNCA lo decide el cliente: el front sólo consulta
-- `mi_beneficio_de_socio()` para mostrar el precio; quien cobra es mp-payment
-- con `reservar_descuento_de_socio()`.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Socios comerciales
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.socios_comerciales (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre                      text NOT NULL CHECK (length(btrim(nombre)) > 0),
  codigo                      text NOT NULL CHECK (codigo ~ '^[a-z0-9-]{3,20}$'),
  -- Descuento al paciente en su primera consulta (0..1).
  descuento_primera_consulta  numeric NOT NULL DEFAULT 0.20
                              CHECK (descuento_primera_consulta >= 0 AND descuento_primera_consulta <= 1),
  -- Lo que se lleva el socio de cada consulta terminada de sus socios (0..1).
  comision_socio              numeric NOT NULL DEFAULT 0.05
                              CHECK (comision_socio >= 0 AND comision_socio <= 1),
  activo                      boolean NOT NULL DEFAULT true,
  created_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS socios_comerciales_codigo_key ON public.socios_comerciales (codigo);

COMMENT ON TABLE public.socios_comerciales IS
  'Socios comerciales (gimnasios, empresas) cuyos miembros entran con un link/código y tienen beneficio. Migración 252.';

ALTER TABLE public.socios_comerciales ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "socios_comerciales_select_admin" ON public.socios_comerciales;
CREATE POLICY "socios_comerciales_select_admin"
  ON public.socios_comerciales FOR SELECT
  USING (public.get_my_role() IN ('admin', 'super_admin'));
-- Sin policies de escritura: se cargan por migración / SQL.

INSERT INTO public.socios_comerciales (nombre, codigo, descuento_primera_consulta, comision_socio)
VALUES ('LIFT', 'lift', 0.20, 0.05)
ON CONFLICT (codigo) DO NOTHING;

-- Un código de referido nuevo no puede chocar con el de un socio.
CREATE OR REPLACE FUNCTION public.generar_codigo_de_referido()
RETURNS text
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  alfabeto constant text := 'abcdefghjkmnpqrstuvwxyz23456789';
  v_codigo text;
BEGIN
  LOOP
    v_codigo := '';
    FOR i IN 1..8 LOOP
      v_codigo := v_codigo || substr(alfabeto, 1 + floor(random() * length(alfabeto))::int, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.professional_profiles WHERE referral_code = v_codigo)
          AND NOT EXISTS (SELECT 1 FROM public.referral_codes WHERE code = v_codigo)
          AND NOT EXISTS (SELECT 1 FROM public.socios_comerciales s WHERE s.codigo = v_codigo);
  END LOOP;
  RETURN v_codigo;
END;
$$;

-- /r/<codigo> de un socio (público): nombre y descuento, nada más.
CREATE OR REPLACE FUNCTION public.resolver_codigo_de_socio(p_codigo text)
RETURNS TABLE (nombre text, descuento numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT s.nombre, s.descuento_primera_consulta
  FROM public.socios_comerciales s
  WHERE s.codigo = lower(trim(p_codigo)) AND s.activo;
$$;

GRANT EXECUTE ON FUNCTION public.resolver_codigo_de_socio(text) TO anon, authenticated;

-- ────────────────────────────────────────────────────────────
-- 2. Atribución a un socio
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.socio_atribuciones (
  paciente_id  uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  socio_id     uuid NOT NULL REFERENCES public.socios_comerciales(id),
  origen       text NOT NULL CHECK (origen IN ('link', 'codigo', 'admin')),
  codigo       text NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_socio_atribuciones_socio ON public.socio_atribuciones (socio_id, created_at DESC);

COMMENT ON TABLE public.socio_atribuciones IS
  'Qué paciente titular vino por qué socio comercial. Write-once, excluyente con referral_attributions. Migración 252.';

ALTER TABLE public.socio_atribuciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "socio_atribuciones_select_propia" ON public.socio_atribuciones;
DROP POLICY IF EXISTS "socio_atribuciones_select_admin"  ON public.socio_atribuciones;
CREATE POLICY "socio_atribuciones_select_propia"
  ON public.socio_atribuciones FOR SELECT USING (paciente_id = auth.uid());
CREATE POLICY "socio_atribuciones_select_admin"
  ON public.socio_atribuciones FOR SELECT USING (public.get_my_role() IN ('admin', 'super_admin'));

CREATE OR REPLACE FUNCTION public.socio_atribucion_inmutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'La atribución a un socio no se edita.';
END;
$$;

DROP TRIGGER IF EXISTS socio_atribucion_inmutable ON public.socio_atribuciones;
CREATE TRIGGER socio_atribucion_inmutable
  BEFORE UPDATE ON public.socio_atribuciones
  FOR EACH ROW EXECUTE FUNCTION public.socio_atribucion_inmutable();

-- ────────────────────────────────────────────────────────────
-- 3. canjear_codigo (235) — ahora también códigos de socio
--    Igual que la 235 salvo: (a) primero mira si el código es de un socio;
--    (b) quien ya está atribuido a un socio no puede canjear otro código.
-- ────────────────────────────────────────────────────────────
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
  v_socio   public.socios_comerciales%ROWTYPE;
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

  -- (a) Código de un socio comercial
  SELECT * INTO v_socio FROM public.socios_comerciales WHERE codigo = v_codigo AND activo;
  IF FOUND THEN
    IF v_yo.role <> 'patient' THEN
      RETURN jsonb_build_object('ok', false, 'motivo', 'no_aplica');
    END IF;
    IF EXISTS (SELECT 1 FROM public.socio_atribuciones WHERE paciente_id = v_me)
       OR EXISTS (SELECT 1 FROM public.referral_attributions WHERE referred_id = v_me)
       OR v_yo.referred_by_professional_id IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'motivo', 'ya_tiene_referente');
    END IF;
    -- Misma ventana que el canje de un paciente: antes de su primera consulta.
    IF EXISTS (SELECT 1 FROM public.consultations c
                JOIN public.profiles cp ON cp.id = c.patient_id
                WHERE (c.patient_id = v_me OR cp.titular_id = v_me)
                  AND c.status <> 'cancelled') THEN
      RETURN jsonb_build_object('ok', false, 'motivo', 'ya_consulto');
    END IF;

    INSERT INTO public.socio_atribuciones (paciente_id, socio_id, origen, codigo)
    VALUES (v_me, v_socio.id, CASE WHEN p_via = 'link' THEN 'link' ELSE 'codigo' END, v_codigo)
    ON CONFLICT (paciente_id) DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n = 0 THEN
      RETURN jsonb_build_object('ok', false, 'motivo', 'ya_tiene_referente');
    END IF;

    RETURN jsonb_build_object('ok', true, 'tipo', 'socio', 'referente_nombre', v_socio.nombre,
                              'descuento', v_socio.descuento_primera_consulta);
  END IF;

  -- (b) Código de una persona — 235 tal cual, más la exclusión de socios.
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

  IF EXISTS (SELECT 1 FROM public.referral_attributions WHERE referred_id = v_me)
     OR EXISTS (SELECT 1 FROM public.socio_atribuciones WHERE paciente_id = v_me)
     OR v_yo.referred_by_professional_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'ya_tiene_referente');
  END IF;

  IF EXISTS (SELECT 1 FROM public.referral_attributions
              WHERE referred_id = v_ref AND referrer_id = v_me) THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'circular');
  END IF;

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
    PERFORM set_config('healthier.canje', '', true);
    RETURN jsonb_build_object('ok', false, 'motivo', 'ya_tiene_referente');
  END IF;

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

-- ────────────────────────────────────────────────────────────
-- 4. El descuento: reservado → aplicado | liberado
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.socio_descuentos (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  socio_id         uuid NOT NULL REFERENCES public.socios_comerciales(id),
  -- El titular que paga (el socio del gimnasio). La consulta puede ser de un familiar suyo.
  paciente_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  consultation_id  uuid NOT NULL REFERENCES public.consultations(id) ON DELETE CASCADE,
  payment_id       uuid NULL REFERENCES public.payments(id) ON DELETE SET NULL,
  precio_lista     numeric NOT NULL CHECK (precio_lista > 0),
  porcentaje       numeric NOT NULL CHECK (porcentaje > 0 AND porcentaje <= 1),
  monto            numeric NOT NULL CHECK (monto > 0),
  estado           text NOT NULL DEFAULT 'reservado' CHECK (estado IN ('reservado', 'aplicado', 'liberado')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS socio_descuentos_consulta_key ON public.socio_descuentos (consultation_id);
-- LA regla de "una vez por paciente": un solo descuento vivo por titular.
CREATE UNIQUE INDEX IF NOT EXISTS socio_descuentos_uno_por_paciente
  ON public.socio_descuentos (paciente_id) WHERE estado <> 'liberado';

COMMENT ON TABLE public.socio_descuentos IS
  'Descuento de primera consulta de un socio comercial. Lo reserva mp-payment antes de cobrar; un solo descuento vivo por paciente (índice único). Migración 252.';

ALTER TABLE public.socio_descuentos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "socio_descuentos_select_propio" ON public.socio_descuentos;
DROP POLICY IF EXISTS "socio_descuentos_select_admin"  ON public.socio_descuentos;
CREATE POLICY "socio_descuentos_select_propio"
  ON public.socio_descuentos FOR SELECT USING (paciente_id = auth.uid());
CREATE POLICY "socio_descuentos_select_admin"
  ON public.socio_descuentos FOR SELECT USING (public.get_my_role() IN ('admin', 'super_admin'));

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS precio_lista    numeric NULL,
  ADD COLUMN IF NOT EXISTS descuento_socio numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS socio_id        uuid NULL REFERENCES public.socios_comerciales(id);

COMMENT ON COLUMN public.payments.precio_lista IS
  'Precio de la consulta antes del descuento de socio. gross_amount = precio_lista − descuento_socio (lo que paga el paciente). Migración 252.';
COMMENT ON COLUMN public.payments.descuento_socio IS
  'Descuento de socio comercial en este cobro (lo pone Healthier de su comisión). Migración 252.';

-- Reserva (o devuelve la ya reservada para ESTA consulta). Sólo service role.
-- No devuelve fila si no corresponde descuento o si otro cobro se lo llevó.
CREATE OR REPLACE FUNCTION public.reservar_descuento_de_socio(
  p_paciente     uuid,
  p_consulta     uuid,
  p_precio_lista numeric
)
RETURNS TABLE (descuento_id uuid, socio_id uuid, socio_nombre text, porcentaje numeric, monto numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_socio public.socios_comerciales%ROWTYPE;
  v_row   public.socio_descuentos%ROWTYPE;
BEGIN
  IF p_paciente IS NULL OR p_consulta IS NULL OR coalesce(p_precio_lista, 0) <= 0 THEN
    RETURN;
  END IF;

  SELECT s.* INTO v_socio
  FROM public.socio_atribuciones a
  JOIN public.socios_comerciales s ON s.id = a.socio_id
  WHERE a.paciente_id = p_paciente AND s.activo AND s.descuento_primera_consulta > 0;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Ya reservado/aplicado para esta misma consulta (reintento de cobro).
  SELECT * INTO v_row FROM public.socio_descuentos d
  WHERE d.consultation_id = p_consulta AND d.paciente_id = p_paciente AND d.estado <> 'liberado';
  IF FOUND THEN
    RETURN QUERY SELECT v_row.id, v_socio.id, v_socio.nombre, v_row.porcentaje, v_row.monto;
    RETURN;
  END IF;

  -- Una vez por paciente: si ya se aplicó en otra consulta (o está reservado), no.
  IF EXISTS (SELECT 1 FROM public.socio_descuentos d
             WHERE d.paciente_id = p_paciente AND d.estado <> 'liberado') THEN
    RETURN;
  END IF;

  -- "Primera consulta": ninguna consulta anterior del grupo familiar pagada o terminada.
  IF EXISTS (SELECT 1 FROM public.consultations c
             JOIN public.profiles cp ON cp.id = c.patient_id
             WHERE (c.patient_id = p_paciente OR cp.titular_id = p_paciente)
               AND c.id <> p_consulta
               AND (c.status = 'completed' OR c.payment_status IN ('paid', 'in_process'))) THEN
    RETURN;
  END IF;

  BEGIN
    INSERT INTO public.socio_descuentos
      (socio_id, paciente_id, consultation_id, precio_lista, porcentaje, monto, estado)
    VALUES (v_socio.id, p_paciente, p_consulta, p_precio_lista, v_socio.descuento_primera_consulta,
            round(p_precio_lista * v_socio.descuento_primera_consulta, 2), 'reservado')
    ON CONFLICT (consultation_id) DO UPDATE
      SET estado = 'reservado', precio_lista = EXCLUDED.precio_lista,
          porcentaje = EXCLUDED.porcentaje, monto = EXCLUDED.monto,
          payment_id = NULL, updated_at = now()
      WHERE public.socio_descuentos.estado = 'liberado'
        AND public.socio_descuentos.paciente_id = p_paciente
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    -- Otro cobro en paralelo se lo llevó: este va sin descuento.
    RETURN;
  END;

  IF v_row.id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY SELECT v_row.id, v_socio.id, v_socio.nombre, v_row.porcentaje, v_row.monto;
END;
$$;

-- Cierra la reserva según cómo salió el cobro. Sólo service role.
CREATE OR REPLACE FUNCTION public.cerrar_descuento_de_socio(
  p_descuento uuid,
  p_estado    text,
  p_payment   uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF p_estado NOT IN ('aplicado', 'liberado') THEN
    RAISE EXCEPTION 'estado inválido: %', p_estado;
  END IF;
  UPDATE public.socio_descuentos
     SET estado = p_estado,
         payment_id = coalesce(p_payment, payment_id),
         updated_at = now()
   WHERE id = p_descuento;
END;
$$;

REVOKE ALL ON FUNCTION public.reservar_descuento_de_socio(uuid, uuid, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cerrar_descuento_de_socio(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reservar_descuento_de_socio(uuid, uuid, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.cerrar_descuento_de_socio(uuid, text, uuid) TO service_role;

-- Si la consulta se cancela o vence, el descuento vuelve a estar disponible.
CREATE OR REPLACE FUNCTION public.liberar_descuento_de_socio_al_cancelar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status IN ('cancelled', 'expired') AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE public.socio_descuentos
       SET estado = 'liberado', updated_at = now()
     WHERE consultation_id = NEW.id AND estado <> 'liberado';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS liberar_descuento_de_socio_al_cancelar ON public.consultations;
CREATE TRIGGER liberar_descuento_de_socio_al_cancelar
  AFTER UPDATE OF status ON public.consultations
  FOR EACH ROW EXECUTE FUNCTION public.liberar_descuento_de_socio_al_cancelar();

-- Lo que ve el paciente para MOSTRAR el precio (no decide nada: cobra mp-payment).
CREATE OR REPLACE FUNCTION public.mi_beneficio_de_socio(p_consulta uuid DEFAULT NULL)
RETURNS TABLE (socio_nombre text, porcentaje numeric, disponible boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_me    uuid := auth.uid();
  v_socio public.socios_comerciales%ROWTYPE;
  v_disp  boolean;
BEGIN
  IF v_me IS NULL THEN
    RETURN;
  END IF;

  SELECT s.* INTO v_socio
  FROM public.socio_atribuciones a
  JOIN public.socios_comerciales s ON s.id = a.socio_id
  WHERE a.paciente_id = v_me AND s.activo;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_disp := v_socio.descuento_primera_consulta > 0
    AND NOT EXISTS (SELECT 1 FROM public.socio_descuentos d
                    WHERE d.paciente_id = v_me AND d.estado <> 'liberado'
                      AND d.consultation_id IS DISTINCT FROM p_consulta)
    AND NOT EXISTS (SELECT 1 FROM public.consultations c
                    JOIN public.profiles cp ON cp.id = c.patient_id
                    WHERE (c.patient_id = v_me OR cp.titular_id = v_me)
                      AND c.id IS DISTINCT FROM p_consulta
                      AND (c.status = 'completed' OR c.payment_status IN ('paid', 'in_process')));

  RETURN QUERY SELECT v_socio.nombre, v_socio.descuento_primera_consulta, v_disp;
END;
$$;

REVOKE ALL ON FUNCTION public.mi_beneficio_de_socio(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mi_beneficio_de_socio(uuid) TO authenticated;

-- ────────────────────────────────────────────────────────────
-- 5. Liquidación: el 5% del socio por cada consulta terminada
--    Base = lo que pagó el paciente por esa consulta (gross_amount del pago
--    aprobado, ya con el descuento). Sin pago aprobado o reembolsado → 0.
--    El mes es el de la consulta terminada (hora de Buenos Aires).
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.socio_consultas_liquidables WITH (security_invoker = true) AS
SELECT
  a.socio_id,
  c.id                                    AS consultation_id,
  c.completed_at,
  date_trunc('month', c.completed_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date AS mes,
  a.paciente_id                           AS titular_id,
  c.patient_id,
  c.professional_id,
  pay.id                                  AS payment_id,
  coalesce(pay.precio_lista, pay.gross_amount, 0)         AS precio_lista,
  coalesce(pay.descuento_socio, 0)                        AS descuento,
  coalesce(pay.gross_amount, 0)                           AS cobrado,
  s.comision_socio,
  round(coalesce(pay.gross_amount, 0) * s.comision_socio, 2) AS monto_socio,
  t.es_prueba
FROM public.consultations c
JOIN public.profiles cp ON cp.id = c.patient_id
JOIN public.socio_atribuciones a ON a.paciente_id = coalesce(cp.titular_id, cp.id)
JOIN public.socios_comerciales s ON s.id = a.socio_id
JOIN public.profiles t ON t.id = a.paciente_id
LEFT JOIN LATERAL (
  SELECT p.* FROM public.payments p
  WHERE p.consultation_id = c.id AND p.status = 'approved' AND p.refunded_at IS NULL
  ORDER BY p.created_at DESC LIMIT 1
) pay ON true
WHERE c.status = 'completed' AND c.completed_at IS NOT NULL;

REVOKE ALL ON public.socio_consultas_liquidables FROM PUBLIC, anon, authenticated;

-- ────────────────────────────────────────────────────────────
-- 6. Super admin
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.socios_resumen(p_incluir_prueba boolean DEFAULT false)
RETURNS TABLE (
  socio_id            uuid,
  nombre              text,
  codigo              text,
  activo              boolean,
  descuento           numeric,
  comision_socio      numeric,
  atribuidos          bigint,
  con_consulta        bigint,
  descuentos_aplicados bigint,
  descuentos_monto    numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF coalesce(public.get_my_role(), '') <> 'super_admin' THEN
    RAISE EXCEPTION 'No autorizado' USING errcode = '42501';
  END IF;

  RETURN QUERY
  SELECT s.id, s.nombre, s.codigo, s.activo, s.descuento_primera_consulta, s.comision_socio,
    (SELECT count(*) FROM public.socio_atribuciones a JOIN public.profiles p ON p.id = a.paciente_id
      WHERE a.socio_id = s.id AND p.deleted_at IS NULL AND (p_incluir_prueba OR NOT p.es_prueba)),
    (SELECT count(DISTINCT l.titular_id) FROM public.socio_consultas_liquidables l
      WHERE l.socio_id = s.id AND (p_incluir_prueba OR NOT l.es_prueba)),
    (SELECT count(*) FROM public.socio_descuentos d JOIN public.profiles p ON p.id = d.paciente_id
      WHERE d.socio_id = s.id AND d.estado = 'aplicado' AND (p_incluir_prueba OR NOT p.es_prueba)),
    (SELECT coalesce(sum(d.monto), 0) FROM public.socio_descuentos d JOIN public.profiles p ON p.id = d.paciente_id
      WHERE d.socio_id = s.id AND d.estado = 'aplicado' AND (p_incluir_prueba OR NOT p.es_prueba))
  FROM public.socios_comerciales s
  ORDER BY s.created_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.socio_atribuidos(p_socio uuid, p_incluir_prueba boolean DEFAULT false)
RETURNS TABLE (
  paciente_id      uuid,
  nombre           text,
  email            text,
  origen           text,
  atribuido_at     timestamptz,
  descuento_estado text,
  descuento_monto  numeric,
  consultas_terminadas bigint,
  es_prueba        boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF coalesce(public.get_my_role(), '') <> 'super_admin' THEN
    RAISE EXCEPTION 'No autorizado' USING errcode = '42501';
  END IF;

  RETURN QUERY
  SELECT a.paciente_id, p.full_name, p.email, a.origen, a.created_at,
    d.estado, d.monto,
    (SELECT count(*) FROM public.socio_consultas_liquidables l WHERE l.titular_id = a.paciente_id),
    p.es_prueba
  FROM public.socio_atribuciones a
  JOIN public.profiles p ON p.id = a.paciente_id
  LEFT JOIN LATERAL (
    SELECT x.estado, x.monto FROM public.socio_descuentos x
    WHERE x.paciente_id = a.paciente_id
    ORDER BY (x.estado <> 'liberado') DESC, x.created_at DESC LIMIT 1
  ) d ON true
  WHERE a.socio_id = p_socio AND p.deleted_at IS NULL AND (p_incluir_prueba OR NOT p.es_prueba)
  ORDER BY a.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.liquidacion_de_socio(
  p_socio          uuid,
  p_mes            date,
  p_incluir_prueba boolean DEFAULT false
)
RETURNS TABLE (
  consultation_id uuid,
  completed_at    timestamptz,
  paciente        text,
  profesional     text,
  precio_lista    numeric,
  descuento       numeric,
  cobrado         numeric,
  comision_socio  numeric,
  monto_socio     numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF coalesce(public.get_my_role(), '') <> 'super_admin' THEN
    RAISE EXCEPTION 'No autorizado' USING errcode = '42501';
  END IF;

  RETURN QUERY
  SELECT l.consultation_id, l.completed_at, pa.full_name, pr.full_name,
         l.precio_lista, l.descuento, l.cobrado, l.comision_socio, l.monto_socio
  FROM public.socio_consultas_liquidables l
  JOIN public.profiles pa ON pa.id = l.patient_id
  LEFT JOIN public.profiles pr ON pr.id = l.professional_id
  WHERE l.socio_id = p_socio
    AND l.mes = date_trunc('month', p_mes)::date
    AND (p_incluir_prueba OR NOT l.es_prueba)
  ORDER BY l.completed_at;
END;
$$;

REVOKE ALL ON FUNCTION public.socios_resumen(boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.socio_atribuidos(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.liquidacion_de_socio(uuid, date, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.socios_resumen(boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.socio_atribuidos(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.liquidacion_de_socio(uuid, date, boolean) TO authenticated;

-- ────────────────────────────────────────────────────────────
-- 7. cio — una fila por consulta terminada de un socio (reporte de Hyppo).
--    Sólo hechos de uso y montos, nada clínico. Vista NUEVA.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW cio.socio_consultas WITH (security_invoker = false) AS
SELECT
  s.nombre            AS socio,
  l.consultation_id,
  l.titular_id        AS paciente_id,
  l.completed_at,
  l.mes,
  l.precio_lista,
  l.descuento,
  l.cobrado,
  l.comision_socio,
  l.monto_socio
FROM public.socio_consultas_liquidables l
JOIN public.socios_comerciales s ON s.id = l.socio_id
JOIN public.profiles t ON t.id = l.titular_id
WHERE NOT l.es_prueba AND t.deleted_at IS NULL;

COMMENT ON VIEW cio.socio_consultas IS
  'Una fila por consulta terminada de un paciente atribuido a un socio comercial (LIFT): base y monto del socio para la liquidación mensual. Migración 252.';

GRANT SELECT ON cio.socio_consultas TO cio_reader;
