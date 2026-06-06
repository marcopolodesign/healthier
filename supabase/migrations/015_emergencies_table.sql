-- ============================================================
-- Emergencies table — links patient SOS events to real professionals
-- ============================================================

CREATE TABLE IF NOT EXISTS public.emergencies (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id      uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  professional_id uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  triage_code     text        NOT NULL CHECK (triage_code IN ('ROJO', 'AMARILLO', 'VERDE')),
  status          text        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'dispatched', 'in_transit', 'arrived', 'cancelled')),
  dispatch_code   text,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ── Indexes ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_emergencies_patient_id      ON public.emergencies(patient_id);
CREATE INDEX IF NOT EXISTS idx_emergencies_professional_id ON public.emergencies(professional_id);
CREATE INDEX IF NOT EXISTS idx_emergencies_status          ON public.emergencies(status, created_at DESC);

-- ── RLS ───────────────────────────────────────────────────────
ALTER TABLE public.emergencies ENABLE ROW LEVEL SECURITY;

-- Patients: insert + read own emergencies
CREATE POLICY "emergency_patient_insert" ON public.emergencies
  FOR INSERT TO authenticated
  WITH CHECK (patient_id = auth.uid());

CREATE POLICY "emergency_patient_select" ON public.emergencies
  FOR SELECT TO authenticated
  USING (patient_id = auth.uid());

-- Patients can cancel their own emergency
CREATE POLICY "emergency_patient_cancel" ON public.emergencies
  FOR UPDATE TO authenticated
  USING  (patient_id = auth.uid() AND status NOT IN ('arrived', 'cancelled'))
  WITH CHECK (patient_id = auth.uid());

-- Professionals: read emergencies assigned to them
CREATE POLICY "emergency_professional_select" ON public.emergencies
  FOR SELECT TO authenticated
  USING (professional_id = auth.uid());

-- ── updated_at trigger ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER emergencies_updated_at
  BEFORE UPDATE ON public.emergencies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
