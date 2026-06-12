-- Migration 027: Mercado Pago Marketplace
-- Tables: payment_methods, mp_accounts
-- Columns added to consultations: mp_payment_id, payment_status

-- ============================================================
-- TABLE: payment_methods
-- Stores saved MP cards per patient (customer + card token ref)
-- ============================================================
CREATE TABLE IF NOT EXISTS payment_methods (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  mp_customer_id TEXT       NOT NULL,
  mp_card_id    TEXT        NOT NULL,
  card_brand    TEXT,
  last_four     TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE payment_methods ENABLE ROW LEVEL SECURITY;

-- Owner can read their own saved cards
CREATE POLICY "payment_methods_select_own"
  ON payment_methods FOR SELECT
  USING (auth.uid() = user_id);

-- Owner can delete their own saved cards
CREATE POLICY "payment_methods_delete_own"
  ON payment_methods FOR DELETE
  USING (auth.uid() = user_id);

-- service_role can insert (called from Edge Functions / server)
CREATE POLICY "payment_methods_insert_service"
  ON payment_methods FOR INSERT
  WITH CHECK (true);  -- service_role bypasses RLS; this covers admin inserts

-- service_role can select all (for reconciliation)
-- (service_role bypasses RLS by default; policies above cover anon/authenticated)

-- ============================================================
-- TABLE: mp_accounts
-- One row per professional: their MP OAuth credentials
-- ============================================================
CREATE TABLE IF NOT EXISTS mp_accounts (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  mp_user_id      TEXT        NOT NULL,       -- MP collector_id
  access_token    TEXT        NOT NULL,       -- encrypted at app layer
  refresh_token   TEXT,
  public_key      TEXT,
  connected_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE (professional_id)
);

ALTER TABLE mp_accounts ENABLE ROW LEVEL SECURITY;

-- Professional can read their own MP account row
CREATE POLICY "mp_accounts_select_own"
  ON mp_accounts FOR SELECT
  USING (auth.uid() = professional_id);

-- service_role full access (bypasses RLS); policies below cover non-service roles
CREATE POLICY "mp_accounts_insert_service"
  ON mp_accounts FOR INSERT
  WITH CHECK (true);

CREATE POLICY "mp_accounts_update_service"
  ON mp_accounts FOR UPDATE
  USING (true)
  WITH CHECK (true);

CREATE POLICY "mp_accounts_delete_service"
  ON mp_accounts FOR DELETE
  USING (true);

-- ============================================================
-- COLUMNS: consultations — mp_payment_id + payment_status
-- ============================================================
ALTER TABLE consultations
  ADD COLUMN IF NOT EXISTS mp_payment_id  TEXT,
  ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'pending'
    CHECK (payment_status IN ('pending', 'approved', 'rejected', 'refunded'));

-- Index for fast lookup by MP payment ID (webhooks)
CREATE INDEX IF NOT EXISTS idx_consultations_mp_payment_id
  ON consultations (mp_payment_id)
  WHERE mp_payment_id IS NOT NULL;
