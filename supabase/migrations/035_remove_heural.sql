-- Remove Heural EHR integration columns (Heural integration discontinued)
-- Data in these columns is not migrated — Heural IDs are no longer valid.

ALTER TABLE profiles
  DROP COLUMN IF EXISTS heural_id,
  DROP COLUMN IF EXISTS heural_sync;

DROP INDEX IF EXISTS idx_profiles_heural_id;

ALTER TABLE consultations
  DROP COLUMN IF EXISTS heural_encounter_id,
  DROP COLUMN IF EXISTS heural_appointment_id,
  DROP COLUMN IF EXISTS prescription_heural_ids;

DROP INDEX IF EXISTS idx_consultations_heural_encounter;
