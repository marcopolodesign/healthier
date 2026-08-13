-- Migration 108: fix pharmacy_products SKU unique index so PostgREST's
-- `ON CONFLICT (sku)` inference actually works.
--
-- 104_pharmacy_catalog_extend.sql created a PARTIAL unique index
-- (`WHERE sku IS NOT NULL`) to allow multiple NULL-sku legacy demo rows.
-- That was unnecessary: a plain UNIQUE index already treats NULL as
-- distinct from every other value (including other NULLs) per Postgres
-- semantics, so multiple NULL-sku rows were never actually a problem.
-- The partial index's real effect was breaking `ON CONFLICT (sku)`
-- inference — Postgres requires the conflict target to name the exact
-- index predicate, and plain `onConflict: 'sku'` from supabase-js can't
-- express that — every upsert-by-sku (pharmacyAdminService.bulkUpsertFromImport,
-- and the ad-hoc Microsules catalog import) hit `42P10 no unique or
-- exclusion constraint matching the ON CONFLICT specification`.

DROP INDEX IF EXISTS public.idx_pharmacy_products_sku;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pharmacy_products_sku
  ON public.pharmacy_products(sku);
