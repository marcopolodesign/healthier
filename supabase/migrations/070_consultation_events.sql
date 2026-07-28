-- ============================================================
-- Migration 070 — bitácora de eventos por consulta
-- ============================================================
-- Pedido de Mateo (2026-07-28), después de una videollamada de prueba que
-- terminó en `no_show` sin que nadie pudiera decir por qué: "estaría bueno
-- loggear todos estos eventos en la db para que puedas leer con exactitud lo
-- que va pasando".
--
-- Hoy la consulta solo guarda su ESTADO FINAL. `no_show` no dice si el paciente
-- nunca llegó, si el profesional no se conectó, si el video fallo, ni en qué
-- orden pasó cada cosa. Diagnosticar una prueba fallida es imposible: hay que
-- reconstruirla de memoria. Esto guarda la línea de tiempo.
--
-- Dos fuentes que se complementan a propósito:
--
--  1. El cliente escribe eventos ricos (entró a la sala, se unió al Daily, el
--     otro participante apareció, colgó). Es lo que da el detalle, pero se
--     pierde si la pestaña muere.
--  2. Un trigger sobre `consultations` registra TODO cambio de estado, pase lo
--     que pase del lado del cliente. Es el piso: aunque no llegue ni un evento
--     de cliente, la secuencia de estados queda.
--
-- `detail` es jsonb libre a propósito: cada evento necesita cosas distintas y no
-- queremos una migración por cada dato nuevo que haga falta mirar.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.consultation_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id uuid NOT NULL REFERENCES public.consultations(id) ON DELETE CASCADE,
  -- Quién lo provocó. NULL = el sistema (trigger, cron, webhook).
  actor_id        uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_role      text,
  -- Slug estable y legible. Sin enum: agregar un evento no debería requerir
  -- una migración, y un valor desconocido es preferible a perder el evento.
  event           text NOT NULL,
  detail          jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.consultation_events IS
  'Línea de tiempo por consulta: quién hizo qué y cuándo. Escrita por el cliente (detalle) y por un trigger de cambio de estado (piso garantizado).';

-- La lectura real siempre es "dame todo lo de ESTA consulta, en orden".
CREATE INDEX IF NOT EXISTS consultation_events_by_consultation_idx
  ON public.consultation_events (consultation_id, created_at);

-- Para el super admin: "qué pasó en la plataforma en la última hora".
CREATE INDEX IF NOT EXISTS consultation_events_recent_idx
  ON public.consultation_events (created_at DESC);

ALTER TABLE public.consultation_events ENABLE ROW LEVEL SECURITY;

-- Lectura: las dos partes de la consulta, y el super admin todo.
-- get_my_role() es SECURITY DEFINER (ver la invariante de RLS en CLAUDE.md):
-- consultar `profiles` directo desde una policy provoca recursión infinita.
CREATE POLICY "read_own_consultation_events" ON public.consultation_events
  FOR SELECT USING (
    get_my_role() IN ('super_admin', 'admin')
    OR EXISTS (
      SELECT 1 FROM public.consultations c
       WHERE c.id = consultation_events.consultation_id
         AND (c.patient_id = auth.uid() OR c.professional_id = auth.uid())
    )
  );

-- Escritura: solo sobre consultas propias, y solo en nombre de uno mismo.
-- Sin esto, cualquier usuario autenticado podría ensuciar la bitácora ajena.
CREATE POLICY "write_own_consultation_events" ON public.consultation_events
  FOR INSERT WITH CHECK (
    (actor_id IS NULL OR actor_id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.consultations c
       WHERE c.id = consultation_events.consultation_id
         AND (c.patient_id = auth.uid() OR c.professional_id = auth.uid())
    )
  );

-- La bitácora no se edita ni se borra: sin policies de UPDATE/DELETE, RLS las
-- niega por defecto. Un log que se puede reescribir no sirve para diagnosticar.

-- ── Piso garantizado: todo cambio de estado queda registrado ────────────────
CREATE OR REPLACE FUNCTION public.log_consultation_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO consultation_events (consultation_id, actor_id, actor_role, event, detail)
    VALUES (
      NEW.id,
      auth.uid(),
      CASE
        WHEN auth.uid() IS NULL              THEN 'system'
        WHEN auth.uid() = NEW.patient_id     THEN 'patient'
        WHEN auth.uid() = NEW.professional_id THEN 'professional'
        ELSE 'other'
      END,
      'status_changed',
      jsonb_build_object('from', OLD.status, 'to', NEW.status)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS consultations_log_status ON public.consultations;
CREATE TRIGGER consultations_log_status
  AFTER UPDATE OF status ON public.consultations
  FOR EACH ROW EXECUTE FUNCTION public.log_consultation_status_change();

COMMENT ON FUNCTION public.log_consultation_status_change() IS
  'Registra cada transición de estado en consultation_events. SECURITY DEFINER para poder escribir la bitácora aunque el actor solo tenga permiso de update sobre la consulta.';
