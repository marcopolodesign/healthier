-- ============================================================
-- Migration 086 — EMERGENCIAS SOS producción
-- ============================================================
-- Auditoría del flujo SOS (2026-08-02) encontró tres bugs que dejaban el
-- backend de emergencias inservible para producción:
--
-- 1) 'completed' se usa en 3 call sites del frontend y en el predicado RLS de
--    016 (`pro_read_emergency_patient_profile`), pero el CHECK de 015 nunca lo
--    incluyó. Cualquier update a status='completed' rompe con 23514.
--
-- 2) `emergencies` nunca se agregó a la publicación `supabase_realtime`
--    (verificado contra pg_publication_tables: solo estaban consultations,
--    ondemand_requests, walk_in_queue). Los dos `subscribe()` de
--    emergencyService.js llevan meses siendo código muerto.
--
-- 3) El único "productor" real de filas en `emergencies` era el mobile
--    (EmergencyService.ts). El website no tiene create(): el paciente nunca
--    escribe un pedido real. Para que website pueda crear un SOS, necesita las
--    mismas columnas que ondemand_requests usa para el pago diferido
--    (price_at_request / payment_method_id, migración 067) — mismo patrón
--    MVP: se registra precio y medio de pago al pedir, sin cobrar todavía.
--
-- Además: el super_admin no tiene forma de ver TODAS las emergencias (solo
-- paciente dueño y profesional asignado pueden hoy). Se agrega usando
-- get_my_role() (SECURITY DEFINER), nunca consultando profiles directo desde
-- una policy — es la invariante de RLS del proyecto (ver CLAUDE.md).
--
-- Nota sobre `emergency_professional_update` (016): se verificó su predicado
-- contra pg_policy — es `USING (professional_id = auth.uid()) WITH CHECK
-- (professional_id = auth.uid())`, sin ninguna restricción sobre `status`. No
-- bloquea 'completed' hoy ni bloqueaba antes: el único obstáculo real era el
-- CHECK constraint de la tabla (bug #1), ya resuelto abajo. No hace falta
-- tocar esta policy.
-- ============================================================

-- ── 1) CHECK constraint — agregar 'completed' ──────────────────
ALTER TABLE public.emergencies DROP CONSTRAINT IF EXISTS emergencies_status_check;
ALTER TABLE public.emergencies
  ADD CONSTRAINT emergencies_status_check
  CHECK (status IN ('pending', 'dispatched', 'in_transit', 'arrived', 'completed', 'cancelled'));

-- ── 2) Realtime — publicar la tabla (mismo patrón que 065/067) ─
ALTER TABLE public.emergencies REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'emergencies'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.emergencies;
  END IF;
END $$;

-- ── 3) Pago diferido — mismas columnas/tipos que ondemand_requests (067) ─
ALTER TABLE public.emergencies
  ADD COLUMN IF NOT EXISTS price_at_request  numeric(10,2),
  ADD COLUMN IF NOT EXISTS payment_method_id uuid REFERENCES public.payment_methods(id) ON DELETE SET NULL;

-- ── 4) Super admin — lectura total, vía get_my_role() (SECURITY DEFINER) ─
CREATE POLICY "emergency_super_admin_select" ON public.emergencies
  FOR SELECT TO authenticated
  USING (public.get_my_role() = 'super_admin');
