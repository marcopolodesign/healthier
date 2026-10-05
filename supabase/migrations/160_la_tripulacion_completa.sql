-- ============================================================
-- Migración 160 — La tripulación completa: chofer y enfermero
-- ============================================================
-- Decisión de Mateo (2026-09-12), preguntada porque cambiaba el modelo: la
-- ambulancia acepta profesionales con matrícula **y** choferes/enfermeros sin
-- ella. El motivo es práctico — el teléfono que reporta dónde está el móvil lo
-- lleva casi siempre el chofer, no el médico. Si la tripulación fueran sólo
-- profesionales, el punto del mapa depende de que el médico tenga la app
-- abierta, que es justo lo que no pasa cuando está atendiendo a alguien.
--
-- Tres agujeros que se vieron probando la consola en staging:
--
--   1. El chofer sembrado aparecía en la tripulación como "· chofer", sin
--      nombre: su perfil tiene `role = 'patient'` y ninguna policy de
--      `profiles` deja al despacho leerlo. El dato faltante se veía igual que
--      "todavía no cargó el nombre".
--   2. El buscador para asignar tripulación filtra por rol, así que a un
--      chofer no había forma de encontrarlo para asignarlo.
--   3. `emergency_tracking` (la posición que ve el paciente durante el
--      traslado, migración 149) sólo la puede escribir `professional_id`. Con
--      una tripulación sin médico, el paciente no ve venir a nadie.
-- ============================================================

-- ── 1. Rol propio para la tripulación sin matrícula ───────────────────────
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN (
    'patient', 'professional', 'admin', 'super_admin',
    'pharmacy_admin', 'pharmacy_operator', 'pharmacy_readonly',
    'emergency_admin', 'emergency_operator', 'emergency_crew'
  ));

CREATE OR REPLACE FUNCTION public.promote_user_to_admin(
  target_email text,
  new_role     text DEFAULT 'admin'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'super_admin'
  ) THEN
    RAISE EXCEPTION 'only super_admin can promote';
  END IF;
  IF new_role NOT IN (
    'admin', 'super_admin', 'professional', 'patient',
    'pharmacy_admin', 'pharmacy_operator', 'pharmacy_readonly',
    'emergency_admin', 'emergency_operator', 'emergency_crew'
  ) THEN
    RAISE EXCEPTION 'invalid role: %', new_role;
  END IF;
  UPDATE profiles SET role = new_role WHERE lower(email) = lower(target_email);
END;
$$;

-- ── 2. El despacho ve a su propia gente ───────────────────────────────────
-- Acotado a la entidad: no habilita leer perfiles sueltos, sólo los de quien
-- ya está asignado a un móvil suyo o figura en su staff.
CREATE POLICY "despacho_lee_su_gente" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    public.get_my_role() IN ('emergency_admin', 'emergency_operator')
    AND (
      EXISTS (
        SELECT 1 FROM public.ambulance_crew c
        WHERE c.profile_id = profiles.id
          AND c.active
          AND public.entidad_de_ambulancia(c.ambulance_id) = public.mi_entidad_de_emergencias()
      )
      OR EXISTS (
        SELECT 1 FROM public.emergency_provider_staff s
        WHERE s.profile_id = profiles.id
          AND s.active
          AND s.provider_id = public.mi_entidad_de_emergencias()
      )
      -- Candidatos a tripular: los profesionales verificados y la tripulación
      -- sin matrícula. Un paciente NO entra acá — el buscador de "asignar
      -- tripulante" no puede volverse una lista de pacientes.
      OR profiles.role IN ('professional', 'emergency_crew', 'emergency_admin', 'emergency_operator')
    )
  );

-- ── 3. La tripulación entera publica la posición del traslado ─────────────
-- `professional_id` se sigue escribiendo (es la columna que existe y que lee
-- el paciente), pero deja de significar "el médico": significa "quien de la
-- tripulación está reportando". El `with check` sigue atado a la emergencia
-- real, así que nadie puede publicar contra un traslado ajeno.
DROP POLICY IF EXISTS emergency_tracking_professional_all ON public.emergency_tracking;
CREATE POLICY emergency_tracking_professional_all ON public.emergency_tracking
  FOR ALL
  USING (
    professional_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.emergencies e
      WHERE e.id = emergency_id
        AND e.ambulance_id IS NOT NULL
        AND public.soy_tripulacion(e.ambulance_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.emergencies e
      WHERE e.id = emergency_id
        AND e.patient_id = emergency_tracking.patient_id
        AND (
          e.professional_id = auth.uid()
          OR (e.ambulance_id IS NOT NULL AND public.soy_tripulacion(e.ambulance_id))
        )
    )
  );

-- El despacho también mira el traslado en curso: es su panel.
DROP POLICY IF EXISTS emergency_tracking_despacho_read ON public.emergency_tracking;
CREATE POLICY emergency_tracking_despacho_read ON public.emergency_tracking
  FOR SELECT
  USING (public.get_my_role() IN ('emergency_admin', 'emergency_operator'));

COMMENT ON COLUMN public.emergency_tracking.professional_id IS
  'Quien de la tripulación está reportando la posición — desde la migración 160 puede ser el chofer o el enfermero, no sólo el médico.';
