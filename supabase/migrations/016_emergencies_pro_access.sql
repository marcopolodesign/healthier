-- ============================================================
-- Emergencies — professional access + patient location
-- ============================================================

-- ── Patient location for professional navigation ──────────────
ALTER TABLE public.emergencies
  ADD COLUMN IF NOT EXISTS patient_latitude  numeric(9,6),
  ADD COLUMN IF NOT EXISTS patient_longitude numeric(9,6);

-- ── Professional can update status on assigned emergencies ────
CREATE POLICY "emergency_professional_update" ON public.emergencies
  FOR UPDATE TO authenticated
  USING  (professional_id = auth.uid())
  WITH CHECK (professional_id = auth.uid());

-- ── Professional can read patient profile for active emergency ─
-- Allows joining patient name/avatar when rendering the emergency.
-- Does NOT call profiles recursively — queries emergencies only.
CREATE POLICY "pro_read_emergency_patient_profile" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.emergencies e
      WHERE e.patient_id = profiles.id
        AND e.professional_id = auth.uid()
        AND e.status NOT IN ('cancelled', 'completed')
    )
  );
