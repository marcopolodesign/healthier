-- ============================================================
-- Migration 061 — On-demand real con pre-autorización MP (v1 solo crédito)
-- ============================================================
-- Product decisions (Mateo, 2026-07-27):
--   On-demand se cobra con pre-autorización (capture:false): reserva en la
--   tarjeta al iniciar, captura recién cuando la sesión termina, cancelación
--   de la autorización en cualquier abandono (sin refunds ni créditos).
--   v1 solo tarjeta de crédito (débito/dinero en cuenta no soportan pre-auth).
--   Timeout real: si la llamada no empieza en 10 minutos → cancelar
--   autorización + consulta (ver mp-capture action=sweep).
--
-- Sections:
--   1. payments.status — widen CHECK to add 'authorized' | 'cancelled'
--   2. payments — authorized_at / captured_at / auth_cancelled_at
--   3. consultations.is_on_demand
--   4. Partial index on payments(status='authorized') — sweep lookups
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. payments.status — widen vocabulary
-- ────────────────────────────────────────────────────────────
-- 056_payments_split.sql defined this as an unnamed column-level CHECK,
-- which Postgres auto-names <table>_<column>_check → payments_status_check.
ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_status_check;

ALTER TABLE public.payments
  ADD CONSTRAINT payments_status_check
  CHECK (status IN ('pending', 'authorized', 'approved', 'rejected', 'refunded', 'cancelled'));

COMMENT ON COLUMN public.payments.status IS
  'pending → authorized → approved | cancelled ; approved → refunded ; pending → rejected. '
  '"authorized" = pre-autorización on-demand reservada en la tarjeta sin capturar (capture:false). '
  '"cancelled" = autorización on-demand liberada sin cobro (abandono/timeout/no conexión del profesional). '
  'Vocabulario alineado con consultations.payment_status (mp-payment / mp-capture / mp-webhook / mp-refund).';

-- ────────────────────────────────────────────────────────────
-- 2. payments — pre-auth lifecycle timestamps
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS authorized_at    timestamptz,
  ADD COLUMN IF NOT EXISTS captured_at      timestamptz,
  ADD COLUMN IF NOT EXISTS auth_cancelled_at timestamptz;

COMMENT ON COLUMN public.payments.authorized_at IS
  'Momento en que MP confirmó la pre-autorización (status=authorized). Seteado por mp-payment (authorizeOnly) o mp-webhook.';

COMMENT ON COLUMN public.payments.captured_at IS
  'Momento en que se capturó la pre-autorización (status authorized → approved) al finalizar la consulta on-demand. Seteado por mp-capture (action=capture) o el sweep.';

COMMENT ON COLUMN public.payments.auth_cancelled_at IS
  'Momento en que se liberó la pre-autorización sin cobrar (status authorized → cancelled) por abandono, timeout de 10 min, o falta de médicos. Seteado por mp-capture (action=cancel-auth) o el sweep.';

-- ────────────────────────────────────────────────────────────
-- 3. consultations.is_on_demand
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.consultations
  ADD COLUMN IF NOT EXISTS is_on_demand boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.consultations.is_on_demand IS
  'true = consulta inmediata (OnDemand.jsx) pagada con pre-autorización de tarjeta de crédito (v1). Usado por mp-capture (sweep) para distinguir estas consultas de las reservadas con turno.';

-- ────────────────────────────────────────────────────────────
-- 4. Partial index — sweep / lookup of open authorizations
-- ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_payments_status_authorized
  ON public.payments(status)
  WHERE status = 'authorized';
