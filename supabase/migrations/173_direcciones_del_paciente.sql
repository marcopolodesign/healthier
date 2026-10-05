-- ============================================================
-- Migration 173 — Mis direcciones: direcciones de entrega del paciente
-- ============================================================
-- Hoy el checkout de farmacia pide la dirección en un campo de texto libre
-- (`medication_orders.delivery_address`, migración 106) precargado con
-- `profiles.address` — un único domicilio por paciente, sin poder elegir
-- entre casa/trabajo/otra. Esta migración agrega `patient_addresses` para que
-- el paciente cargue varias y elija una en el checkout, al estilo del
-- selector de ubicaciones de BIGG.
--
-- No se toca `medication_orders.delivery_address`: sigue siendo el texto que
-- se guarda en el pedido (copia snapshot de la dirección elegida), así la
-- farmacia sigue leyéndolo igual que hoy sin acceso a esta tabla nueva.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.patient_addresses (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  etiqueta     text NOT NULL DEFAULT 'Casa', -- Casa | Trabajo | Otra
  direccion    text NOT NULL,
  piso_depto   text,
  referencias  text,
  lat          numeric,
  lng          numeric,
  principal    boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);

COMMENT ON TABLE public.patient_addresses IS
  'Direcciones de entrega guardadas por el paciente ("Mis direcciones"). Baja lógica vía deleted_at. El checkout de farmacia elige una y guarda una copia de texto en medication_orders.delivery_address.';

CREATE INDEX IF NOT EXISTS patient_addresses_patient_idx
  ON public.patient_addresses (patient_id, created_at DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE public.patient_addresses ENABLE ROW LEVEL SECURITY;

-- El dueño tiene CRUD completo de sus propias direcciones.
CREATE POLICY "owner_select_own_addresses" ON public.patient_addresses
  FOR SELECT USING (patient_id = auth.uid());

CREATE POLICY "owner_insert_own_addresses" ON public.patient_addresses
  FOR INSERT WITH CHECK (patient_id = auth.uid());

CREATE POLICY "owner_update_own_addresses" ON public.patient_addresses
  FOR UPDATE USING (patient_id = auth.uid()) WITH CHECK (patient_id = auth.uid());

CREATE POLICY "owner_delete_own_addresses" ON public.patient_addresses
  FOR DELETE USING (patient_id = auth.uid());

-- Backfill: todo paciente con profiles.address no vacío recibe una dirección
-- principal con ese texto, para que "Mis direcciones" no arranque vacío.
INSERT INTO public.patient_addresses (patient_id, etiqueta, direccion, principal)
SELECT p.id, 'Casa', trim(p.address), true
FROM public.profiles p
WHERE p.address IS NOT NULL
  AND trim(p.address) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM public.patient_addresses pa WHERE pa.patient_id = p.id
  );
