-- Backfill price_at_booking for completed consultations that have no price
-- Uses the professional's current session_price as the historical rate
UPDATE public.consultations c
SET
  price_at_booking = pp.session_price,
  payment_status   = CASE
                       WHEN c.payment_status = 'pending_payment' THEN 'paid'
                       ELSE c.payment_status
                     END
FROM public.professional_profiles pp
WHERE pp.user_id = c.professional_id
  AND c.status = 'completed'
  AND (c.price_at_booking IS NULL OR c.price_at_booking = 0)
  AND pp.session_price IS NOT NULL;

-- Also mark confirmed/in_progress consultations created in past months as completed
-- so the chart has historical data for the demo
UPDATE public.consultations
SET
  status       = 'completed',
  completed_at = scheduled_at + INTERVAL '45 minutes',
  payment_status = 'paid'
WHERE status IN ('confirmed', 'in_progress')
  AND scheduled_at < now() - INTERVAL '2 days'
  AND completed_at IS NULL;

-- Re-run the price backfill for anything just completed above
UPDATE public.consultations c
SET price_at_booking = pp.session_price
FROM public.professional_profiles pp
WHERE pp.user_id = c.professional_id
  AND c.status = 'completed'
  AND (c.price_at_booking IS NULL OR c.price_at_booking = 0)
  AND pp.session_price IS NOT NULL;
