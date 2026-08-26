-- Migration 103: Pharmacy roles + single-tenant pharmacies table
-- Part of the "Farmacias — Pedido de Medicamentos" feature (branch feature/farmacia-medicamentos).
-- Do NOT merge to main until Mateo approves — see plan at
-- ~/.claude/plans/glimmering-wibbling-cherny.md
--
-- NOTE: public.get_my_role() (used throughout this migration's RLS policies)
-- has no tracked CREATE FUNCTION anywhere in supabase/migrations/ — it was
-- applied directly to production at some point. Pre-existing risk, not fixed here.

-- ────────────────────────────────────────────────────────────
-- 1. Widen profiles.role to accept the 3 pharmacy roles
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN (
    'patient', 'professional', 'admin', 'super_admin',
    'pharmacy_admin', 'pharmacy_operator', 'pharmacy_readonly'
  ));

-- ────────────────────────────────────────────────────────────
-- 2. Widen promote_user_to_admin's allowlist (003_mvp_gap_closure.sql)
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.promote_user_to_admin(
  target_email text,
  new_role     text DEFAULT 'admin'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'super_admin'
  ) THEN
    RAISE EXCEPTION 'only super_admin can promote';
  END IF;
  IF new_role NOT IN (
    'admin', 'super_admin', 'professional', 'patient',
    'pharmacy_admin', 'pharmacy_operator', 'pharmacy_readonly'
  ) THEN
    RAISE EXCEPTION 'invalid role: %', new_role;
  END IF;
  UPDATE profiles SET role = new_role WHERE lower(email) = lower(target_email);
END;
$$;

-- ────────────────────────────────────────────────────────────
-- 3. pharmacies — single MVP tenant, fixed seed id
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pharmacies (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  legal_name       text,
  address          text,
  phone            text,
  commission_rate  numeric NOT NULL DEFAULT 0.20,
  active           boolean NOT NULL DEFAULT true,
  mp_connected     boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.pharmacies (id, name, legal_name)
VALUES ('10000000-0000-0000-0000-000000000001', 'Farmacia Healthier', 'Farmacia Healthier MVP')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.pharmacies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pharmacies_public_read"
  ON public.pharmacies FOR SELECT
  USING (true);

CREATE POLICY "pharmacies_update_pharmacy_admin"
  ON public.pharmacies FOR UPDATE
  USING (public.get_my_role() IN ('pharmacy_admin', 'super_admin'))
  WITH CHECK (public.get_my_role() IN ('pharmacy_admin', 'super_admin'));

CREATE TRIGGER pharmacies_updated_at
  BEFORE UPDATE ON public.pharmacies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.pharmacies IS 'MVP: single-row tenant. Multi-pharmacy is a future additive change (add pharmacy_id scoping to roles), not a rewrite.';
