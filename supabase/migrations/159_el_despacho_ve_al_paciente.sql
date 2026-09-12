-- ============================================================
-- Migración 159 — El despacho tiene que ver quién es el paciente
-- ============================================================
-- Se vio en la primera prueba de la consola: la cola mostraba "Paciente" y
-- ningún teléfono. La fila de `emergencies` llegaba bien, pero el join a
-- `profiles` volvía en NULL porque la única policy que deja leer el perfil de
-- un paciente de emergencia (`pro_read_emergency_patient_profile`, migración
-- 016) exige ser el `professional_id` asignado — y en la cola todavía no hay
-- nadie asignado: justamente por eso está en la cola.
--
-- Un despachante sin el nombre y el teléfono del paciente no puede despachar:
-- lo primero que hace ante un ROJO es llamarlo. Y es el caso donde el dato
-- faltante se ve igual que "todavía no cargó nada", que es la peor forma de
-- fallar.
--
-- Se limita a lo que está abierto: nada de leer perfiles de emergencias ya
-- cerradas o canceladas.
-- ============================================================

CREATE POLICY "despacho_lee_paciente_de_emergencia" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    public.get_my_role() IN ('emergency_admin', 'emergency_operator')
    AND EXISTS (
      SELECT 1 FROM public.emergencies e
      WHERE e.patient_id = profiles.id
        AND e.status NOT IN ('cancelled', 'completed')
    )
  );

-- Y la tripulación igual: el chofer y el enfermero van al domicilio del
-- paciente y hasta hoy no podían ver ni su nombre, porque la policy de la 016
-- es sólo del médico (`professional_id`).
CREATE POLICY "tripulacion_lee_paciente_de_emergencia" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.emergencies e
      WHERE e.patient_id = profiles.id
        AND e.ambulance_id IS NOT NULL
        AND public.soy_tripulacion(e.ambulance_id)
        AND e.status NOT IN ('cancelled', 'completed')
    )
  );
