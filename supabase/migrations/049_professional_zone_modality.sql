-- Zone coverage + modality preference for professional onboarding/config
-- Requested by Nacho Arteaga (2026-07-08): let professionals declare their
-- zone of attention and whether they take virtual-only or virtual+presencial.
ALTER TABLE public.professional_profiles
  ADD COLUMN IF NOT EXISTS zone_id uuid REFERENCES public.zones(id),
  ADD COLUMN IF NOT EXISTS modality_preference text
    CHECK (modality_preference IN ('virtual', 'presencial', 'ambas'))
    DEFAULT 'ambas';

COMMENT ON COLUMN public.professional_profiles.zone_id IS 'Barrio de atención presencial (FK a zones) — null si modality_preference = virtual';
COMMENT ON COLUMN public.professional_profiles.modality_preference IS 'virtual | presencial | ambas — controla si el profesional aparece en búsquedas presenciales de su zona';
