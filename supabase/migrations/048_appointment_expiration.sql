-- Turno expiration policy (confirmed by product owner 2026-07-08):
-- A booked (status='confirmed') appointment whose scheduled_at is more than 2 hours
-- in the past, and that never progressed past 'confirmed' (neither side ever entered
-- the call), is auto-expired to status='no_show' by the expire-stale-appointments
-- Edge Function (pg_cron, every 15 min — see cron job below).
--
-- If the expired consultation was already paid, refund_pending is flagged for manual
-- admin review. No automatic MercadoPago refund is issued.

-- 1. 'no_show' was already being written by the professional's "Marcar como ausente"
--    button (src/pages/professional/VideoCall.jsx) but was NOT a valid value in the
--    status check constraint — that write would have failed in production. Fix it here.
ALTER TABLE public.consultations
  DROP CONSTRAINT IF EXISTS consultations_status_check;

ALTER TABLE public.consultations
  ADD CONSTRAINT consultations_status_check
  CHECK (status = ANY (ARRAY[
    'pending'::text,
    'confirmed'::text,
    'in_progress'::text,
    'pending_pro_close'::text,
    'completed'::text,
    'cancelled'::text,
    'no_show'::text
  ]));

-- 2. Manual-review refund flag. No MercadoPago refund API call — admin reviews and
--    actions the refund manually. There is no admin UI for this yet (tracked as follow-up).
ALTER TABLE public.consultations
  ADD COLUMN IF NOT EXISTS refund_pending boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.consultations.refund_pending IS
  'Set true by expire-stale-appointments when a paid, confirmed consultation expires unattended (>2h past scheduled_at, never progressed past confirmed). Manual admin review only — no automatic MercadoPago refund is triggered.';

-- 3. Index for the cron sweep — find confirmed consultations whose scheduled_at is
--    more than 2h in the past.
CREATE INDEX IF NOT EXISTS idx_consultations_stale_confirmed
  ON public.consultations (scheduled_at)
  WHERE status = 'confirmed';

-- 4. pg_cron job registration: NOT included in this migration file, and NOT YET
--    APPLIED to the live DB as of this migration running.
--    Following the existing appointment-reminders-15min precedent (also absent from
--    migrations/), the cron.schedule() call needs the project anon key + CRON_SECRET
--    embedded in the job's SQL command (pg_net's net.http_post requires literal
--    header values) — this must not be committed to git, and this session's sandbox
--    permissions blocked writing it directly to the live DB (classified as a
--    plaintext-credential exposure) even via Supabase Vault. It must be registered
--    once, manually, by running the following in the Supabase SQL editor
--    (https://supabase.com/dashboard/project/aixjejdoofervrkggbkd/sql/new),
--    substituting the project's anon key and CRON_SECRET (both readable from
--    `npx supabase secrets list` / project settings — do not hardcode them anywhere
--    else once used):
--
--    SELECT cron.schedule(
--      'expire-stale-appointments-15min',
--      '*/15 * * * *',
--      $cron$
--      SELECT net.http_post(
--        url := 'https://aixjejdoofervrkggbkd.supabase.co/functions/v1/expire-stale-appointments',
--        headers := jsonb_build_object(
--          'Content-Type', 'application/json',
--          'Authorization', 'Bearer <ANON_KEY>',
--          'x-cron-secret', '<CRON_SECRET>'
--        ),
--        body := '{}'::jsonb
--      );
--      $cron$
--    );
