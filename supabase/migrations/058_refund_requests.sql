-- ============================================================
-- Migration 058 — Manual refund approval queue
-- ============================================================
-- Product decision (Mateo, 2026-07-24):
--   Refunds must NEVER be automatic. Every refund request (cancellation
--   ≥ refund_window_business_hours before scheduled_at) now lands in a
--   super_admin queue and is approved/rejected by hand — no Healthy Credits
--   are issued, and no payments/consultations status changes, until a
--   super_admin explicitly approves the request (mp-refund action=approve-refund).
--   The MP-conversion workflow (request-mp-conversion / approve-mp-conversion,
--   migration 056) is unaffected — it was already manual.
-- ============================================================

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS refund_requested_at   timestamptz,
  ADD COLUMN IF NOT EXISTS refund_request_status text CHECK (refund_request_status IN ('pending', 'approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS refund_reviewed_by     uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS refund_reviewed_at     timestamptz,
  ADD COLUMN IF NOT EXISTS refund_reject_reason   text;

CREATE INDEX IF NOT EXISTS idx_payments_pending_refund_request
  ON public.payments(refund_request_status)
  WHERE refund_request_status = 'pending';

COMMENT ON COLUMN public.payments.refund_requested_at IS
  'Momento en que el paciente (o admin) solicitó la devolución en créditos por cancelación. Toda devolución se aprueba manualmente desde el super admin (regla de producto 2026-07-24) — no dispara ninguna acreditación por sí sola.';

COMMENT ON COLUMN public.payments.refund_request_status IS
  'pending → approved | rejected. pending = esperando revisión manual del super_admin; ninguna devolución es automática (regla de producto 2026-07-24).';

COMMENT ON COLUMN public.payments.refund_reviewed_by IS
  'super_admin que aprobó o rechazó la solicitud de devolución (ver mp-refund action=approve-refund / reject-refund).';

COMMENT ON COLUMN public.payments.refund_reviewed_at IS
  'Momento en que el super_admin resolvió (aprobó o rechazó) la solicitud de devolución.';

COMMENT ON COLUMN public.payments.refund_reject_reason IS
  'Motivo opcional que el super_admin dejó al rechazar la solicitud de devolución.';
