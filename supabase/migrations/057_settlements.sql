-- ============================================================
-- Migration 057 — Settlements ("cuenta corriente" pagos pendientes a profesionales)
-- ============================================================
-- Product decision (Mateo, 2026-07-24):
--   payments.manual_settlement_amount (from 056) is a debt Healthier owes the
--   professional — the 78% of the credit-covered portion of a consultation,
--   settled by manual bank transfer outside the app. This migration formalizes
--   that debt as a "cuenta corriente":
--     - settled_at / settled_by mark when + who confirmed the manual transfer.
--     - mark_settlement_paid() is the only way to set them (super_admin only).
--     - A partial index makes "pending settlements" queries cheap.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. payments — settlement tracking columns
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS settled_at timestamptz,
  ADD COLUMN IF NOT EXISTS settled_by uuid REFERENCES public.profiles(id);

COMMENT ON COLUMN public.payments.manual_settlement_amount IS
  'Deuda de Healthier al profesional por la porción de esta consulta pagada con Healthy Credits (78% de esa porción) — se salda por transferencia manual, fuera de Mercado Pago.';

COMMENT ON COLUMN public.payments.settled_at IS
  'Momento en que el super_admin confirmó la transferencia manual de manual_settlement_amount al profesional. NULL = todavía pendiente de pago.';

COMMENT ON COLUMN public.payments.settled_by IS
  'super_admin que marcó este pago como liquidado (ver mark_settlement_paid()).';

-- ────────────────────────────────────────────────────────────
-- 2. Partial index — cheap "pending settlements" lookups
-- ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_payments_pending_settlement
  ON public.payments(professional_id)
  WHERE manual_settlement_amount > 0 AND settled_at IS NULL;

-- ────────────────────────────────────────────────────────────
-- 3. mark_settlement_paid — super_admin marks a debt as paid
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mark_settlement_paid(p_payment uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.get_my_role() <> 'super_admin' THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  UPDATE public.payments
  SET settled_at = now(),
      settled_by = auth.uid()
  WHERE id = p_payment
    AND manual_settlement_amount > 0
    AND settled_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pago no encontrado o ya liquidado';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_settlement_paid(uuid) TO authenticated;
