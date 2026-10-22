-- ============================================================
-- Migration 212 — La posición del móvil la publica SÓLO su médico
-- ============================================================
-- Mateo, 2026-10-22 (opción B): con toda la tripulación publicando (211), un
-- chofer o enfermero que no iba arriba del móvil hacía saltar el punto en el
-- mapa del despacho. Ahora publica sólo el médico activo del móvil — el mismo
-- al que el despacho le asigna el traslado (`professional_id`). El resto de la
-- tripulación no escribe posiciones.
--
-- La regla de la 211 se mantiene: móvil de guardia (Disponible / En servicio),
-- a nombre propio y con la hora de la base.
-- ============================================================

CREATE OR REPLACE FUNCTION public.soy_medico_del_movil(amb_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.ambulance_crew
     WHERE ambulance_id = amb_id AND profile_id = auth.uid() AND active AND crew_role = 'medico'
  );
$$;

REVOKE ALL ON FUNCTION public.soy_medico_del_movil(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.soy_medico_del_movil(uuid) TO authenticated;

DROP POLICY IF EXISTS "ambulance_locations_write" ON public.ambulance_locations;
CREATE POLICY "ambulance_locations_write" ON public.ambulance_locations
  FOR ALL TO authenticated
  USING (public.get_my_role() = 'super_admin' OR public.soy_medico_del_movil(ambulance_id))
  WITH CHECK (
    public.get_my_role() = 'super_admin'
    OR (
      public.soy_medico_del_movil(ambulance_id)
      AND public.movil_de_guardia(ambulance_id)
      AND (profile_id IS NULL OR profile_id = auth.uid())
    )
  );
