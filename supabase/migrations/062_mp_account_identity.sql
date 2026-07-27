-- Migration 062 — Mercado Pago account identity (nickname/email)
-- mp-connect only ever stored mp_user_id (numeric MP id) — useless for a human
-- to recognize "is this the right MP account?" in the professional's own
-- Configuración page or in the super-admin Profesionales list. This adds the
-- seller identity returned by GET /users/me right after the OAuth token
-- exchange (mp-connect callback).
--
-- mp_accounts keeps the raw nickname/email (RLS restricts SELECT to the
-- owning professional — see 027/060). professional_profiles gets a
-- denormalized, already-formatted label so the super-admin list (which reads
-- professional_profiles, not mp_accounts) can display it without needing a
-- new RLS grant — same pattern as mp_connected in 056.

ALTER TABLE public.mp_accounts
  ADD COLUMN IF NOT EXISTS mp_nickname text,
  ADD COLUMN IF NOT EXISTS mp_email    text;

COMMENT ON COLUMN public.mp_accounts.mp_nickname IS
  'MP seller nickname from GET /users/me (mp-connect callback). Best-effort — null if the lookup failed (non-fatal).';
COMMENT ON COLUMN public.mp_accounts.mp_email IS
  'MP seller email from GET /users/me (mp-connect callback). Best-effort — null if the lookup failed (non-fatal).';

ALTER TABLE public.professional_profiles
  ADD COLUMN IF NOT EXISTS mp_account_label text;

COMMENT ON COLUMN public.professional_profiles.mp_account_label IS
  'nickname/email de la cuenta MP conectada — visible en admin. Denormalized from mp_accounts (nickname + " · " + email, best available combo) so /super-admin/profesionales can show it without an mp_accounts RLS grant. Maintained by mp-connect (connect sets it, disconnect clears it).';
