-- Migration 130: consolida la regla "el paciente ya se atendió con un
-- profesional de Healthier" en una única función, y retira
-- pharmacy_products.requires_prescription ahora que ningún lector de esa
-- tabla lo usa (prescription_type lo reemplazó — ver 129).

-- ── 1. Una sola definición de la regla, usada por la RLS y por el cliente ──
-- (mismo patrón que get_my_role() en 000_funciones_base.sql). No necesita
-- SECURITY DEFINER: el paciente ya puede leer sus propias consultations por
-- RLS, así que no hay recursión que romper — a diferencia de profiles.
create or replace function public.patient_has_completed_consultation()
returns boolean
language sql
stable
as $function$
  select exists (
    select 1 from public.consultations
    where patient_id = auth.uid() and status = 'completed'
  );
$function$;

comment on function public.patient_has_completed_consultation() is
  'Único lugar donde vive "el paciente ya se atendió con un profesional de Healthier". La usan la policy de INSERT en medication_orders y pharmacyService.hasBeenAttended() vía supabase.rpc(), para no tener el mismo predicado escrito dos veces (RLS y JS) con riesgo de que diverjan.';

DROP POLICY IF EXISTS "medication_orders_patient_insert_own" ON public.medication_orders;
CREATE POLICY "medication_orders_patient_insert_own"
  ON public.medication_orders FOR INSERT
  WITH CHECK (
    patient_id = auth.uid()
    AND public.patient_has_completed_consultation()
  );

-- ── 2. Retira requires_prescription de pharmacy_products ────────────────────
-- Ningún lector queda: Catálogo, Excel y el carrito del paciente ya leen
-- prescription_type directo (ver 129 + Pharmacy.jsx). El único lugar que
-- todavía copiaba requires_prescription era el snapshot que arma el carrito
-- al ir a checkout — pasa a derivarlo de prescription_type en el mismo commit
-- que esta migración, así que no queda ningún lector de la columna.
DROP TRIGGER IF EXISTS pharmacy_products_sync_requires_prescription ON public.pharmacy_products;
DROP FUNCTION IF EXISTS public.pharmacy_products_sync_requires_prescription();
ALTER TABLE public.pharmacy_products DROP COLUMN IF EXISTS requires_prescription;
