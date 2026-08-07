-- Migration 106: medication_orders + medication_order_items
-- The order is always created by the patient (from the catalog, or after
-- seeing an automatic prescription match) — there is intentionally no
-- professional insert policy. See plan: professional only issues the
-- receta, never creates or triggers a purchase on the patient's behalf.

CREATE TABLE IF NOT EXISTS public.medication_orders (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id            uuid NOT NULL REFERENCES public.profiles(id),
  pharmacy_id           uuid NOT NULL REFERENCES public.pharmacies(id),
  rcta_prescription_id  text,
  delivery_address      text,
  status                text NOT NULL DEFAULT 'pendiente'
                          CHECK (status IN ('pendiente', 'en_preparacion', 'enviado', 'entregado', 'cancelado')),
  payment_status        text NOT NULL DEFAULT 'no_pagado'
                          CHECK (payment_status IN ('no_pagado', 'pagado')),
  subtotal              numeric NOT NULL DEFAULT 0,
  total                 numeric NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_medication_orders_patient_id  ON public.medication_orders(patient_id);
CREATE INDEX IF NOT EXISTS idx_medication_orders_pharmacy_id ON public.medication_orders(pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_medication_orders_status      ON public.medication_orders(status);

CREATE TRIGGER medication_orders_updated_at
  BEFORE UPDATE ON public.medication_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.medication_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "medication_orders_patient_select_own"
  ON public.medication_orders FOR SELECT
  USING (patient_id = auth.uid());

CREATE POLICY "medication_orders_patient_insert_own"
  ON public.medication_orders FOR INSERT
  WITH CHECK (patient_id = auth.uid());

CREATE POLICY "medication_orders_patient_update_own_unpaid"
  ON public.medication_orders FOR UPDATE
  USING (patient_id = auth.uid() AND payment_status = 'no_pagado')
  WITH CHECK (patient_id = auth.uid());

CREATE POLICY "medication_orders_pharmacy_staff_select"
  ON public.medication_orders FOR SELECT
  USING (public.get_my_role() IN ('pharmacy_admin', 'pharmacy_operator', 'pharmacy_readonly'));

CREATE POLICY "medication_orders_pharmacy_staff_update_status"
  ON public.medication_orders FOR UPDATE
  USING (public.get_my_role() IN ('pharmacy_admin', 'pharmacy_operator'))
  WITH CHECK (public.get_my_role() IN ('pharmacy_admin', 'pharmacy_operator'));

CREATE POLICY "medication_orders_admin_select"
  ON public.medication_orders FOR SELECT
  USING (public.get_my_role() IN ('admin', 'super_admin'));

-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.medication_order_items (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id               uuid NOT NULL REFERENCES public.medication_orders(id) ON DELETE CASCADE,
  pharmacy_product_id    uuid REFERENCES public.pharmacy_products(id),
  medication_name        text NOT NULL,
  presentation           text,
  quantity               integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price             numeric NOT NULL,
  requires_prescription  boolean NOT NULL DEFAULT false,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_medication_order_items_order_id ON public.medication_order_items(order_id);

ALTER TABLE public.medication_order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "medication_order_items_patient_select_own"
  ON public.medication_order_items FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.medication_orders mo
    WHERE mo.id = order_id AND mo.patient_id = auth.uid()
  ));

CREATE POLICY "medication_order_items_patient_insert_own"
  ON public.medication_order_items FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.medication_orders mo
    WHERE mo.id = order_id AND mo.patient_id = auth.uid()
  ));

CREATE POLICY "medication_order_items_pharmacy_staff_select"
  ON public.medication_order_items FOR SELECT
  USING (public.get_my_role() IN ('pharmacy_admin', 'pharmacy_operator', 'pharmacy_readonly'));

CREATE POLICY "medication_order_items_admin_select"
  ON public.medication_order_items FOR SELECT
  USING (public.get_my_role() IN ('admin', 'super_admin'));
