-- Add payment lifecycle tracking to consultations
ALTER TABLE public.consultations
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'pending_payment'
    CHECK (payment_status IN ('pending_payment', 'paid', 'refunded')),
  ADD COLUMN IF NOT EXISTS price_at_booking numeric;

COMMENT ON COLUMN public.consultations.payment_status IS 'pending_payment → paid → refunded';
COMMENT ON COLUMN public.consultations.price_at_booking IS 'Price charged at time of booking, in ARS';
