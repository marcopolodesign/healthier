-- 246 · Farmacia: la necesidad de cada producto (rediseño de la farmacia del paciente, 2026-11-22)
--
-- La farmacia del paciente se ordena en un mosaico de fotos: las cuatro
-- categorías de siempre (`category`) y, además, agrupaciones por necesidad
-- ("Dolor y fiebre", "Resfrío y alergia"…). Mateo (2026-11-22): por necesidad
-- SÓLO cuando es obvia por el nombre o la droga; lo dudoso queda sin necesidad
-- y sigue apareciendo en su categoría. Por eso la columna es opcional.
--
-- La lista de valores es cerrada porque cada necesidad tiene su foto y su
-- rótulo en el front (website/src/lib/pharmacyProducts.js y
-- mobile/src/lib/farmaciaNecesidades.ts). Agregar una nueva = migración +
-- foto + rótulo en los dos.
--
-- El reparto inicial NO va acá (es de datos y depende del catálogo de cada
-- base): `node scripts/farmacia-necesidades.mjs <staging|produccion>`.

ALTER TABLE public.pharmacy_products
  ADD COLUMN IF NOT EXISTS necesidad text;

ALTER TABLE public.pharmacy_products
  DROP CONSTRAINT IF EXISTS pharmacy_products_necesidad_check;

ALTER TABLE public.pharmacy_products
  ADD CONSTRAINT pharmacy_products_necesidad_check
  CHECK (necesidad IS NULL OR necesidad IN ('dolor', 'resfrio', 'piel', 'presion', 'digestion', 'antibioticos'));

COMMENT ON COLUMN public.pharmacy_products.necesidad IS
  'Agrupación por necesidad para el mosaico del paciente (dolor, resfrio, piel, presion, digestion, antibioticos). NULL = sin necesidad obvia: el producto sólo aparece en su categoría.';

CREATE INDEX IF NOT EXISTS idx_pharmacy_products_necesidad
  ON public.pharmacy_products(necesidad) WHERE necesidad IS NOT NULL;
