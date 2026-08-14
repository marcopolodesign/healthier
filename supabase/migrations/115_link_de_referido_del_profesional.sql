-- ============================================================
-- 115 — Link de referido del profesional
--
-- Cada profesional tiene un link propio (`/r/<codigo>`) para mandarle a los
-- pacientes que ya atiende fuera de Healthier. Lo que entra por ese link queda
-- atribuido a él, y el super admin ve el embudo completo.
--
-- Se mide en dos puntos, no en uno:
--   · la VISITA al link (professional_referral_visits) — append-only
--   · el REGISTRO atribuido (profiles.referred_by_professional_id)
-- Sin lo primero, "0 pacientes referidos" es ambiguo: no distingue "no mandó el
-- link" de "lo mandó y nadie se registró", que son dos problemas distintos y se
-- arreglan de manera distinta. Mismo criterio que la bitácora de onboarding (112).
--
-- La atribución UTM existente NO se toca: el link también escribe
-- `utm_source='referido_profesional'` desde el cliente, así que los reportes de
-- canales que ya existen lo ven como una fuente más.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Código de referido en professional_profiles
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.professional_profiles
  ADD COLUMN IF NOT EXISTS referral_code text;

COMMENT ON COLUMN public.professional_profiles.referral_code IS
  'Código corto del link de referido del profesional (/r/<codigo>). Se genera solo al crear el legajo y no cambia.';

-- Alfabeto sin i/l/o/0/1: el link se dicta por teléfono y por WhatsApp, y esos
-- cinco caracteres son los que se confunden.
CREATE OR REPLACE FUNCTION public.generar_codigo_de_referido()
RETURNS text
LANGUAGE plpgsql
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
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.professional_profiles WHERE referral_code = codigo
    );
  END LOOP;
  RETURN codigo;
END;
$$;

-- Backfill de los legajos que ya existen.
UPDATE public.professional_profiles
SET referral_code = public.generar_codigo_de_referido()
WHERE referral_code IS NULL;

ALTER TABLE public.professional_profiles
  ALTER COLUMN referral_code SET DEFAULT public.generar_codigo_de_referido();

CREATE UNIQUE INDEX IF NOT EXISTS professional_profiles_referral_code_key
  ON public.professional_profiles (referral_code);

-- El código es la identidad pública del link: si cambia, todos los mensajes de
-- WhatsApp que el profesional ya mandó dejan de funcionar. Se deja escribir una
-- sola vez.
--
-- El DEFAULT de arriba no alcanza por sí solo: `professionalService.upsert()`
-- reenvía el registro entero, así que un cliente puede mandar `referral_code:
-- null` explícito — y un NULL explícito en un INSERT le gana al DEFAULT. El
-- trigger BEFORE INSERT lo cubre.
CREATE OR REPLACE FUNCTION public.congelar_codigo_de_referido()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.referral_code IS NULL THEN
      NEW.referral_code := public.generar_codigo_de_referido();
    END IF;
  ELSIF OLD.referral_code IS NOT NULL AND NEW.referral_code IS DISTINCT FROM OLD.referral_code THEN
    NEW.referral_code := OLD.referral_code;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS congelar_codigo_de_referido ON public.professional_profiles;
CREATE TRIGGER congelar_codigo_de_referido
  BEFORE INSERT OR UPDATE ON public.professional_profiles
  FOR EACH ROW EXECUTE FUNCTION public.congelar_codigo_de_referido();

-- ────────────────────────────────────────────────────────────
-- 2. Atribución en profiles
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS referred_by_professional_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_referred_by
  ON public.profiles (referred_by_professional_id)
  WHERE referred_by_professional_id IS NOT NULL;

COMMENT ON COLUMN public.profiles.referred_by_professional_id IS
  'Profesional que trajo a este usuario por su link de referido. Se escribe una sola vez, al registrarse.';

-- Write-once: la atribución se fija al registrarse y después no se puede
-- reescribir desde el cliente (el usuario puede actualizar su propia fila).
CREATE OR REPLACE FUNCTION public.congelar_atribucion_de_referido()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.referred_by_professional_id IS NOT NULL
     AND NEW.referred_by_professional_id IS DISTINCT FROM OLD.referred_by_professional_id THEN
    NEW.referred_by_professional_id := OLD.referred_by_professional_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS congelar_atribucion_de_referido ON public.profiles;
CREATE TRIGGER congelar_atribucion_de_referido
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.congelar_atribucion_de_referido();

-- ────────────────────────────────────────────────────────────
-- 3. Visitas al link — append-only
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.professional_referral_visits (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  codigo          text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_referral_visits_professional
  ON public.professional_referral_visits (professional_id, created_at DESC);

ALTER TABLE public.professional_referral_visits ENABLE ROW LEVEL SECURITY;

-- Se escribe SÓLO desde `resolver_link_de_referido` (SECURITY DEFINER). No hay
-- policy de INSERT a propósito: el link es público y una policy abierta lo
-- convertiría en un contador que cualquiera puede inflar desde la consola.
CREATE POLICY "referral_visits_select_propio"
  ON public.professional_referral_visits FOR SELECT
  USING (professional_id = auth.uid());

CREATE POLICY "referral_visits_select_admin"
  ON public.professional_referral_visits FOR SELECT
  USING (public.get_my_role() IN ('admin', 'super_admin'));

-- ────────────────────────────────────────────────────────────
-- 4. Resolver el link (público, anónimo)
-- ────────────────────────────────────────────────────────────
-- Devuelve sólo lo que ya es público en el perfil del profesional. Es SECURITY
-- DEFINER porque además registra la visita, que el anónimo no puede escribir.
CREATE OR REPLACE FUNCTION public.resolver_link_de_referido(
  p_codigo text,
  p_registrar_visita boolean DEFAULT true
)
RETURNS TABLE (
  professional_id         uuid,
  professional_profile_id uuid,
  full_name               text,
  avatar_url              text,
  specialty               text,
  sub_specialty           text,
  bio                     text,
  is_verified             boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pro_id uuid;
BEGIN
  SELECT pp.user_id INTO v_pro_id
  FROM public.professional_profiles pp
  WHERE pp.referral_code = lower(trim(p_codigo))
  LIMIT 1;

  IF v_pro_id IS NULL THEN
    RETURN;
  END IF;

  IF p_registrar_visita THEN
    INSERT INTO public.professional_referral_visits (professional_id, codigo)
    VALUES (v_pro_id, lower(trim(p_codigo)));
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    pp.id,
    p.full_name,
    p.avatar_url,
    pp.specialty,
    pp.sub_specialty,
    pp.bio,
    pp.is_verified
  FROM public.profiles p
  JOIN public.professional_profiles pp ON pp.user_id = p.id
  WHERE p.id = v_pro_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolver_link_de_referido(text, boolean) TO anon, authenticated;

-- ────────────────────────────────────────────────────────────
-- 5. Resumen para el profesional
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mis_referidos()
RETURNS TABLE (visitas bigint, registros bigint, con_consulta bigint)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (SELECT count(*) FROM public.professional_referral_visits v WHERE v.professional_id = auth.uid()),
    (SELECT count(*) FROM public.profiles pr WHERE pr.referred_by_professional_id = auth.uid()),
    (SELECT count(DISTINCT c.patient_id)
       FROM public.consultations c
       JOIN public.profiles pr ON pr.id = c.patient_id
      WHERE pr.referred_by_professional_id = auth.uid());
$$;

GRANT EXECUTE ON FUNCTION public.mis_referidos() TO authenticated;

-- ────────────────────────────────────────────────────────────
-- 6. Resumen para el super admin
-- ────────────────────────────────────────────────────────────
-- Una sola consulta en vez de N+1 desde el cliente. El chequeo de rol va adentro
-- porque la función es SECURITY DEFINER y lee `profiles` de todo el mundo.
CREATE OR REPLACE FUNCTION public.resumen_de_referidos()
RETURNS TABLE (
  professional_id uuid,
  full_name       text,
  email           text,
  specialty       text,
  referral_code   text,
  is_verified     boolean,
  visitas         bigint,
  registros       bigint,
  con_consulta    bigint,
  ultima_visita   timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.get_my_role() NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'Sólo la administración puede ver el resumen de referidos';
  END IF;

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
    v.ultima
  FROM public.profiles p
  JOIN public.professional_profiles pp ON pp.user_id = p.id
  LEFT JOIN (
    SELECT professional_id, count(*) AS visitas, max(created_at) AS ultima
    FROM public.professional_referral_visits
    GROUP BY professional_id
  ) v ON v.professional_id = p.id
  LEFT JOIN (
    SELECT
      pr.referred_by_professional_id AS professional_id,
      count(*) AS registros,
      count(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM public.consultations c WHERE c.patient_id = pr.id
      )) AS con_consulta
    FROM public.profiles pr
    WHERE pr.referred_by_professional_id IS NOT NULL
    GROUP BY pr.referred_by_professional_id
  ) r ON r.professional_id = p.id
  WHERE p.role = 'professional'
  ORDER BY coalesce(r.registros, 0) DESC, coalesce(v.visitas, 0) DESC, p.full_name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.resumen_de_referidos() TO authenticated;

-- ────────────────────────────────────────────────────────────
-- 7. Detalle de los pacientes que entraron por un link
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.referidos_de_profesional(p_professional_id uuid)
RETURNS TABLE (
  patient_id   uuid,
  full_name    text,
  email        text,
  created_at   timestamptz,
  consultas    bigint,
  primera_consulta timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.get_my_role() NOT IN ('admin', 'super_admin') AND auth.uid() <> p_professional_id THEN
    RAISE EXCEPTION 'Sin acceso a los referidos de ese profesional';
  END IF;

  RETURN QUERY
  SELECT
    pr.id,
    pr.full_name,
    pr.email,
    pr.created_at,
    (SELECT count(*) FROM public.consultations c WHERE c.patient_id = pr.id),
    (SELECT min(c.scheduled_at) FROM public.consultations c WHERE c.patient_id = pr.id)
  FROM public.profiles pr
  WHERE pr.referred_by_professional_id = p_professional_id
  ORDER BY pr.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.referidos_de_profesional(uuid) TO authenticated;
