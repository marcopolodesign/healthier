-- ============================================================
-- Migración 175 — Cancelar una emergencia con la ambulancia ya asignada se cobra
-- ============================================================
-- Regla de Mateo (2026-09-25): "Cuando la ambulancia está asignada se puede
-- cancelar pero se va a cobrar igual, esto hay que avisarlo. Tanto en app como
-- en web, siempre."
--
-- Hasta hoy el paciente cancelaba con un UPDATE directo (`status='cancelled'`,
-- policy `emergency_patient_cancel`) y después liberaba la reserva con
-- `mp-capture` action=cancel-auth-emergency — también con el móvil en camino.
-- La decisión de cobrar o no ahora la toma el servidor, en `mp-capture`
-- action=cancel-emergency, leyendo el estado de la base en el momento de
-- decidir.
--
-- Esta migración hace tres cosas:
--   1. El paciente ya NO puede cancelar por UPDATE directo una emergencia con
--      móvil asignado (dispatched / in_transit). Sólo puede tocar su fila
--      mientras está en `pending` o `awaiting_dispatch` — que es todo lo que
--      necesita: el triage (pending → awaiting_dispatch) y cancelar sin cargo.
--   2. `cancelled` es final. Un operador que asigna un móvil a una emergencia
--      que el paciente acaba de cancelar ya no la "revive" en `dispatched`
--      (antes pasaba: `asignarAmbulancia` no filtraba por estado).
--   3. Queda registrado si la cancelación se cobró, para que el super admin
--      distinga una de otra.
-- ============================================================

ALTER TABLE public.emergencies
  ADD COLUMN IF NOT EXISTS cancelled_at         timestamptz,
  -- NULL mientras no está cancelada. true = se canceló con el móvil asignado y
  -- se capturó la reserva; false = se canceló antes y se liberó.
  ADD COLUMN IF NOT EXISTS cancellation_charged boolean;

COMMENT ON COLUMN public.emergencies.cancellation_charged IS
  'Sólo con status=cancelled: true si se canceló con ambulancia asignada y se cobró el servicio (mp-capture cancel-emergency).';

-- ── 1. El paciente sólo toca su fila antes de que haya móvil ──────────────
DROP POLICY IF EXISTS "emergency_patient_cancel" ON public.emergencies;
CREATE POLICY "emergency_patient_cancel" ON public.emergencies
  FOR UPDATE TO authenticated
  USING (
    patient_id = auth.uid()
    AND status IN ('pending', 'awaiting_dispatch')
  )
  WITH CHECK (
    patient_id = auth.uid()
    AND status IN ('pending', 'awaiting_dispatch', 'cancelled')
    -- Sin cargo por esta vía: la cancelación cobrada la escribe sólo el
    -- servidor, después de capturar.
    AND cancellation_charged IS NOT TRUE
  );

-- ── 2. `cancelled` es final + marca de cuándo ─────────────────────────────
CREATE OR REPLACE FUNCTION public.emergencia_cancelada_es_final()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'cancelled' AND NEW.status IS DISTINCT FROM 'cancelled' THEN
    RAISE EXCEPTION 'La emergencia ya está cancelada'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    NEW.cancelled_at := COALESCE(NEW.cancelled_at, now());
    NEW.cancellation_charged := COALESCE(NEW.cancellation_charged, false);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS emergencies_cancelada_es_final ON public.emergencies;
CREATE TRIGGER emergencies_cancelada_es_final
  BEFORE UPDATE OF status ON public.emergencies
  FOR EACH ROW EXECUTE FUNCTION public.emergencia_cancelada_es_final();
