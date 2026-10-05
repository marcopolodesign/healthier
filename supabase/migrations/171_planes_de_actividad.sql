-- Migration 171: planes de actividad — Salud Mental, Rehabilitación y Preparador Físico.
-- Mismo patrón que NutriPlan (migración 131), genérico para las tres verticales
-- que hoy no le muestran al paciente nada de lo que le indicó su profesional:
-- psicología carga una rutina/actividad, kinesiología un plan de rehabilitación,
-- entrenamiento un plan de preparador físico. A diferencia de NutriPlan no hay
-- cálculo de macros ni tracking de adherencia día a día — es texto estructurado
-- (título + indicaciones + una lista de items), así que una sola tabla alcanza.

-- ── activity_plans ───────────────────────────────────────────────────────────
-- A diferencia de nutrition_plans (un plan "activo" por par paciente/profesional,
-- se pisa en el lugar), acá puede haber VARIOS planes vigentes a la vez para el
-- mismo paciente — uno por tipo (mente/rehabilitacion/preparador), porque un
-- paciente puede tener psicólogo Y kinesiólogo a la vez y cada uno arma el suyo.
-- El índice único de abajo es por (patient_id, professional_id, tipo): ese
-- profesional puede tener un solo plan vigente de ese tipo con ese paciente;
-- versionar uno viejo es pasarlo a vigente=false e insertar uno nuevo.
CREATE TABLE IF NOT EXISTS public.activity_plans (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id        uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  professional_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  consultation_id   uuid REFERENCES public.consultations(id) ON DELETE SET NULL,

  tipo              text NOT NULL CHECK (tipo IN ('mente', 'rehabilitacion', 'preparador')),

  titulo            text,
  indicaciones      text,
  -- [{nombre, detalle, frecuencia}, ...] — texto estructurado, no un plan
  -- calculado como NutriPlan. Queda en JSONB tal cual lo arma la UI.
  items             jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- El plan que el paciente ve como "el de ahora" en la Bóveda. Al cargar uno
  -- nuevo del mismo tipo, el anterior pasa a vigente=false (nunca se borra —
  -- el paciente lo puede seguir viendo en "Planes anteriores").
  vigente           boolean NOT NULL DEFAULT true,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.activity_plans IS
  'Plan de actividad/rutina que un profesional (psicología, kinesiología, entrenamiento) le indica a un paciente. Lo ve en la Bóveda, en la tarjeta de su vertical. Ver migración 131 (nutrition_plans) para el mismo patrón aplicado a nutrición.';

-- Un solo plan vigente por (paciente, profesional, tipo).
CREATE UNIQUE INDEX IF NOT EXISTS activity_plans_vigente_por_par
  ON public.activity_plans (patient_id, professional_id, tipo)
  WHERE vigente = true;

CREATE INDEX IF NOT EXISTS idx_activity_plans_patient_tipo
  ON public.activity_plans (patient_id, tipo, vigente);

CREATE INDEX IF NOT EXISTS idx_activity_plans_professional_updated
  ON public.activity_plans (professional_id, updated_at DESC);

-- Reusa public.set_updated_at(), ya definida en 001_initial_schema.sql.
DROP TRIGGER IF EXISTS activity_plans_set_updated_at ON public.activity_plans;
CREATE TRIGGER activity_plans_set_updated_at
  BEFORE UPDATE ON public.activity_plans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.activity_plans ENABLE ROW LEVEL SECURITY;

-- El profesional arma y edita los planes que él mismo creó.
DROP POLICY IF EXISTS "activity_plans_pro_all" ON public.activity_plans;
CREATE POLICY "activity_plans_pro_all"
  ON public.activity_plans FOR ALL
  TO authenticated
  USING (professional_id = auth.uid())
  WITH CHECK (professional_id = auth.uid());

-- Cualquier profesional con una consulta compartida con el paciente puede LEER
-- sus planes (nunca editar uno ajeno) — mismo criterio que
-- has_shared_consultation() ya usa en "profiles_read_consultation_parties"
-- (migración 005), para que el panel de la consulta pueda mostrar planes de
-- otras verticales del mismo paciente sin abrir una policy más ancha.
DROP POLICY IF EXISTS "activity_plans_pro_read_shared" ON public.activity_plans;
CREATE POLICY "activity_plans_pro_read_shared"
  ON public.activity_plans FOR SELECT
  TO authenticated
  USING (public.has_shared_consultation(patient_id));

-- El paciente sólo lee los suyos. Nunca una policy sobre `profiles` que
-- consulte `profiles` (ver invariante de get_my_role() en CLAUDE.md) — acá no
-- hace falta: patient_id = auth.uid() alcanza, sin tocar profiles.
DROP POLICY IF EXISTS "activity_plans_paciente_read" ON public.activity_plans;
CREATE POLICY "activity_plans_paciente_read"
  ON public.activity_plans FOR SELECT
  USING (patient_id = auth.uid());

-- Super admin, vía get_my_role() (SECURITY DEFINER) — nunca una subquery a
-- profiles directo, rompe con recursión 42P17.
DROP POLICY IF EXISTS "activity_plans_super_admin_read" ON public.activity_plans;
CREATE POLICY "activity_plans_super_admin_read"
  ON public.activity_plans FOR SELECT
  USING (public.get_my_role() = 'super_admin');
