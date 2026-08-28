-- Migration 129: Pharmacy — 3-way prescription category + "atendido por un
-- profesional de Healthier" blocker on medication orders.
-- Requested by Mateo (2026-08-28), matches the model Nacho described in
-- Healthier Nacho (2026-08-27): acceso a farmacia sólo para pacientes que ya
-- se atendieron; catálogo clasificado en venta libre / receta / receta
-- archivada (see 050_pharmacy.sql, 104_pharmacy_catalog_extend.sql).

-- ── 1. Categoría de venta reemplaza el booleano requires_prescription ──────
ALTER TABLE public.pharmacy_products
  ADD COLUMN IF NOT EXISTS prescription_type text
    NOT NULL DEFAULT 'venta_libre'
    CHECK (prescription_type IN ('venta_libre', 'receta', 'receta_archivada'));

UPDATE public.pharmacy_products
  SET prescription_type = 'receta'
  WHERE requires_prescription = true AND prescription_type = 'venta_libre';

-- requires_prescription queda como columna derivada (true para las dos
-- categorías con receta) para no romper medication_order_items, PedidoDetail
-- y pharmacyAdminService, que siguen leyéndola tal cual.
CREATE OR REPLACE FUNCTION public.pharmacy_products_sync_requires_prescription()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.requires_prescription := (NEW.prescription_type <> 'venta_libre');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pharmacy_products_sync_requires_prescription ON public.pharmacy_products;
CREATE TRIGGER pharmacy_products_sync_requires_prescription
  BEFORE INSERT OR UPDATE OF prescription_type ON public.pharmacy_products
  FOR EACH ROW EXECUTE FUNCTION public.pharmacy_products_sync_requires_prescription();

UPDATE public.pharmacy_products
  SET requires_prescription = (prescription_type <> 'venta_libre');

COMMENT ON COLUMN public.pharmacy_products.prescription_type IS
  'venta_libre: visible y comprable por cualquier paciente atendido. receta: requiere receta electrónica vigente (RCTA). receta_archivada: receta emitida y archivada previamente, sin reemisión.';

-- ── 2. Blocker: comprar en la farmacia requiere haberse atendido con un ────
-- profesional de Healthier (al menos una consulta completada) alguna vez.
DROP POLICY IF EXISTS "medication_orders_patient_insert_own" ON public.medication_orders;
CREATE POLICY "medication_orders_patient_insert_own"
  ON public.medication_orders FOR INSERT
  WITH CHECK (
    patient_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.consultations c
      WHERE c.patient_id = auth.uid() AND c.status = 'completed'
    )
  );
