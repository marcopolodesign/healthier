-- ============================================================
-- Migración 157 — El pago de la emergencia
-- ============================================================
-- El cobro va PRIMERO (reunión 2026-09-11): el paciente preautoriza un monto
-- fijo con Mercado Pago y recién después contesta el triage y entra a la cola
-- de la entidad. Hasta hoy `emergencies` guardaba `price_at_request` y
-- `payment_method_id` (migración 086) pero **nunca se cobraba nada**: no había
-- una fila de `payments` para una emergencia porque el XOR de la 107 sólo
-- admitía consulta-o-pedido.
--
-- Tercera rama del XOR, mismo patrón que la de farmacia: la emergencia la
-- cobra la ENTIDAD que despacha, igual que el pedido lo cobra la farmacia.
-- ============================================================

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS emergency_id uuid REFERENCES public.emergencies(id),
  ADD COLUMN IF NOT EXISTS provider_id  uuid REFERENCES public.emergency_providers(id);

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_beneficiary_xor;

ALTER TABLE public.payments
  ADD CONSTRAINT payments_beneficiary_xor CHECK (
    (consultation_id IS NOT NULL AND professional_id IS NOT NULL
     AND order_id IS NULL AND pharmacy_id IS NULL
     AND emergency_id IS NULL AND provider_id IS NULL)
    OR
    (order_id IS NOT NULL AND pharmacy_id IS NOT NULL
     AND consultation_id IS NULL AND professional_id IS NULL
     AND emergency_id IS NULL AND provider_id IS NULL)
    OR
    -- La emergencia se cobra sin entidad asignada todavía: el cobro pasa ANTES
    -- de que el despacho la tome, así que `provider_id` puede venir en NULL y
    -- se completa al asignar. Exigirlo acá volvería imposible el orden que se
    -- acordó.
    (emergency_id IS NOT NULL
     AND consultation_id IS NULL AND professional_id IS NULL
     AND order_id IS NULL AND pharmacy_id IS NULL)
  );

CREATE INDEX IF NOT EXISTS idx_payments_emergency_id
  ON public.payments(emergency_id) WHERE emergency_id IS NOT NULL;

-- La entidad ve los cobros de sus emergencias — sin esto el operador no puede
-- saber si lo que tiene en la cola está pago.
CREATE POLICY "payments_select_emergency_staff"
  ON public.payments FOR SELECT
  USING (
    emergency_id IS NOT NULL
    AND public.get_my_role() IN ('emergency_admin', 'emergency_operator')
  );
