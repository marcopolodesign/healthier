-- Migration 060 — mp_accounts.scope
-- mp-connect guarda el scope OAuth devuelto por MP, pero la 027 nunca creó
-- la columna (mismo patrón que consultations.paid_at / 059). El upsert del
-- callback fallaba con PGRST204 → mp_error=db_save.

ALTER TABLE public.mp_accounts
  ADD COLUMN IF NOT EXISTS scope text;

COMMENT ON COLUMN public.mp_accounts.scope IS
  'Scope OAuth otorgado por MP (ej. offline_access read write).';
