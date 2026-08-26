-- Migration 107: make payments polymorphic (consultation+professional OR
-- order+pharmacy). Highest-risk migration in this feature, but strictly
-- additive: every existing row already satisfies the first branch of the
-- new CHECK, and no existing SELECT policy changes behavior for
-- consultation-type rows (professional_id = auth.uid() / patient_id =
-- auth.uid() simply evaluate to false on order-type rows where those
-- columns are NULL — harmless no-op, not a security gap, since a separate
-- pharmacy-staff policy below covers order-type reads).

ALTER TABLE public.payments
  ALTER COLUMN consultation_id DROP NOT NULL,
  ALTER COLUMN professional_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS order_id    uuid REFERENCES public.medication_orders(id),
  ADD COLUMN IF NOT EXISTS pharmacy_id uuid REFERENCES public.pharmacies(id);

ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_beneficiary_xor;

ALTER TABLE public.payments
  ADD CONSTRAINT payments_beneficiary_xor CHECK (
    (consultation_id IS NOT NULL AND professional_id IS NOT NULL AND order_id IS NULL AND pharmacy_id IS NULL)
    OR
    (order_id IS NOT NULL AND pharmacy_id IS NOT NULL AND consultation_id IS NULL AND professional_id IS NULL)
  );

CREATE INDEX IF NOT EXISTS idx_payments_order_id ON public.payments(order_id) WHERE order_id IS NOT NULL;

CREATE POLICY "payments_select_pharmacy_staff"
  ON public.payments FOR SELECT
  USING (order_id IS NOT NULL AND public.get_my_role() IN ('pharmacy_admin', 'pharmacy_operator', 'pharmacy_readonly'));

COMMENT ON COLUMN public.payments.net_to_professional IS
  'Net amount to the beneficiary — professional for consultation-type rows, pharmacy for order-type rows (column name kept for backward compat).';
