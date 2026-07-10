-- Professional follow-up tab: schedule a follow-up ("volvemos en 15 días") and/or
-- cross-recommend another platform professional for a patient.
-- Requested by Nacho Arteaga (2026-07-08).
CREATE TABLE IF NOT EXISTS public.patient_followups (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id           uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  patient_id                uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  follow_up_date            date,
  note                      text,
  recommended_professional_id uuid REFERENCES public.profiles(id),
  created_at                timestamptz NOT NULL DEFAULT now(),
  CHECK (follow_up_date IS NOT NULL OR recommended_professional_id IS NOT NULL)
);

ALTER TABLE public.patient_followups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "followups_professional_all" ON public.patient_followups
  FOR ALL USING (professional_id = auth.uid())
  WITH CHECK (professional_id = auth.uid());

COMMENT ON TABLE public.patient_followups IS 'Professional dashboard follow-up tab — schedule a follow-up date and/or recommend another platform professional for a patient.';
