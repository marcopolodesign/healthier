-- ============================================================
-- Migration 068 — Grupo Familiar persistente
-- ============================================================
-- Hasta ahora "Añadir Familiar" en /paciente/perfil guardaba en useState y nada
-- más: el familiar desaparecía al refrescar. El formulario ya pedía todos los
-- datos (nombre, vínculo, DNI, obra social, nº de afiliado), así que lo único
-- que faltaba era dónde ponerlos.
--
-- Es una lista declarativa del titular, NO una cuenta: el familiar no se loguea
-- ni tiene perfil propio. Cuando exista "reservar para un familiar" esta tabla
-- es de dónde sale el selector.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.family_members (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  full_name     text NOT NULL,
  relationship  text,
  dni           text,
  email         text,
  phone         text,
  insurance_name text,
  insurance_num  text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.family_members IS
  'Grupo familiar declarado por un paciente titular. No son usuarios: no se loguean ni tienen profiles propio.';

CREATE INDEX IF NOT EXISTS family_members_patient_idx
  ON public.family_members (patient_id, created_at DESC);

ALTER TABLE public.family_members ENABLE ROW LEVEL SECURITY;

-- El titular es dueño absoluto de su grupo familiar. Nadie más lo ve.
CREATE POLICY "patient_select_own_family" ON public.family_members
  FOR SELECT USING (patient_id = auth.uid());

CREATE POLICY "patient_insert_own_family" ON public.family_members
  FOR INSERT WITH CHECK (patient_id = auth.uid());

CREATE POLICY "patient_update_own_family" ON public.family_members
  FOR UPDATE USING (patient_id = auth.uid()) WITH CHECK (patient_id = auth.uid());

CREATE POLICY "patient_delete_own_family" ON public.family_members
  FOR DELETE USING (patient_id = auth.uid());
