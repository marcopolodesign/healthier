-- ============================================================
-- Migration 172 — Amigo Peludo: mascotas del paciente
-- ============================================================
-- Pedido de Nacho, aprobado por Mateo. El paciente carga sus mascotas una
-- sola vez y las reutiliza en cada reserva con la vertical veterinaria — antes
-- (migración 028) `consultations.pet_name`/`pet_species` eran texto libre que
-- se volvía a tipear en cada turno, sin memoria entre consultas.
--
-- No reemplaza esas dos columnas (siguen alimentando pantallas ya construidas
-- alrededor de ellas — comprobante, panel del profesional): se agrega
-- `consultations.pet_id` y el flujo de reserva pasa a completar las tres
-- juntas (id + nombre/especie denormalizados) al elegir de la lista.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.pets (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  nombre           text NOT NULL,
  especie          text NOT NULL DEFAULT 'perro', -- perro | gato | otro
  raza             text,
  fecha_nacimiento date,
  peso_kg          numeric(5,2),
  notas            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);

COMMENT ON TABLE public.pets IS
  'Mascotas declaradas por un paciente titular ("Amigo Peludo"). Baja lógica vía deleted_at.';

CREATE INDEX IF NOT EXISTS pets_owner_idx
  ON public.pets (owner_id, created_at DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE public.pets ENABLE ROW LEVEL SECURITY;

-- El dueño tiene CRUD completo de sus propias mascotas.
CREATE POLICY "owner_select_own_pets" ON public.pets
  FOR SELECT USING (
    owner_id = auth.uid()
    -- El profesional que atendió (o va a atender) a esta mascota la puede ver
    -- — reusa la función SECURITY DEFINER de la migración 005, nunca una
    -- policy que consulte `profiles` directamente.
    OR public.has_shared_consultation(owner_id)
  );

CREATE POLICY "owner_insert_own_pets" ON public.pets
  FOR INSERT WITH CHECK (owner_id = auth.uid());

CREATE POLICY "owner_update_own_pets" ON public.pets
  FOR UPDATE USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

CREATE POLICY "owner_delete_own_pets" ON public.pets
  FOR DELETE USING (owner_id = auth.uid());

-- La consulta veterinaria queda atada a una mascota concreta del dueño.
ALTER TABLE public.consultations
  ADD COLUMN IF NOT EXISTS pet_id uuid NULL REFERENCES public.pets(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.consultations.pet_id IS
  'Mascota elegida en el paso "pet" del wizard de reserva (vertical veterinaria). pet_name/pet_species siguen escribiéndose como snapshot para las pantallas que ya leen esas dos columnas.';
