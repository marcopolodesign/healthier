-- Migration 104: Extend pharmacy_products for the medication-order catalog
-- (SKU, presentation, prescription flag, real stock quantity, tenant FK).
-- Extends 050_pharmacy.sql — does not replace it. medication_match is kept
-- untouched (still the RCTA prescription <-> catalog matching field).

ALTER TABLE public.pharmacy_products
  ADD COLUMN IF NOT EXISTS sku                   text,
  ADD COLUMN IF NOT EXISTS presentation           text,
  ADD COLUMN IF NOT EXISTS requires_prescription  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stock_quantity         integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pharmacy_id            uuid REFERENCES public.pharmacies(id);

UPDATE public.pharmacy_products
  SET pharmacy_id = '10000000-0000-0000-0000-000000000001'
  WHERE pharmacy_id IS NULL;

ALTER TABLE public.pharmacy_products
  ALTER COLUMN pharmacy_id SET NOT NULL;

-- Existing demo rows have in_stock=true but stock_quantity=0 (default) —
-- backfill a sane initial quantity so the new derived-column trigger below
-- doesn't immediately flip them to out-of-stock.
UPDATE public.pharmacy_products
  SET stock_quantity = 20
  WHERE in_stock = true AND stock_quantity = 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pharmacy_products_sku
  ON public.pharmacy_products(sku) WHERE sku IS NOT NULL;

-- Keep in_stock derived from stock_quantity so existing read paths
-- (getFeatured/getSuggested) that filter on in_stock keep working once
-- Excel import starts driving stock_quantity.
CREATE OR REPLACE FUNCTION public.pharmacy_products_sync_in_stock()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.in_stock := (NEW.stock_quantity > 0);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pharmacy_products_sync_in_stock ON public.pharmacy_products;
CREATE TRIGGER pharmacy_products_sync_in_stock
  BEFORE INSERT OR UPDATE OF stock_quantity ON public.pharmacy_products
  FOR EACH ROW EXECUTE FUNCTION public.pharmacy_products_sync_in_stock();

CREATE POLICY "pharmacy_products_write_pharmacy_admin"
  ON public.pharmacy_products FOR ALL
  USING (public.get_my_role() IN ('pharmacy_admin', 'super_admin'))
  WITH CHECK (public.get_my_role() IN ('pharmacy_admin', 'super_admin'));
