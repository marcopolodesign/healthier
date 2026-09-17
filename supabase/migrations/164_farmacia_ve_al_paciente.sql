-- La farmacia no sabía a quién le entregaba.
--
-- `medication_orders` tiene `patient_id` cargado y la farmacia puede leer el
-- pedido (policy `medication_orders_pharmacy_staff_select`, migración 106),
-- pero el nombre vive en `profiles`, y ahí la farmacia no tiene ningún permiso.
-- El join de PostgREST devolvía `patient: null` sin error, así que la columna
-- "Paciente" del panel salía con un guion y nadie se enteraba de por qué.
-- Encontrado el 2026-09-17 recorriendo el módulo entero.
--
-- 🔴 No se abre `profiles` con una policy: eso le daría a la farmacia la fila
-- COMPLETA del paciente —grupo sanguíneo, DNI, alergias, domicilio—, que es
-- justo lo que la migración 140 se ocupó de no exponer. RLS no filtra
-- columnas, así que la herramienta correcta es una vista que exponga sólo lo
-- que hace falta para entregar un pedido: nombre y teléfono.
--
-- La vista es SECURITY DEFINER (`security_invoker = false`), o sea que se
-- saltea la RLS de `profiles` — por eso el filtro de rol va ADENTRO de la
-- vista. Sin ese filtro, cualquier usuario autenticado leería el nombre de
-- todos los pacientes que alguna vez compraron algo.

CREATE OR REPLACE VIEW public.pharmacy_order_patients
WITH (security_invoker = false) AS
SELECT
  p.id,
  p.full_name,
  p.phone
FROM public.profiles p
WHERE
  -- Sólo el personal de farmacia (y el super admin) ve algo acá.
  public.get_my_role() IN ('pharmacy_admin', 'pharmacy_operator', 'pharmacy_readonly', 'super_admin')
  -- Y sólo de pacientes que efectivamente tienen un pedido.
  AND EXISTS (
    SELECT 1 FROM public.medication_orders o WHERE o.patient_id = p.id
  );

COMMENT ON VIEW public.pharmacy_order_patients IS
  'Nombre y teléfono de los pacientes con pedidos de farmacia, para que la '
  'farmacia sepa a quién le entrega. Sólo esas dos columnas a propósito: la '
  'fila completa de profiles tiene datos de salud que la farmacia no necesita. '
  'El filtro de rol vive adentro de la vista porque es SECURITY DEFINER.';

REVOKE ALL ON public.pharmacy_order_patients FROM anon;
GRANT SELECT ON public.pharmacy_order_patients TO authenticated;
