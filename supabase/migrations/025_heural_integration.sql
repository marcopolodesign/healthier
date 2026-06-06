-- Heural EHR integration columns
-- heural_id: the HashID returned by Heural's API for this user/entity
-- heural_sync: 'pending' | 'synced' | 'failed'

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS heural_id    TEXT,
  ADD COLUMN IF NOT EXISTS heural_sync  TEXT DEFAULT 'pending';

-- Index for fast lookup by heural_id (used when Heural webhooks reference their internal ID)
CREATE INDEX IF NOT EXISTS idx_profiles_heural_id ON profiles(heural_id);

-- consultations: store the Heural encounter and appointment IDs
ALTER TABLE consultations
  ADD COLUMN IF NOT EXISTS heural_encounter_id    TEXT,
  ADD COLUMN IF NOT EXISTS heural_appointment_id  TEXT;

CREATE INDEX IF NOT EXISTS idx_consultations_heural_encounter ON consultations(heural_encounter_id);
