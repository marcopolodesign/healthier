-- Migration 028: Add pet columns to consultations for veterinary bookings
-- pet_name and pet_species are only set when vertical = 'veterinaria'

ALTER TABLE consultations
  ADD COLUMN IF NOT EXISTS pet_name    TEXT,
  ADD COLUMN IF NOT EXISTS pet_species TEXT;

COMMENT ON COLUMN consultations.pet_name    IS 'Name of the pet — populated for veterinaria vertical only';
COMMENT ON COLUMN consultations.pet_species IS 'Species of the pet (Perro, Gato, etc.) — populated for veterinaria vertical only';
