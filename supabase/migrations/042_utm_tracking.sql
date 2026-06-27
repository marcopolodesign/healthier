-- UTM tracking columns on profiles
-- Captured at registration time from URL params (persisted via localStorage from landing → register)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS utm_source    TEXT,
  ADD COLUMN IF NOT EXISTS utm_medium    TEXT,
  ADD COLUMN IF NOT EXISTS utm_campaign  TEXT,
  ADD COLUMN IF NOT EXISTS utm_id        TEXT,
  ADD COLUMN IF NOT EXISTS utm_content   TEXT,
  ADD COLUMN IF NOT EXISTS referrer_url  TEXT;
