-- Tracks how far a professional got into the onboarding wizard
-- (Onboarding.jsx STEPS array, 0-indexed) so super-admin can see where
-- signups without a professional_profiles row dropped off. NULL means the
-- wizard was never opened, or the row predates this column (existing
-- prospects created before 2026-08-10 have no step data).
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS onboarding_step smallint;

COMMENT ON COLUMN profiles.onboarding_step IS
  'Last professional onboarding wizard step reached (0-indexed, matches Onboarding.jsx STEPS). NULL = never started or predates tracking.';
