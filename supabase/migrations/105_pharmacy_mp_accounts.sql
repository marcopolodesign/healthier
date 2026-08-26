-- Migration 105: pharmacy_mp_accounts — MP OAuth credentials for the pharmacy
-- beneficiary, structurally analogous to mp_accounts (027_mp_marketplace.sql)
-- but kept as its own table rather than generalizing mp_accounts, since
-- mp_accounts.professional_id is read directly (.eq('professional_id', ...))
-- in ~10 places across mp-payment/mp-webhook/mp-capture — touching it is
-- unnecessary risk to consultation payments already in production.

CREATE TABLE IF NOT EXISTS public.pharmacy_mp_accounts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id    uuid NOT NULL UNIQUE REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  mp_user_id     text NOT NULL,
  access_token   text NOT NULL,
  refresh_token  text,
  public_key     text,
  mp_nickname    text,
  mp_email       text,
  active         boolean NOT NULL DEFAULT true,
  expires_at     timestamptz,
  live_mode      boolean,
  connected_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.pharmacy_mp_accounts ENABLE ROW LEVEL SECURITY;

-- Reads only — all writes go through service_role (pharmacy-mp-connect edge function).
CREATE POLICY "pharmacy_mp_accounts_select_pharmacy_staff"
  ON public.pharmacy_mp_accounts FOR SELECT
  USING (public.get_my_role() IN ('pharmacy_admin', 'super_admin'));
