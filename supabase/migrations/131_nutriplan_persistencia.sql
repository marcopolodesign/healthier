-- Migration 131: persistencia del NutriPlan.
-- Hoy nutriplanService.js sólo tiene cálculos puros (BMR/TDEE/macros) y la
-- búsqueda en FatSecret — el plan que arma el profesional y lo que el
-- paciente marca como consumido vive sólo en memoria del navegador y se
-- pierde al recargar. Esta migración le da persistencia real.

-- ── 1. nutrition_plans ──────────────────────────────────────────────────
-- Un plan por par (paciente, profesional): el profesional lo arma y lo va
-- actualizando; sólo puede haber UNO activo a la vez por par (el índice
-- único parcial de abajo), para no tener dos planes "vigentes" compitiendo
-- por la misma pantalla del paciente. Versionar/archivar un plan viejo es
-- pasarlo a status='archived' e insertar uno nuevo, no un update destructivo.
CREATE TABLE IF NOT EXISTS public.nutrition_plans (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id          uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  professional_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status              text NOT NULL DEFAULT 'active'
                        CHECK (status IN ('draft', 'active', 'archived')),

  -- Snapshot antropométrico al momento de calcular el plan (no se recalcula
  -- solo si el peso/edad del paciente cambian después en profiles).
  gender              text,
  age                 int,
  weight_kg           numeric,
  height_cm           numeric,
  activity_level      numeric,
  diet_type           text,

  -- Objetivos calculados por calculateNutrition() en nutriplanService.js.
  target_calories     int,
  target_protein_g    int,
  target_carbs_g      int,
  target_fat_g        int,
  target_fiber_g      int,
  bmr                 int,
  tdee                int,
  bmi                 numeric,

  -- Estructura del plan. Quedan como JSONB tal cual los arma la UI: meals es
  -- [{id,name,time}], foods es el array de alimentos con sus
  -- consumedQuantity/consumedCalories/etc., food_distribution es el mapa
  -- {foodId: [mealId,...]}. NUNCA pasar estos campos por toCamelCase/
  -- toSnakeCase (son recursivos) — destruyen las claves de food_distribution.
  meals               jsonb NOT NULL DEFAULT '[]'::jsonb,
  foods               jsonb NOT NULL DEFAULT '[]'::jsonb,
  food_distribution   jsonb NOT NULL DEFAULT '{}'::jsonb,

  notes               text,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Un solo plan activo por par (paciente, profesional).
CREATE UNIQUE INDEX IF NOT EXISTS nutrition_plans_activo_por_par
  ON public.nutrition_plans (patient_id, professional_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_nutrition_plans_patient_status
  ON public.nutrition_plans (patient_id, status);

CREATE INDEX IF NOT EXISTS idx_nutrition_plans_professional_updated
  ON public.nutrition_plans (professional_id, updated_at DESC);

-- Reusa public.set_updated_at(), ya definida en 001_initial_schema.sql y
-- usada por el resto de las tablas del repo.
DROP TRIGGER IF EXISTS nutrition_plans_set_updated_at ON public.nutrition_plans;
CREATE TRIGGER nutrition_plans_set_updated_at
  BEFORE UPDATE ON public.nutrition_plans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.nutrition_plans ENABLE ROW LEVEL SECURITY;

-- El profesional arma y edita sus propios planes.
DROP POLICY IF EXISTS "nutrition_plans_pro_all" ON public.nutrition_plans;
CREATE POLICY "nutrition_plans_pro_all"
  ON public.nutrition_plans FOR ALL
  TO authenticated
  USING (professional_id = auth.uid())
  WITH CHECK (professional_id = auth.uid());

-- El paciente sólo lee el suyo.
DROP POLICY IF EXISTS "nutrition_plans_paciente_read" ON public.nutrition_plans;
CREATE POLICY "nutrition_plans_paciente_read"
  ON public.nutrition_plans FOR SELECT
  USING (patient_id = auth.uid());

-- Super admin, vía get_my_role() (SECURITY DEFINER) — nunca una subquery a
-- profiles directo, rompe con recursión 42P17 (ver invariante en CLAUDE.md).
DROP POLICY IF EXISTS "nutrition_plans_super_admin_read" ON public.nutrition_plans;
CREATE POLICY "nutrition_plans_super_admin_read"
  ON public.nutrition_plans FOR SELECT
  USING (public.get_my_role() = 'super_admin');

-- ── 2. nutrition_plan_adherence ─────────────────────────────────────────
-- Una fila por alimento marcado/desmarcado en un día puntual. food_uid es
-- el `uid` que arma buildPatientMealsData() en nutriplanService.js
-- (`${food.id}-${mealId}`) — no el id del alimento solo, porque el mismo
-- alimento puede repartirse en más de una comida.
CREATE TABLE IF NOT EXISTS public.nutrition_plan_adherence (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id       uuid NOT NULL REFERENCES public.nutrition_plans(id) ON DELETE CASCADE,
  patient_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  date          date NOT NULL,
  meal_id       text NOT NULL,
  food_uid      text NOT NULL,
  consumed      boolean NOT NULL DEFAULT true,

  -- Foto de la porción al momento de marcarla. El plan activo se EDITA en el
  -- lugar (savePlan hace UPDATE), así que reconstruir las macros históricas
  -- traduciendo el food_uid contra el plan de hoy pierde en silencio todo lo
  -- que el paciente marcó antes de que el nutricionista cambiara los
  -- alimentos: la pestaña Monitoreo mostraba "no registró consumo" para días
  -- en los que sí había registrado. Guardar la foto acá hace que el historial
  -- no dependa de que el plan no cambie.
  food_name     text,
  meal_name     text,
  qty_g         numeric,
  calories      numeric,
  protein_g     numeric,
  carbs_g       numeric,
  fat_g         numeric,
  fiber_g       numeric,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  UNIQUE (plan_id, date, meal_id, food_uid)
);

-- Idempotente: si la tabla ya existía de una corrida anterior, las columnas
-- del snapshot entran por acá (el CREATE TABLE IF NOT EXISTS no las agrega).
ALTER TABLE public.nutrition_plan_adherence
  ADD COLUMN IF NOT EXISTS food_name text,
  ADD COLUMN IF NOT EXISTS meal_name text,
  ADD COLUMN IF NOT EXISTS qty_g     numeric,
  ADD COLUMN IF NOT EXISTS calories  numeric,
  ADD COLUMN IF NOT EXISTS protein_g numeric,
  ADD COLUMN IF NOT EXISTS carbs_g   numeric,
  ADD COLUMN IF NOT EXISTS fat_g     numeric,
  ADD COLUMN IF NOT EXISTS fiber_g   numeric;

CREATE INDEX IF NOT EXISTS idx_nutrition_plan_adherence_plan_date
  ON public.nutrition_plan_adherence (plan_id, date);

DROP TRIGGER IF EXISTS nutrition_plan_adherence_set_updated_at ON public.nutrition_plan_adherence;
CREATE TRIGGER nutrition_plan_adherence_set_updated_at
  BEFORE UPDATE ON public.nutrition_plan_adherence
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.nutrition_plan_adherence ENABLE ROW LEVEL SECURITY;

-- El paciente marca/desmarca lo suyo. Además de ser dueño de la fila, el
-- plan referenciado tiene que ser SUYO: sin ese EXISTS, alguien armando el
-- request a mano podía escribir adherencia contra el plan de otro paciente
-- (la fila pasaba el chequeo con sólo poner su propio patient_id).
DROP POLICY IF EXISTS "nutrition_plan_adherence_paciente_all" ON public.nutrition_plan_adherence;
CREATE POLICY "nutrition_plan_adherence_paciente_all"
  ON public.nutrition_plan_adherence FOR ALL
  USING (
    patient_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.nutrition_plans p
      WHERE p.id = plan_id AND p.patient_id = auth.uid()
    )
  )
  WITH CHECK (
    patient_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.nutrition_plans p
      WHERE p.id = plan_id AND p.patient_id = auth.uid()
    )
  );

-- El profesional lee la adherencia de los planes que armó (pestaña
-- Monitoreo), nunca la de un plan ajeno.
DROP POLICY IF EXISTS "nutrition_plan_adherence_pro_read" ON public.nutrition_plan_adherence;
CREATE POLICY "nutrition_plan_adherence_pro_read"
  ON public.nutrition_plan_adherence FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.nutrition_plans p
      WHERE p.id = plan_id AND p.professional_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "nutrition_plan_adherence_super_admin_read" ON public.nutrition_plan_adherence;
CREATE POLICY "nutrition_plan_adherence_super_admin_read"
  ON public.nutrition_plan_adherence FOR SELECT
  USING (public.get_my_role() = 'super_admin');
