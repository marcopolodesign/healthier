-- ============================================================
-- Migration 112 — bitácora del onboarding del profesional
-- ============================================================
-- Pedido de Mateo (2026-08-13): "quiero ver el funnel de los profesionales que
-- se terminan poniendo como para verificar (o todos). Entender en dónde se
-- quedaron, dónde retomaron y cuándo. Como si fuese un timeline más que un
-- funnel."
--
-- Lo que había no alcanza: `profiles.onboarding_step` (migración 108) guarda UN
-- solo número que se pisa en cada avance. Dice hasta dónde llegó, nunca cuándo
-- ni cuántas veces volvió. "Se frenó el 10 y retomó el 12" es exactamente lo
-- que ese diseño no puede contestar.
--
-- Mismo esquema de dos fuentes que la bitácora de consultas (migración 070),
-- por la misma razón:
--
--  1. Triggers sobre `profiles` y `professional_profiles` — piso garantizado.
--     Registran el alta, cada cambio de paso y cada hito del legajo (enviado,
--     reenviado, verificado, rechazado) pase lo que pase del lado del cliente.
--  2. El cliente escribe lo que la base no puede ver sola: que abrió el wizard.
--     Sin ese evento, alguien que entra, mira y se va sin tocar "Siguiente" es
--     indistinguible de alguien que no volvió nunca — y esa diferencia es
--     justamente "dónde retomó".
--
-- `detail` es jsonb libre a propósito: agregar un dato nuevo al recorrido no
-- debería costar una migración.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.professional_onboarding_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Slug estable y legible. Sin enum: un valor desconocido se muestra crudo,
  -- que es preferible a perder el evento o a migrar por cada slug nuevo.
  --   signup       — creó la cuenta como profesional
  --   wizard_opened— abrió el formulario de alta (lo escribe el cliente)
  --   step_reached — avanzó a un paso del wizard
  --   submitted    — envió el legajo a revisión
  --   resubmitted  — volvió a enviarlo después de una devolución
  --   verified     — el admin lo aprobó
  --   rejected     — el admin lo rechazó (detail.type: revision | permanente)
  event      text NOT NULL,
  -- Paso del wizard cuando aplica (0-indexado, igual que Onboarding.jsx).
  step       smallint,
  detail     jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.professional_onboarding_events IS
  'Línea de tiempo del alta de cada profesional: qué hizo, en qué paso y cuándo. Escrita por triggers (piso garantizado) y por el cliente (apertura del wizard). Append-only: sin policies de UPDATE/DELETE.';

-- La lectura real siempre es "dame todo lo de ESTE profesional, en orden".
CREATE INDEX IF NOT EXISTS professional_onboarding_events_by_user_idx
  ON public.professional_onboarding_events (user_id, created_at);

-- Para el super admin: "qué pasó en las altas esta semana".
CREATE INDEX IF NOT EXISTS professional_onboarding_events_recent_idx
  ON public.professional_onboarding_events (created_at DESC);

-- Hace idempotente el backfill de más abajo y protege contra un doble disparo
-- del mismo hito (dos triggers, un reintento del cliente).
CREATE UNIQUE INDEX IF NOT EXISTS professional_onboarding_events_dedupe_idx
  ON public.professional_onboarding_events (user_id, event, created_at);

ALTER TABLE public.professional_onboarding_events ENABLE ROW LEVEL SECURITY;

-- Lectura: el propio profesional y la administración.
-- get_my_role() es SECURITY DEFINER (ver la invariante de RLS en CLAUDE.md):
-- consultar `profiles` directo desde una policy provoca recursión infinita.
DROP POLICY IF EXISTS "read_own_onboarding_events" ON public.professional_onboarding_events;
CREATE POLICY "read_own_onboarding_events" ON public.professional_onboarding_events
  FOR SELECT USING (
    get_my_role() IN ('super_admin', 'admin')
    OR user_id = auth.uid()
  );

-- Escritura desde el cliente: sólo sobre uno mismo. Sin esto cualquier usuario
-- autenticado podría inventar el recorrido de otro.
DROP POLICY IF EXISTS "write_own_onboarding_events" ON public.professional_onboarding_events;
CREATE POLICY "write_own_onboarding_events" ON public.professional_onboarding_events
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- Sin policies de UPDATE/DELETE: RLS las niega por defecto. Una bitácora que se
-- puede reescribir no sirve para reconstruir qué pasó.


-- ── El paso guardado deja de retroceder ────────────────────────────────────
-- `Onboarding.jsx` llama a trackStep(initialStep) al montar, y initialStep es 0
-- salvo deep-link. Consecuencia: quien llegaba al paso 3, se iba y volvía,
-- quedaba registrado en 0 — el funnel de super-admin lo contaba como frenado en
-- "Especialidad" cuando en realidad había llegado mucho más lejos.
--
-- La columna pasa a significar "hasta dónde llegó" (máximo alcanzado), que es lo
-- que el panel ya dice que muestra ("Llegó hasta X"). El ida y vuelta real no se
-- pierde: queda en la bitácora, con fecha.
CREATE OR REPLACE FUNCTION public.mantener_onboarding_step_monotono()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.onboarding_step IS NOT NULL AND OLD.onboarding_step IS NOT NULL
     AND NEW.onboarding_step < OLD.onboarding_step THEN
    NEW.onboarding_step := OLD.onboarding_step;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.mantener_onboarding_step_monotono() IS
  'profiles.onboarding_step nunca baja: guarda el paso más lejano alcanzado. El detalle de reaperturas y retrocesos vive en professional_onboarding_events.';

DROP TRIGGER IF EXISTS profiles_onboarding_step_monotono ON public.profiles;
CREATE TRIGGER profiles_onboarding_step_monotono
  BEFORE UPDATE OF onboarding_step ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.mantener_onboarding_step_monotono();


-- ── Alta de la cuenta ──────────────────────────────────────────────────────
-- El rol puede llegar en el INSERT (alta por email) o después (alta con Google,
-- donde el rol se elige en CompleteProfile). Se cubren los dos casos y se
-- registra una sola vez por persona.
CREATE OR REPLACE FUNCTION public.log_alta_de_profesional()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role <> 'professional' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.role = 'professional' THEN
    RETURN NEW;
  END IF;

  INSERT INTO professional_onboarding_events (user_id, event, created_at, detail)
  VALUES (
    NEW.id,
    'signup',
    NEW.created_at,
    jsonb_build_object('utm_source', NEW.utm_source, 'utm_campaign', NEW.utm_campaign)
  )
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_log_alta_profesional_insert ON public.profiles;
CREATE TRIGGER profiles_log_alta_profesional_insert
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.log_alta_de_profesional();

DROP TRIGGER IF EXISTS profiles_log_alta_profesional_update ON public.profiles;
CREATE TRIGGER profiles_log_alta_profesional_update
  AFTER UPDATE OF role ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.log_alta_de_profesional();


-- ── Cada avance del wizard ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.log_paso_de_onboarding()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- El trigger BEFORE de más arriba ya revirtió los retrocesos, así que acá
  -- sólo quedan avances reales.
  IF NEW.onboarding_step IS DISTINCT FROM OLD.onboarding_step THEN
    INSERT INTO professional_onboarding_events (user_id, event, step, detail)
    VALUES (
      NEW.id,
      'step_reached',
      NEW.onboarding_step,
      jsonb_build_object('from', OLD.onboarding_step)
    )
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_log_paso_onboarding ON public.profiles;
CREATE TRIGGER profiles_log_paso_onboarding
  AFTER UPDATE OF onboarding_step ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.log_paso_de_onboarding();


-- ── Hitos del legajo ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.log_hitos_del_legajo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO professional_onboarding_events (user_id, event, created_at)
    VALUES (NEW.user_id, 'submitted', COALESCE(NEW.submitted_at, now()))
    ON CONFLICT DO NOTHING;
    RETURN NEW;
  END IF;

  -- Reenvío tras una devolución: el legajo ya existía y vuelve a enviarse.
  IF NEW.submitted_at IS DISTINCT FROM OLD.submitted_at AND NEW.submitted_at IS NOT NULL THEN
    INSERT INTO professional_onboarding_events (user_id, event, created_at)
    VALUES (NEW.user_id, 'resubmitted', NEW.submitted_at)
    ON CONFLICT DO NOTHING;
  END IF;

  IF NEW.is_verified AND NOT COALESCE(OLD.is_verified, false) THEN
    INSERT INTO professional_onboarding_events (user_id, event, created_at, detail)
    VALUES (
      NEW.user_id,
      'verified',
      COALESCE(NEW.verified_at, now()),
      jsonb_build_object('source', NEW.verification_source)
    )
    ON CONFLICT DO NOTHING;
  END IF;

  IF NEW.rejected_at IS DISTINCT FROM OLD.rejected_at AND NEW.rejected_at IS NOT NULL THEN
    INSERT INTO professional_onboarding_events (user_id, event, created_at, detail)
    VALUES (
      NEW.user_id,
      'rejected',
      NEW.rejected_at,
      jsonb_build_object('type', NEW.rejection_type, 'reason', NEW.rejection_reason)
    )
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS professional_profiles_log_hitos ON public.professional_profiles;
CREATE TRIGGER professional_profiles_log_hitos
  AFTER INSERT OR UPDATE ON public.professional_profiles
  FOR EACH ROW EXECUTE FUNCTION public.log_hitos_del_legajo();


-- ── Backfill de lo que ya tiene fecha real ─────────────────────────────────
-- Sólo hitos con timestamp propio en la base. El paso del wizard NO se
-- backfillea: `onboarding_step` no guarda cuándo se alcanzó, y una fecha
-- inventada (updated_at, por ejemplo) haría que el recorrido mienta. Los
-- profesionales anteriores a esta migración muestran el alta y los hitos del
-- legajo; el detalle paso a paso arranca desde acá.
INSERT INTO public.professional_onboarding_events (user_id, event, created_at, detail)
SELECT p.id, 'signup', p.created_at,
       jsonb_build_object('utm_source', p.utm_source, 'utm_campaign', p.utm_campaign)
  FROM public.profiles p
 WHERE p.role = 'professional'
ON CONFLICT DO NOTHING;

INSERT INTO public.professional_onboarding_events (user_id, event, created_at)
SELECT pp.user_id, 'submitted', pp.submitted_at
  FROM public.professional_profiles pp
 WHERE pp.submitted_at IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO public.professional_onboarding_events (user_id, event, created_at, detail)
SELECT pp.user_id, 'verified', pp.verified_at,
       jsonb_build_object('source', pp.verification_source)
  FROM public.professional_profiles pp
 WHERE pp.is_verified AND pp.verified_at IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO public.professional_onboarding_events (user_id, event, created_at, detail)
SELECT pp.user_id, 'rejected', pp.rejected_at,
       jsonb_build_object('type', pp.rejection_type, 'reason', pp.rejection_reason)
  FROM public.professional_profiles pp
 WHERE pp.rejected_at IS NOT NULL
ON CONFLICT DO NOTHING;
