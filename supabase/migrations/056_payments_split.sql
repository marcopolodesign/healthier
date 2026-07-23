-- ============================================================
-- Migration 056 — Mercado Pago Split Payments
-- ============================================================
-- Confirmed product decisions (Mateo, 2026-07-23):
--   1. Split 78/22. Healthier absorbs the MP processing fee inside its 22%
--      → the professional must receive 78% net of the consultation price.
--   2. A professional without MP connected cannot receive new bookings
--      (enforced server-side in the consultations-creation service — frontend scope).
--   3. Refunds only if cancellation happens ≥48 business hours before
--      scheduled_at. Refund is issued as Healthy Credits (internal ledger).
--      Patient can request conversion to a real MP refund; super_admin approves.
--   4. Mobile out of scope for this phase.
--
-- Sections:
--   1. Reconcile consultations.payment_status vocabulary
--   2. platform_settings (single-row config)
--   3. payments (transactional source of truth)
--   4. patient_credits (ledger) + get_credit_balance()
--   5. mp_accounts — active / expires_at / live_mode
--   6. professional_profiles — mp_connected (denormalized)
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. consultations.payment_status — reconcile vocabulary
-- ────────────────────────────────────────────────────────────
-- Current constraint (from 009_payment_status.sql) only allows
-- 'pending_payment' | 'paid' | 'refunded' — migration 027's attempt to
-- widen it to 'pending'/'approved'/'rejected' was a no-op (ADD COLUMN
-- IF NOT EXISTS on an already-existing column), so no row can currently
-- hold those older values. We still run the defensive UPDATEs first,
-- before touching the constraint, per repo convention (048).

UPDATE public.consultations SET payment_status = 'pending_payment' WHERE payment_status = 'pending';
UPDATE public.consultations SET payment_status = 'paid'            WHERE payment_status = 'approved';
-- 'rejected' already a valid target value in the new vocabulary — no rewrite needed.

-- Drop whatever CHECK constraint currently governs payment_status.
-- 009 did not name it explicitly, so Postgres auto-named it
-- consultations_payment_status_check.
ALTER TABLE public.consultations
  DROP CONSTRAINT IF EXISTS consultations_payment_status_check;

ALTER TABLE public.consultations
  ADD CONSTRAINT consultations_payment_status_check
  CHECK (payment_status IN ('pending_payment', 'in_process', 'paid', 'rejected', 'refunded'));

ALTER TABLE public.consultations
  ALTER COLUMN payment_status SET DEFAULT 'pending_payment';

COMMENT ON COLUMN public.consultations.payment_status IS
  'pending_payment → in_process → paid | rejected ; paid → refunded. Vocabulary aligned with payments.status (mp-webhook / mp-payment / mp-refund).';

-- ────────────────────────────────────────────────────────────
-- 2. platform_settings — single-row config
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.platform_settings (
  id                          int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  commission_rate             numeric NOT NULL DEFAULT 0.22,
  -- NOTE: spec draft placeholder was 0.0629 "ajustar según research"; SECCIÓN A of
  -- the spec resolved the research to 6.60% + IVA 21% ≈ 0.0799 (instant AR release
  -- rate) — using that researched value here per the spec's own instruction.
  mp_fee_estimate_rate        numeric NOT NULL DEFAULT 0.0799,
  refund_window_business_hours int    NOT NULL DEFAULT 48,
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  updated_by                  uuid REFERENCES public.profiles(id)
);

INSERT INTO public.platform_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "platform_settings_select_authenticated"
  ON public.platform_settings FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "platform_settings_update_super_admin"
  ON public.platform_settings FOR UPDATE
  USING (public.get_my_role() = 'super_admin')
  WITH CHECK (public.get_my_role() = 'super_admin');

CREATE TRIGGER platform_settings_updated_at
  BEFORE UPDATE ON public.platform_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ────────────────────────────────────────────────────────────
-- 3. payments — transactional source of truth
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payments (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id             uuid NOT NULL REFERENCES public.consultations(id),
  patient_id                  uuid NOT NULL REFERENCES public.profiles(id),
  professional_id             uuid NOT NULL REFERENCES public.profiles(id),
  mp_payment_id               text UNIQUE,
  method                      text NOT NULL CHECK (method IN ('card', 'credits', 'mixed')),
  gross_amount                numeric NOT NULL,
  credits_used                numeric NOT NULL DEFAULT 0,
  charged_amount              numeric NOT NULL,
  platform_fee                numeric NOT NULL DEFAULT 0,
  mp_fee_estimated            numeric NOT NULL DEFAULT 0,
  mp_fee_actual                numeric,
  net_to_professional         numeric NOT NULL,
  manual_settlement_amount    numeric NOT NULL DEFAULT 0,
  currency                    text NOT NULL DEFAULT 'ARS',
  status                      text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'refunded')),
  status_detail               text,
  collector_id                text,
  refund_type                 text CHECK (refund_type IN ('credit', 'mp')),
  refunded_at                  timestamptz,
  mp_refund_id                 text,
  refund_conversion_requested_at timestamptz,
  refund_conversion_resolved_at  timestamptz,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payments_consultation_id ON public.payments(consultation_id);
CREATE INDEX IF NOT EXISTS idx_payments_professional_id ON public.payments(professional_id);
CREATE INDEX IF NOT EXISTS idx_payments_patient_id       ON public.payments(patient_id);
CREATE INDEX IF NOT EXISTS idx_payments_status           ON public.payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_created_at        ON public.payments(created_at);

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- Reads only — all writes go through service_role (edge functions).
-- No INSERT/UPDATE/DELETE policy is defined for authenticated/anon on purpose.
CREATE POLICY "payments_select_patient_own"
  ON public.payments FOR SELECT
  USING (patient_id = auth.uid());

CREATE POLICY "payments_select_professional_own"
  ON public.payments FOR SELECT
  USING (professional_id = auth.uid());

CREATE POLICY "payments_select_admin"
  ON public.payments FOR SELECT
  USING (public.get_my_role() IN ('admin', 'super_admin'));

CREATE TRIGGER payments_updated_at
  BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ────────────────────────────────────────────────────────────
-- 4. patient_credits — ledger (balance = SUM(amount))
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.patient_credits (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id      uuid NOT NULL REFERENCES public.profiles(id),
  amount          numeric NOT NULL, -- positive = issued, negative = consumed/reversed
  reason          text NOT NULL CHECK (reason IN ('refund', 'redeem', 'mp_refund_conversion', 'adjustment')),
  consultation_id uuid REFERENCES public.consultations(id) ON DELETE SET NULL,
  payment_id      uuid REFERENCES public.payments(id) ON DELETE SET NULL,
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES public.profiles(id)
);

CREATE INDEX IF NOT EXISTS idx_patient_credits_patient_id ON public.patient_credits(patient_id);

ALTER TABLE public.patient_credits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "patient_credits_select_own"
  ON public.patient_credits FOR SELECT
  USING (patient_id = auth.uid());

CREATE POLICY "patient_credits_select_admin"
  ON public.patient_credits FOR SELECT
  USING (public.get_my_role() IN ('admin', 'super_admin'));

-- Balance helper — SECURITY DEFINER so it can be called both by the
-- authenticated patient (own balance) and by edge functions using the
-- service-role key (auth.uid() is NULL in that context — trusted bypass).
CREATE OR REPLACE FUNCTION public.get_credit_balance(p_patient uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance numeric;
BEGIN
  IF auth.uid() IS NOT NULL
     AND auth.uid() <> p_patient
     AND public.get_my_role() NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  SELECT COALESCE(SUM(amount), 0)
    INTO v_balance
    FROM public.patient_credits
    WHERE patient_id = p_patient;

  RETURN v_balance;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_credit_balance(uuid) TO authenticated;

-- ────────────────────────────────────────────────────────────
-- 5. mp_accounts — active / expires_at / live_mode
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.mp_accounts
  ADD COLUMN IF NOT EXISTS active     boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS live_mode  boolean;

-- ────────────────────────────────────────────────────────────
-- 6. professional_profiles — mp_connected (denormalized)
-- ────────────────────────────────────────────────────────────
-- Denormalized so booking-eligibility checks don't need to read mp_accounts
-- (which is RLS-restricted to the owning professional). Maintained by
-- mp-connect (connect/disconnect) and mp-refresh-tokens (on invalid_grant).
ALTER TABLE public.professional_profiles
  ADD COLUMN IF NOT EXISTS mp_connected boolean NOT NULL DEFAULT false;

UPDATE public.professional_profiles
  SET mp_connected = true
  WHERE user_id IN (SELECT professional_id FROM public.mp_accounts);

COMMENT ON COLUMN public.professional_profiles.mp_connected IS
  'Denormalized flag mirroring an active mp_accounts row. Booking flows must reject creating a consultation for a professional with mp_connected = false.';
