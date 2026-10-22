-- ============================================================
-- Migration 211 — S.O.S.: dirección escrita + ubicación de la flota de guardia
-- ============================================================
-- Mateo, 2026-10-22:
--   1. "GPS + dirección escrita": al pedir el S.O.S. el paciente confirma o
--      corrige una dirección (precargada con la del GPS o con una guardada),
--      con piso/depto y referencias. El punto del mapa sale de la dirección
--      confirmada (geocodificada); si el paciente no la tocó, del GPS.
--   2. La ambulancia comparte su ubicación mientras está de guardia
--      (Disponible o En servicio), haya o no traslado, para que el despacho la
--      vea en el mapa y elija por cercanía.
--
-- `patient_latitude/longitude` sigue siendo EL punto del pedido (lo que leen
-- la cola, el mapa, la ruta del médico): no cambia ningún lector existente.
-- El GPS crudo queda aparte para que el despacho vea si el teléfono marcaba
-- otro lugar que la dirección escrita.
-- ============================================================

ALTER TABLE public.emergencies
  ADD COLUMN IF NOT EXISTS direccion             text          NULL,
  ADD COLUMN IF NOT EXISTS direccion_piso        text          NULL,
  ADD COLUMN IF NOT EXISTS direccion_referencias text          NULL,
  ADD COLUMN IF NOT EXISTS gps_latitude          numeric(10,7) NULL,
  ADD COLUMN IF NOT EXISTS gps_longitude         numeric(10,7) NULL,
  ADD COLUMN IF NOT EXISTS ubicacion_origen      text          NULL;

-- Texto libre del paciente: con tope, para que nadie guarde un libro.
ALTER TABLE public.emergencies DROP CONSTRAINT IF EXISTS emergencies_direccion_largo;
ALTER TABLE public.emergencies ADD CONSTRAINT emergencies_direccion_largo CHECK (
  coalesce(char_length(direccion), 0) <= 300
  AND coalesce(char_length(direccion_piso), 0) <= 60
  AND coalesce(char_length(direccion_referencias), 0) <= 500
);

ALTER TABLE public.emergencies DROP CONSTRAINT IF EXISTS emergencies_ubicacion_origen_check;
ALTER TABLE public.emergencies ADD CONSTRAINT emergencies_ubicacion_origen_check
  CHECK (ubicacion_origen IS NULL OR ubicacion_origen IN ('gps', 'direccion'));

COMMENT ON COLUMN public.emergencies.direccion IS
  'Dirección que el paciente confirmó o corrigió al pedir el S.O.S. (calle y número, barrio). NULL = pedido anterior a la 211 o sin dirección.';
COMMENT ON COLUMN public.emergencies.direccion_piso IS 'Piso / depto que escribió el paciente.';
COMMENT ON COLUMN public.emergencies.direccion_referencias IS 'Referencias para encontrarlo (timbre, portón, entre calles).';
COMMENT ON COLUMN public.emergencies.gps_latitude IS 'GPS crudo del teléfono al pedir. patient_latitude es el punto que se usa (dirección geocodificada o este mismo).';
COMMENT ON COLUMN public.emergencies.gps_longitude IS 'GPS crudo del teléfono al pedir.';
COMMENT ON COLUMN public.emergencies.ubicacion_origen IS
  'De dónde sale patient_latitude/longitude: gps (el paciente no tocó la dirección o no se pudo ubicar la escrita) o direccion (la escrita, geocodificada).';

-- ── ambulance_locations: sólo un móvil de guardia publica ─────
-- Con la ubicación compartida todo el turno (y en segundo plano), el teléfono
-- de un tripulante sigue latiendo aunque se haya ido a su casa. El límite lo
-- pone el estado del móvil, que administra el despacho: fuera de servicio, la
-- base no acepta posiciones. Es la misma regla que aplica la app, pero acá no
-- depende de qué versión tenga instalada cada uno.
CREATE OR REPLACE FUNCTION public.movil_de_guardia(amb_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.ambulances
     WHERE id = amb_id AND active AND status IN ('disponible', 'en_servicio')
  );
$$;

REVOKE ALL ON FUNCTION public.movil_de_guardia(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.movil_de_guardia(uuid) TO authenticated;

DROP POLICY IF EXISTS "ambulance_locations_write" ON public.ambulance_locations;
CREATE POLICY "ambulance_locations_write" ON public.ambulance_locations
  FOR ALL TO authenticated
  USING (public.get_my_role() = 'super_admin' OR public.soy_tripulacion(ambulance_id))
  WITH CHECK (
    public.get_my_role() = 'super_admin'
    OR (
      public.soy_tripulacion(ambulance_id)
      AND public.movil_de_guardia(ambulance_id)
      -- Se publica a nombre propio: un tripulante no firma con otro.
      AND (profile_id IS NULL OR profile_id = auth.uid())
    )
  );

-- La hora de la posición la pone la base, no el teléfono: un reloj adelantado
-- (o un cliente que la mande a mano) haría ver "en vivo" un punto viejo. El
-- trigger de la 156 ya lo hace en UPDATE; faltaba el INSERT (el primer upsert).
CREATE OR REPLACE FUNCTION public.ambulance_locations_ahora()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
begin
  new.updated_at := now();
  return new;
end;
$$;

DROP TRIGGER IF EXISTS ambulance_locations_ahora ON public.ambulance_locations;
CREATE TRIGGER ambulance_locations_ahora
  BEFORE INSERT ON public.ambulance_locations
  FOR EACH ROW EXECUTE FUNCTION public.ambulance_locations_ahora();

-- ── El paciente no se asigna una ambulancia ─────────────────
-- Con la flota publicando su posición todo el turno, `soy_paciente_de_ambulancia`
-- (156) pasa a valer mucho: quien la cumple ve el móvil en vivo. Y la RLS del
-- paciente sólo exige `patient_id = auth.uid()`, así que podía INSERTAR una
-- emergencia ya `in_transit` con el `ambulance_id` de un móvil (el de una
-- emergencia suya anterior) y seguirlo todos los turnos (revisión de
-- seguridad, 2026-10-22). Lo del despacho lo escribe el despacho (operador,
-- admin, RPC del coordinador) o el servidor; el paciente crea el pedido en
-- `pending` y sin nada asignado, y no toca esas columnas después.
CREATE OR REPLACE FUNCTION public.proteger_despacho_emergencia()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if coalesce(auth.role(), '') not in ('authenticated', 'anon') then
    return new;
  end if;
  if public.get_my_role() in ('super_admin', 'emergency_admin', 'emergency_operator') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status is distinct from 'pending'
       or new.ambulance_id is not null or new.provider_id is not null
       or new.operator_id is not null or new.professional_id is not null
       or new.dispatched_at is not null or new.dispatch_code is not null then
      raise exception 'Un pedido nuevo no puede venir asignado.'
        using errcode = '42501';
    end if;
  elsif new.patient_id = auth.uid()
     -- La tripulación y el médico del móvil sí mueven su emergencia (156/177).
     and not (old.ambulance_id is not null and public.soy_tripulacion(old.ambulance_id))
     and old.professional_id is distinct from auth.uid() then
    if new.ambulance_id is distinct from old.ambulance_id
       or new.provider_id is distinct from old.provider_id
       or new.operator_id is distinct from old.operator_id
       or new.professional_id is distinct from old.professional_id
       or new.dispatched_at is distinct from old.dispatched_at
       or new.dispatch_code is distinct from old.dispatch_code then
      raise exception 'No autorizado para asignar esta emergencia.'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$function$;

DROP TRIGGER IF EXISTS emergencies_proteger_despacho ON public.emergencies;
CREATE TRIGGER emergencies_proteger_despacho BEFORE INSERT OR UPDATE ON public.emergencies
  FOR EACH ROW EXECUTE FUNCTION public.proteger_despacho_emergencia();
