-- ============================================================
-- 231 — Código de referido para TODOS + atribución con tipo
--
-- Fase 1 del programa de referidos (pedido de Hyppo, 2026-11-04). Plan completo
-- en docs/referidos-plan.md. Esta migración NO aplica descuentos, NO acredita
-- nada y NO toca el cobro: sólo deja el dato de base que todas las recompensas
-- del cuadro necesitan —quién trajo a quién, y de qué tipo es ese referido—,
-- y lo expone en `cio` para Customer.io / Metabase.
--
-- Qué hace:
--   1. `referral_codes`: un código por persona (paciente o profesional titular).
--      Para el profesional es EL MISMO `professional_profiles.referral_code` de
--      la 115 — su link /r/<codigo> sigue andando igual. Los pacientes reciben
--      uno nuevo, con el mismo alfabeto.
--   2. `referral_attributions`: una fila por persona referida (una sola, write
--      once) con referente, roles de los dos lados y `tipo`
--      (profesional_paciente, paciente_paciente, ...). Se backfillea desde
--      `profiles.referred_by_professional_id` y se mantiene sola por trigger.
--      `referred_by_professional_id` y `comision_efectiva()` NO cambian: la
--      comisión 0% sigue leyendo de ahí.
--   3. `cio.referidos` (una fila por atribución) y `cio.people_referidos` (una
--      fila por persona, mismo universo que cio.people). Vistas NUEVAS a
--      propósito: `cio.people` no se toca acá para no chocar con la 230
--      (tiene_app + referido_por_profesional_id), que la redefine en paralelo.
--
-- Qué NO hace todavía (decisiones abiertas de Healthier, ver el plan):
--   · No hay forma de que un paciente CANJEE el código de otro paciente al
--     registrarse (falta UI y decidir la ventana). Por eso hoy toda atribución
--     sale del link del profesional.
--   · Influencers: no hay tipo de usuario todavía.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Códigos
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.referral_codes (
  user_id    uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  code       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS referral_codes_code_key ON public.referral_codes (code);

COMMENT ON TABLE public.referral_codes IS
  'Código de referido de cada persona (paciente o profesional titular). Para el profesional coincide con professional_profiles.referral_code (115). Se escribe sólo por trigger. Migración 231.';

ALTER TABLE public.referral_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "referral_codes_select_propio" ON public.referral_codes;
DROP POLICY IF EXISTS "referral_codes_select_admin"  ON public.referral_codes;
CREATE POLICY "referral_codes_select_propio"
  ON public.referral_codes FOR SELECT
  USING (user_id = auth.uid());
CREATE POLICY "referral_codes_select_admin"
  ON public.referral_codes FOR SELECT
  USING (public.get_my_role() IN ('admin', 'super_admin'));
-- Sin policies de escritura: los códigos los ponen los triggers de abajo.

-- El generador de la 115 sólo miraba professional_profiles. Ahora el espacio de
-- códigos es uno solo: un código de paciente no puede repetir uno de
-- profesional, porque el día que /r/<codigo> resuelva los dos, chocarían.
CREATE OR REPLACE FUNCTION public.generar_codigo_de_referido()
RETURNS text
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  alfabeto constant text := 'abcdefghjkmnpqrstuvwxyz23456789';
  codigo text;
BEGIN
  LOOP
    codigo := '';
    FOR i IN 1..8 LOOP
      codigo := codigo || substr(alfabeto, 1 + floor(random() * length(alfabeto))::int, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.professional_profiles WHERE referral_code = codigo)
          AND NOT EXISTS (SELECT 1 FROM public.referral_codes WHERE code = codigo);
  END LOOP;
  RETURN codigo;
END;
$$;

-- El código es identidad pública (se manda por WhatsApp): no cambia. La única
-- excepción es alinearlo con el del legajo profesional, que manda.
CREATE OR REPLACE FUNCTION public.congelar_codigo_de_persona()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.code IS DISTINCT FROM OLD.code
     AND NOT EXISTS (
       SELECT 1 FROM public.professional_profiles pp
       WHERE pp.user_id = NEW.user_id AND pp.referral_code = NEW.code
     ) THEN
    NEW.code := OLD.code;
  END IF;
  NEW.user_id := OLD.user_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS congelar_codigo_de_persona ON public.referral_codes;
CREATE TRIGGER congelar_codigo_de_persona
  BEFORE UPDATE ON public.referral_codes
  FOR EACH ROW EXECUTE FUNCTION public.congelar_codigo_de_persona();

-- Alta de una persona → código. Sólo titulares paciente/profesional: los
-- familiares (titular_id) no se loguean, y los roles internos no refieren.
CREATE OR REPLACE FUNCTION public.asignar_codigo_de_referido()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.role IN ('patient', 'professional') AND NEW.titular_id IS NULL THEN
    INSERT INTO public.referral_codes (user_id, code)
    VALUES (NEW.id, public.generar_codigo_de_referido())
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS asignar_codigo_de_referido ON public.profiles;
CREATE TRIGGER asignar_codigo_de_referido
  AFTER INSERT OR UPDATE OF role, titular_id ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.asignar_codigo_de_referido();

-- Legajo profesional → su código pasa a ser el del link (115). Si por algún
-- motivo chocara con otro, NO se frena el alta del legajo: se avisa y sigue.
CREATE OR REPLACE FUNCTION public.alinear_codigo_con_legajo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.referral_code IS NULL THEN
    RETURN NEW;
  END IF;
  BEGIN
    INSERT INTO public.referral_codes (user_id, code)
    VALUES (NEW.user_id, NEW.referral_code)
    ON CONFLICT (user_id) DO UPDATE SET code = EXCLUDED.code;
  EXCEPTION WHEN unique_violation OR foreign_key_violation THEN
    RAISE WARNING 'referral_codes: no se pudo alinear el código del legajo % (%)', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS alinear_codigo_con_legajo ON public.professional_profiles;
CREATE TRIGGER alinear_codigo_con_legajo
  AFTER INSERT OR UPDATE OF referral_code ON public.professional_profiles
  FOR EACH ROW EXECUTE FUNCTION public.alinear_codigo_con_legajo();

-- Backfill: primero los profesionales con legajo (su código ya circula),
-- después el resto.
INSERT INTO public.referral_codes (user_id, code)
SELECT pp.user_id, pp.referral_code
FROM public.professional_profiles pp
JOIN public.profiles p ON p.id = pp.user_id
WHERE pp.referral_code IS NOT NULL
ON CONFLICT (user_id) DO UPDATE SET code = EXCLUDED.code;

INSERT INTO public.referral_codes (user_id, code)
SELECT p.id, public.generar_codigo_de_referido()
FROM public.profiles p
WHERE p.role IN ('patient', 'professional')
  AND p.titular_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM public.referral_codes rc WHERE rc.user_id = p.id);

-- ────────────────────────────────────────────────────────────
-- 2. Atribución
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.referral_attributions (
  referred_id   uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- SET NULL: si el referente se borra, la historia del referido queda.
  referrer_id   uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  referrer_rol  text NOT NULL CHECK (referrer_rol IN ('patient', 'professional')),
  referred_rol  text NOT NULL CHECK (referred_rol IN ('patient', 'professional')),
  tipo          text NOT NULL CHECK (tipo IN (
                  'profesional_profesional', 'profesional_paciente',
                  'paciente_paciente', 'paciente_profesional')),
  codigo        text NULL,
  -- link_profesional = /r/<codigo> de la 115 (único origen hoy).
  origen        text NOT NULL CHECK (origen IN ('link_profesional', 'codigo', 'admin')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT referral_attributions_no_a_si_mismo CHECK (referrer_id IS DISTINCT FROM referred_id)
);

CREATE INDEX IF NOT EXISTS idx_referral_attributions_referrer
  ON public.referral_attributions (referrer_id, created_at DESC);

COMMENT ON TABLE public.referral_attributions IS
  'Quién trajo a quién (una fila por referido, write-once) y de qué tipo es el referido según el cuadro de Healthier. Base para las recompensas del programa. Migración 231.';

ALTER TABLE public.referral_attributions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "referral_attributions_select_partes" ON public.referral_attributions;
DROP POLICY IF EXISTS "referral_attributions_select_admin"  ON public.referral_attributions;
CREATE POLICY "referral_attributions_select_partes"
  ON public.referral_attributions FOR SELECT
  USING (referrer_id = auth.uid() OR referred_id = auth.uid());
CREATE POLICY "referral_attributions_select_admin"
  ON public.referral_attributions FOR SELECT
  USING (public.get_my_role() IN ('admin', 'super_admin'));
-- Sin policies de escritura: la atribución mueve plata (recompensas), así que
-- nunca la escribe el cliente directo.

CREATE OR REPLACE FUNCTION public.atribucion_inmutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Lo único que puede cambiar es que el referente se borre (FK SET NULL).
  IF NEW.referrer_id IS NULL AND OLD.referrer_id IS NOT NULL
     AND (NEW.referred_id, NEW.tipo, NEW.origen, NEW.created_at)
         IS NOT DISTINCT FROM (OLD.referred_id, OLD.tipo, OLD.origen, OLD.created_at) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'La atribución de un referido no se edita.';
END;
$$;

DROP TRIGGER IF EXISTS atribucion_inmutable ON public.referral_attributions;
CREATE TRIGGER atribucion_inmutable
  BEFORE UPDATE ON public.referral_attributions
  FOR EACH ROW EXECUTE FUNCTION public.atribucion_inmutable();

CREATE OR REPLACE FUNCTION public.tipo_de_referido(p_referente_rol text, p_referido_rol text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_referente_rol = 'professional' AND p_referido_rol = 'professional' THEN 'profesional_profesional'
    WHEN p_referente_rol = 'professional' AND p_referido_rol = 'patient'      THEN 'profesional_paciente'
    WHEN p_referente_rol = 'patient'      AND p_referido_rol = 'patient'      THEN 'paciente_paciente'
    WHEN p_referente_rol = 'patient'      AND p_referido_rol = 'professional' THEN 'paciente_profesional'
  END;
$$;

-- Espejo de la 115: cuando un perfil queda con referred_by_professional_id, se
-- registra la atribución. Write-once (ON CONFLICT DO NOTHING) igual que la
-- columna, que ya está congelada por `congelar_atribucion_de_referido`.
CREATE OR REPLACE FUNCTION public.registrar_atribucion_desde_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ref_rol text;
  v_tipo    text;
BEGIN
  -- Los familiares (titular_id) no son un referido aparte: cuentan por su
  -- titular, igual que en comision_efectiva (185).
  IF NEW.referred_by_professional_id IS NULL
     OR NEW.referred_by_professional_id = NEW.id
     OR NEW.titular_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT role INTO v_ref_rol FROM public.profiles WHERE id = NEW.referred_by_professional_id;
  v_tipo := public.tipo_de_referido(v_ref_rol, NEW.role);
  IF v_tipo IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.referral_attributions
    (referred_id, referrer_id, referrer_rol, referred_rol, tipo, codigo, origen, created_at)
  VALUES (
    NEW.id, NEW.referred_by_professional_id, v_ref_rol, NEW.role, v_tipo,
    (SELECT pp.referral_code FROM public.professional_profiles pp WHERE pp.user_id = NEW.referred_by_professional_id),
    'link_profesional', now()
  )
  ON CONFLICT (referred_id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Nunca frenar un alta por esto.
  RAISE WARNING 'referral_attributions: no se pudo registrar % (%)', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS registrar_atribucion_desde_link ON public.profiles;
CREATE TRIGGER registrar_atribucion_desde_link
  AFTER INSERT OR UPDATE OF referred_by_professional_id ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.registrar_atribucion_desde_link();

-- Por si se aplicó una versión anterior de esta migración que incluía familiares.
DELETE FROM public.referral_attributions a
USING public.profiles p
WHERE p.id = a.referred_id AND p.titular_id IS NOT NULL;

-- Backfill. La fecha es la del alta del referido (la atribución se fija ahí).
INSERT INTO public.referral_attributions
  (referred_id, referrer_id, referrer_rol, referred_rol, tipo, codigo, origen, created_at)
SELECT p.id, p.referred_by_professional_id, r.role, p.role,
       public.tipo_de_referido(r.role, p.role),
       pp.referral_code, 'link_profesional', p.created_at
FROM public.profiles p
JOIN public.profiles r ON r.id = p.referred_by_professional_id
LEFT JOIN public.professional_profiles pp ON pp.user_id = r.id
WHERE p.referred_by_professional_id IS NOT NULL
  AND p.referred_by_professional_id <> p.id
  AND p.titular_id IS NULL
  AND public.tipo_de_referido(r.role, p.role) IS NOT NULL
ON CONFLICT (referred_id) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 3. cio — vistas nuevas (cio.people no se toca, ver encabezado)
-- ────────────────────────────────────────────────────────────
-- Una fila por atribución. Sólo hechos de uso (cuántas, cuándo), nunca de qué.
CREATE OR REPLACE VIEW cio.referidos WITH (security_invoker = false) AS
SELECT
  a.referred_id                       AS referido_id,
  a.referred_rol                      AS referido_rol,
  a.referrer_id                       AS referente_id,
  a.referrer_rol                      AS referente_rol,
  a.tipo,
  a.origen,
  a.codigo,
  a.created_at                        AS atribuido_at,
  (SELECT count(*) FROM public.consultations c
    WHERE c.patient_id = a.referred_id AND c.status = 'completed')       AS referido_consultas_completadas,
  (SELECT min(pay.created_at) FROM public.payments pay
    WHERE pay.patient_id = a.referred_id AND pay.status = 'approved'
      AND pay.consultation_id IS NOT NULL)                                AS referido_primera_consulta_pagada_at,
  (SELECT count(*) FROM public.consultations c
    WHERE c.professional_id = a.referred_id AND c.status = 'completed')  AS referido_atenciones_completadas
FROM public.referral_attributions a
JOIN public.profiles d ON d.id = a.referred_id
WHERE d.deleted_at IS NULL AND NOT d.es_prueba;

COMMENT ON VIEW cio.referidos IS
  'Una fila por persona referida: referente, tipo (cuadro de referidos de Healthier) y los hechos que activan los hitos. Migración 231.';

-- Una fila por persona, mismo universo que cio.people. Pensada como un segundo
-- modelo de "people" en Customer.io (mismo id) hasta que se fusione con
-- cio.people cuando la 230 esté aplicada en los dos ambientes.
CREATE OR REPLACE VIEW cio.people_referidos WITH (security_invoker = false) AS
SELECT
  p.id,
  rc.code                                                        AS codigo_referido,
  a.referrer_id                                                  AS referido_por_id,
  a.tipo                                                         AS referido_tipo,
  a.created_at                                                   AS referido_at,
  (SELECT count(*) FROM public.referral_attributions x
     JOIN public.profiles xp ON xp.id = x.referred_id
    WHERE x.referrer_id = p.id AND xp.deleted_at IS NULL AND NOT xp.es_prueba) AS referidos_total,
  (SELECT count(*) FROM public.referral_attributions x
     JOIN public.profiles xp ON xp.id = x.referred_id
    WHERE x.referrer_id = p.id AND x.referred_rol = 'patient'
      AND xp.deleted_at IS NULL AND NOT xp.es_prueba)            AS referidos_pacientes,
  (SELECT count(*) FROM public.referral_attributions x
     JOIN public.profiles xp ON xp.id = x.referred_id
    WHERE x.referrer_id = p.id AND x.referred_rol = 'professional'
      AND xp.deleted_at IS NULL AND NOT xp.es_prueba)            AS referidos_profesionales,
  (SELECT count(*) FROM public.referral_attributions x
     JOIN public.profiles xp ON xp.id = x.referred_id
    WHERE x.referrer_id = p.id AND xp.deleted_at IS NULL AND NOT xp.es_prueba
      AND EXISTS (SELECT 1 FROM public.consultations c
                   WHERE c.patient_id = x.referred_id AND c.status = 'completed')) AS referidos_con_consulta,
  (SELECT count(*) FROM public.referral_attributions x
     JOIN public.profiles xp ON xp.id = x.referred_id
     JOIN public.consultations c ON c.patient_id = x.referred_id AND c.status = 'completed'
    WHERE x.referrer_id = p.id AND xp.deleted_at IS NULL AND NOT xp.es_prueba) AS consultas_de_referidos
FROM public.profiles p
LEFT JOIN public.referral_codes rc ON rc.user_id = p.id
LEFT JOIN public.referral_attributions a ON a.referred_id = p.id
WHERE p.deleted_at IS NULL AND p.titular_id IS NULL AND NOT p.es_prueba;

COMMENT ON VIEW cio.people_referidos IS
  'Atributos de referidos por persona (mismo id y universo que cio.people): su código, quién la refirió y cuánto refirió. Migración 231.';

-- El default privilege de la 140 ya cubre vistas nuevas en cio; se repite
-- explícito para no depender de quién es el dueño al aplicar.
GRANT SELECT ON cio.referidos, cio.people_referidos TO cio_reader;
