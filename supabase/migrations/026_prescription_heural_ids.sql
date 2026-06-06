-- Add prescription_heural_ids array to consultations
-- Stores Heural MedicationRequest IDs (TEXT HashID hex strings) for each prescription
-- created during the encounter, so we can display history and re-send without re-querying.

ALTER TABLE consultations
  ADD COLUMN IF NOT EXISTS prescription_heural_ids TEXT[] DEFAULT '{}';
