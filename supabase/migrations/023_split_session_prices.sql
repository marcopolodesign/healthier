-- Split session_price into modality-specific prices
ALTER TABLE public.professional_profiles
  ADD COLUMN IF NOT EXISTS price_presencial numeric(10,2),
  ADD COLUMN IF NOT EXISTS price_video      numeric(10,2);

-- Backfill both from the existing session_price
UPDATE public.professional_profiles
SET
  price_presencial = session_price,
  price_video      = session_price
WHERE session_price IS NOT NULL
  AND price_presencial IS NULL;

COMMENT ON COLUMN public.professional_profiles.price_presencial IS 'Price per in-person session, in ARS';
COMMENT ON COLUMN public.professional_profiles.price_video      IS 'Price per video session, in ARS';
