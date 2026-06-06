-- ── consultation_types — professional-defined repeatable types ──────────────
CREATE TABLE IF NOT EXISTS public.consultation_types (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name            text NOT NULL,
  price           numeric(10,2),
  modality        text CHECK (modality IN ('video', 'presencial')),
  is_active       boolean NOT NULL DEFAULT true,
  sort_order      integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.consultation_types ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read all types (patients need this when booking)
CREATE POLICY "authenticated_read_consultation_types"
  ON public.consultation_types FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "professional_insert_consultation_types"
  ON public.consultation_types FOR INSERT
  WITH CHECK (professional_id = auth.uid());

CREATE POLICY "professional_update_consultation_types"
  ON public.consultation_types FOR UPDATE
  USING (professional_id = auth.uid());

CREATE POLICY "professional_delete_consultation_types"
  ON public.consultation_types FOR DELETE
  USING (professional_id = auth.uid());

-- ── consultations — new columns ───────────────────────────────────────────────
ALTER TABLE public.consultations
  ADD COLUMN IF NOT EXISTS consultation_type_id uuid
    REFERENCES public.consultation_types(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS obra_social_name  text,
  ADD COLUMN IF NOT EXISTS affiliate_number  text;

COMMENT ON COLUMN public.consultations.obra_social_name IS 'Obra social / health insurance name for this consultation';
COMMENT ON COLUMN public.consultations.affiliate_number IS 'Patient affiliate number with the obra social';
COMMENT ON COLUMN public.consultations.consultation_type_id IS 'Optional reference to professional-defined consultation type';
