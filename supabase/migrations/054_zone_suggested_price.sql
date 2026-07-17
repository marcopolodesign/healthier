-- Per-zone suggested price range, configurable by super_admin (Zonas panel).
-- Onboarding step "Tarifas" shows this range once a professional picks their
-- zone, instead of one hardcoded value for the whole city. Falls back to a
-- global default in the app when a zone has no values set yet.
ALTER TABLE public.zones
  ADD COLUMN IF NOT EXISTS suggested_price_min         integer,
  ADD COLUMN IF NOT EXISTS suggested_price_max         integer,
  ADD COLUMN IF NOT EXISTS suggested_price_recommended integer;

COMMENT ON COLUMN public.zones.suggested_price_min IS 'Precio sugerido mínimo (ARS) para profesionales de esta zona — editable en super-admin/Zonas';
COMMENT ON COLUMN public.zones.suggested_price_max IS 'Precio sugerido máximo (ARS) para profesionales de esta zona — editable en super-admin/Zonas';
COMMENT ON COLUMN public.zones.suggested_price_recommended IS 'Precio sugerido recomendado (ARS) para profesionales de esta zona — editable en super-admin/Zonas';
