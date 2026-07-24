-- Migration 059 — consultations.paid_at
-- Bug encontrado en la verificación E2E del flujo de refunds (2026-07-24):
-- mp-payment y mp-webhook escriben consultations.paid_at al aprobar un pago,
-- pero ninguna migración creó la columna — el update fallaba con PGRST204 y la
-- consulta quedaba en pending_payment aunque el cobro hubiera salido bien.

ALTER TABLE public.consultations
  ADD COLUMN IF NOT EXISTS paid_at timestamptz;

COMMENT ON COLUMN public.consultations.paid_at IS
  'Momento de aprobación del pago (lo setean mp-payment / mp-webhook).';
