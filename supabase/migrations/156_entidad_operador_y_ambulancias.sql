-- ============================================================
-- Migración 156 — La entidad de emergencias, el operador y las ambulancias
-- ============================================================
-- Reunión del 2026-09-11 con Nacho y Macarena (Read AI "Flujo de Emergencias
-- y Despacho"). El flujo acordado es:
--
--   pedido → cobro (preautorización, monto fijo) → triage → LA ENTIDAD lo ve
--   en su panel → un OPERADOR asigna a mano una AMBULANCIA → traslado.
--
-- Lo que había hasta hoy: `emergencies` sorteaba un profesional al azar entre
-- los de medicina general on-demand y lo despachaba en el mismo insert. No
-- existía la entidad, ni el operador, ni la ambulancia — "ambulancia" era una
-- palabra del copy (catchup 2026-09-11 (7)) sin nada detrás.
--
-- Por qué la asignación es MANUAL y no por GPS: Macarena fue explícita en que
-- la ambulancia más cercana NO es la más rápida — el tránsito manda, y eso
-- sólo lo sabe el despachante. El mapa en vivo es para que decida mejor, no
-- para decidir por él.
--
-- Multi-entidad desde el día uno (a diferencia de farmacias, que es
-- single-tenant): Macarena propuso interoperar con CEDI, con identificadores
-- visuales para distinguir financiadores. Que aparezca una segunda entidad no
-- es hipotético, así que el scoping por entidad va ahora — cuesta una tabla de
-- staff y una función, y evita reescribir las RLS después.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Roles nuevos — mismo patrón que los de farmacia (migración 103)
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN (
    'patient', 'professional', 'admin', 'super_admin',
    'pharmacy_admin', 'pharmacy_operator', 'pharmacy_readonly',
    'emergency_admin', 'emergency_operator'
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
    'emergency_admin', 'emergency_operator'
  ) THEN
    RAISE EXCEPTION 'invalid role: %', new_role;
  END IF;
  UPDATE profiles SET role = new_role WHERE lower(email) = lower(target_email);
END;
$$;

-- ────────────────────────────────────────────────────────────
-- 2. emergency_providers — la entidad que despacha
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.emergency_providers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  legal_name    text,
  -- Identificador visual: Macarena pidió poder distinguir de un vistazo de
  -- qué financiador/entidad viene cada solicitud cuando conviven varias.
  color         text NOT NULL DEFAULT '#DC2626',
  phone         text,
  address       text,
  -- Teléfono de guardia: los códigos ROJO tienen que tener a alguien del otro
  -- lado. Es lo que se le muestra al paciente, no el celular del chofer.
  dispatch_phone text,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.emergency_providers (id, name, legal_name, dispatch_phone)
VALUES (
  '20000000-0000-0000-0000-000000000001',
  'Emergencias Healthier',
  'Emergencias Healthier MVP',
  NULL
)
ON CONFLICT (id) DO NOTHING;

CREATE TRIGGER emergency_providers_updated_at
  BEFORE UPDATE ON public.emergency_providers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ────────────────────────────────────────────────────────────
-- 3. emergency_provider_staff — quién trabaja en qué entidad
-- ────────────────────────────────────────────────────────────
-- El rol (admin/operador) vive en profiles.role como en farmacias; acá vive a
-- QUÉ entidad pertenece. Separado a propósito: una persona puede dejar una
-- entidad sin perder su rol, y el día que haya dos entidades no hay que tocar
-- ninguna policy.
CREATE TABLE IF NOT EXISTS public.emergency_provider_staff (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.emergency_providers(id) ON DELETE CASCADE,
  profile_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_emergency_provider_staff_profile
  ON public.emergency_provider_staff(profile_id) WHERE active;

-- SECURITY DEFINER, igual que get_my_role(): si las policies consultaran
-- emergency_provider_staff directo, cualquier policy sobre esa misma tabla
-- entraría en recursión (42P17). Es la invariante de RLS del proyecto.
CREATE OR REPLACE FUNCTION public.mi_entidad_de_emergencias()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT provider_id
    FROM public.emergency_provider_staff
   WHERE profile_id = auth.uid() AND active
   LIMIT 1;
$$;

-- ────────────────────────────────────────────────────────────
-- 4. ambulances — el móvil como objeto propio
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ambulances (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.emergency_providers(id) ON DELETE CASCADE,
  -- Cómo la llama el despacho por radio ("Móvil 12"). Es lo que se ve en el
  -- mapa y lo que se le dice al paciente; la patente es el dato legal.
  label       text NOT NULL,
  plate       text,
  unit_type   text NOT NULL DEFAULT 'movil_medico'
              CHECK (unit_type IN ('uti_movil', 'movil_medico', 'traslado')),
  -- Estado operativo que administra la propia entidad. NO es el estado del
  -- traslado (ese vive en emergencies.status): una ambulancia puede estar
  -- 'disponible' y no tener ninguna emergencia encima.
  status      text NOT NULL DEFAULT 'fuera_de_servicio'
              CHECK (status IN ('disponible', 'en_servicio', 'fuera_de_servicio')),
  active      boolean NOT NULL DEFAULT true,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ambulances_provider ON public.ambulances(provider_id) WHERE active;

CREATE TRIGGER ambulances_updated_at
  BEFORE UPDATE ON public.ambulances
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ────────────────────────────────────────────────────────────
-- 5. ambulance_crew — los profesionales asignados al móvil
-- ────────────────────────────────────────────────────────────
-- Pedido textual de Mateo: "tener la ambulancia como otro objeto también, que
-- se le pueden asignar profesionales".
--
-- `profile_id` apunta a profiles, no a professional_profiles: el chofer y el
-- enfermero no tienen matrícula y no son "profesionales" de la plataforma,
-- pero sí son quienes llevan el teléfono que reporta la ubicación. El médico
-- sí tiene que ser un professional verificado — eso lo chequea el front al
-- asignar, no un FK, porque el mismo registro sirve para los tres roles.
CREATE TABLE IF NOT EXISTS public.ambulance_crew (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ambulance_id  uuid NOT NULL REFERENCES public.ambulances(id) ON DELETE CASCADE,
  profile_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  crew_role     text NOT NULL CHECK (crew_role IN ('medico', 'enfermero', 'chofer')),
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Una persona no puede estar dos veces activa en el mismo móvil. Parcial: el
-- histórico de asignaciones cerradas se conserva.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ambulance_crew_activa
  ON public.ambulance_crew(ambulance_id, profile_id) WHERE active;

CREATE INDEX IF NOT EXISTS idx_ambulance_crew_profile
  ON public.ambulance_crew(profile_id) WHERE active;

-- ¿La persona logueada es tripulación de esta ambulancia, ahora mismo?
-- Mismo motivo que arriba: se la llama desde policies de ambulances,
-- ambulance_locations y emergencies.
CREATE OR REPLACE FUNCTION public.soy_tripulacion(amb_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.ambulance_crew
     WHERE ambulance_id = amb_id AND profile_id = auth.uid() AND active
  );
$$;

-- ────────────────────────────────────────────────────────────
-- 6. ambulance_locations — dónde está cada móvil, en vivo
-- ────────────────────────────────────────────────────────────
-- Una fila por ambulancia, siempre la última posición (upsert). La publica el
-- teléfono de quien está asignado al móvil — así lo pidió Mateo, y es lo que
-- se decidió en la reunión antes que el GPS de Dega: primero probamos con los
-- teléfonos y nuestra propia plataforma.
--
-- Se separa de `emergency_tracking` (migración 149) a propósito: aquella es el
-- traslado de UNA emergencia y se borra al terminar. Esta es la flota, y tiene
-- que existir ANTES de que haya una emergencia — es justamente lo que el
-- operador necesita mirar para decidir a quién manda.
CREATE TABLE IF NOT EXISTS public.ambulance_locations (
  ambulance_id uuid PRIMARY KEY REFERENCES public.ambulances(id) ON DELETE CASCADE,
  profile_id   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  latitude     numeric(10,7) NOT NULL,
  longitude    numeric(10,7) NOT NULL,
  heading      numeric(5,1),
  speed_kmh    numeric(5,1),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER ambulance_locations_updated_at
  BEFORE UPDATE ON public.ambulance_locations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ────────────────────────────────────────────────────────────
-- 7. emergencies — entidad, ambulancia, operador y el cobro
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.emergencies
  ADD COLUMN IF NOT EXISTS provider_id   uuid REFERENCES public.emergency_providers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ambulance_id  uuid REFERENCES public.ambulances(id) ON DELETE SET NULL,
  -- Quién la asignó. Sin esto no hay forma de saber quién despachó qué, que es
  -- lo primero que se pregunta cuando algo sale mal.
  ADD COLUMN IF NOT EXISTS operator_id   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS dispatched_at timestamptz,
  -- El cobro va ANTES del triage (reunión del 2026-09-11). `paid_at` es la
  -- marca de que la preautorización salió bien; sin ella la solicitud no entra
  -- a la cola de la entidad.
  ADD COLUMN IF NOT EXISTS paid_at       timestamptz,
  ADD COLUMN IF NOT EXISTS preauth_id    text;

-- Estado nuevo: `awaiting_dispatch` = pagada y triada, esperando que la
-- entidad le asigne un móvil. Es el estado que faltaba — antes se pasaba de
-- 'pending' a 'dispatched' en el mismo insert porque no había nadie en el
-- medio.
ALTER TABLE public.emergencies DROP CONSTRAINT IF EXISTS emergencies_status_check;
ALTER TABLE public.emergencies
  ADD CONSTRAINT emergencies_status_check
  CHECK (status IN (
    'pending', 'awaiting_dispatch', 'dispatched',
    'in_transit', 'arrived', 'completed', 'cancelled'
  ));

CREATE INDEX IF NOT EXISTS idx_emergencies_cola
  ON public.emergencies(provider_id, created_at)
  WHERE status = 'awaiting_dispatch';

CREATE INDEX IF NOT EXISTS idx_emergencies_ambulance
  ON public.emergencies(ambulance_id, created_at DESC);

-- ────────────────────────────────────────────────────────────
-- 8. Helper — a qué entidad pertenece una ambulancia
-- ────────────────────────────────────────────────────────────
-- SECURITY DEFINER y no un subselect dentro de la policy: un `EXISTS (SELECT
-- ... FROM ambulances ...)` escrito dentro de una policy se evalúa CON la RLS
-- de `ambulances` puesta, así que a quien todavía no pasó esa policy le da
-- vacío y el permiso se niega sin ningún error visible. Es la misma trampa que
-- get_my_role() resuelve para profiles.
CREATE OR REPLACE FUNCTION public.entidad_de_ambulancia(amb_id uuid)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT provider_id FROM public.ambulances WHERE id = amb_id;
$$;

-- ¿Soy el paciente de una emergencia que tiene asignada esta ambulancia?
-- Lo necesita el paciente para ver el móvil y su posición mientras va hacia él.
CREATE OR REPLACE FUNCTION public.soy_paciente_de_ambulancia(amb_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.emergencies
     WHERE ambulance_id = amb_id
       AND patient_id = auth.uid()
       AND status IN ('dispatched', 'in_transit', 'arrived')
  );
$$;

-- ────────────────────────────────────────────────────────────
-- 9. RLS
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.emergency_providers      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emergency_provider_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ambulances               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ambulance_crew           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ambulance_locations      ENABLE ROW LEVEL SECURITY;

-- ── emergency_providers ───────────────────────────────────────
-- Lectura abierta a autenticados: el paciente tiene que ver de qué entidad es
-- la ambulancia que le mandaron. La tabla no guarda nada sensible.
CREATE POLICY "providers_read" ON public.emergency_providers
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "providers_update_admin" ON public.emergency_providers
  FOR UPDATE TO authenticated
  USING (
    public.get_my_role() = 'super_admin'
    OR (public.get_my_role() = 'emergency_admin' AND id = public.mi_entidad_de_emergencias())
  )
  WITH CHECK (
    public.get_my_role() = 'super_admin'
    OR (public.get_my_role() = 'emergency_admin' AND id = public.mi_entidad_de_emergencias())
  );

-- Dar de alta o de baja una entidad es del super admin. Una entidad que se
-- borra sola se lleva puestas sus ambulancias y sus emergencias históricas.
CREATE POLICY "providers_insert_super_admin" ON public.emergency_providers
  FOR INSERT TO authenticated WITH CHECK (public.get_my_role() = 'super_admin');

CREATE POLICY "providers_delete_super_admin" ON public.emergency_providers
  FOR DELETE TO authenticated USING (public.get_my_role() = 'super_admin');

-- ── emergency_provider_staff ──────────────────────────────────
CREATE POLICY "provider_staff_read" ON public.emergency_provider_staff
  FOR SELECT TO authenticated
  USING (
    profile_id = auth.uid()
    OR public.get_my_role() = 'super_admin'
    OR provider_id = public.mi_entidad_de_emergencias()
  );

CREATE POLICY "provider_staff_write" ON public.emergency_provider_staff
  FOR ALL TO authenticated
  USING (
    public.get_my_role() = 'super_admin'
    OR (public.get_my_role() = 'emergency_admin' AND provider_id = public.mi_entidad_de_emergencias())
  )
  WITH CHECK (
    public.get_my_role() = 'super_admin'
    OR (public.get_my_role() = 'emergency_admin' AND provider_id = public.mi_entidad_de_emergencias())
  );

-- ── ambulances ────────────────────────────────────────────────
CREATE POLICY "ambulances_read" ON public.ambulances
  FOR SELECT TO authenticated
  USING (
    public.get_my_role() = 'super_admin'
    OR provider_id = public.mi_entidad_de_emergencias()
    OR public.soy_tripulacion(id)
    OR public.soy_paciente_de_ambulancia(id)
  );

-- El operador también puede escribir: poner un móvil en servicio o sacarlo es
-- trabajo de despacho, no de administración.
CREATE POLICY "ambulances_write" ON public.ambulances
  FOR ALL TO authenticated
  USING (
    public.get_my_role() = 'super_admin'
    OR (public.get_my_role() IN ('emergency_admin', 'emergency_operator')
        AND provider_id = public.mi_entidad_de_emergencias())
  )
  WITH CHECK (
    public.get_my_role() = 'super_admin'
    OR (public.get_my_role() IN ('emergency_admin', 'emergency_operator')
        AND provider_id = public.mi_entidad_de_emergencias())
  );

-- ── ambulance_crew ────────────────────────────────────────────
CREATE POLICY "crew_read" ON public.ambulance_crew
  FOR SELECT TO authenticated
  USING (
    profile_id = auth.uid()
    OR public.get_my_role() = 'super_admin'
    OR public.entidad_de_ambulancia(ambulance_id) = public.mi_entidad_de_emergencias()
  );

CREATE POLICY "crew_write" ON public.ambulance_crew
  FOR ALL TO authenticated
  USING (
    public.get_my_role() = 'super_admin'
    OR (public.get_my_role() IN ('emergency_admin', 'emergency_operator')
        AND public.entidad_de_ambulancia(ambulance_id) = public.mi_entidad_de_emergencias())
  )
  WITH CHECK (
    public.get_my_role() = 'super_admin'
    OR (public.get_my_role() IN ('emergency_admin', 'emergency_operator')
        AND public.entidad_de_ambulancia(ambulance_id) = public.mi_entidad_de_emergencias())
  );

-- ── ambulance_locations ───────────────────────────────────────
CREATE POLICY "ambulance_locations_read" ON public.ambulance_locations
  FOR SELECT TO authenticated
  USING (
    public.get_my_role() = 'super_admin'
    OR public.entidad_de_ambulancia(ambulance_id) = public.mi_entidad_de_emergencias()
    OR public.soy_tripulacion(ambulance_id)
    OR public.soy_paciente_de_ambulancia(ambulance_id)
  );

-- Sólo la tripulación publica: la posición sale del teléfono de quien está
-- arriba del móvil. Que la pudiera escribir el despacho sería poder mover un
-- punto en el mapa sin que la ambulancia se haya movido.
CREATE POLICY "ambulance_locations_write" ON public.ambulance_locations
  FOR ALL TO authenticated
  USING (public.soy_tripulacion(ambulance_id) OR public.get_my_role() = 'super_admin')
  WITH CHECK (public.soy_tripulacion(ambulance_id) OR public.get_my_role() = 'super_admin');

-- ── emergencies — la entidad y la tripulación ─────────────────
-- El operador ve la cola de SU entidad, y también las que todavía no tienen
-- entidad asignada: una solicitud recién pagada entra sin dueño y alguien la
-- tiene que poder ver para tomarla.
CREATE POLICY "emergency_provider_select" ON public.emergencies
  FOR SELECT TO authenticated
  USING (
    public.get_my_role() IN ('emergency_admin', 'emergency_operator')
    AND (provider_id = public.mi_entidad_de_emergencias() OR provider_id IS NULL)
  );

CREATE POLICY "emergency_provider_update" ON public.emergencies
  FOR UPDATE TO authenticated
  USING (
    public.get_my_role() IN ('emergency_admin', 'emergency_operator')
    AND (provider_id = public.mi_entidad_de_emergencias() OR provider_id IS NULL)
  )
  WITH CHECK (
    public.get_my_role() IN ('emergency_admin', 'emergency_operator')
    AND provider_id = public.mi_entidad_de_emergencias()
  );

-- La tripulación ve y mueve la emergencia de su móvil. Antes esto sólo lo
-- podía hacer `professional_id`, o sea el médico: el chofer y el enfermero no
-- veían nada, y son los que más veces tienen el teléfono en la mano.
CREATE POLICY "emergency_crew_select" ON public.emergencies
  FOR SELECT TO authenticated
  USING (ambulance_id IS NOT NULL AND public.soy_tripulacion(ambulance_id));

CREATE POLICY "emergency_crew_update" ON public.emergencies
  FOR UPDATE TO authenticated
  USING (ambulance_id IS NOT NULL AND public.soy_tripulacion(ambulance_id))
  WITH CHECK (ambulance_id IS NOT NULL AND public.soy_tripulacion(ambulance_id));

-- ────────────────────────────────────────────────────────────
-- 10. Realtime — el mapa del operador se mueve solo
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.ambulance_locations REPLICA IDENTITY FULL;
ALTER TABLE public.ambulances          REPLICA IDENTITY FULL;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ambulance_locations', 'ambulances'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

COMMENT ON TABLE public.emergency_providers IS
  'La entidad que despacha ambulancias. Multi-entidad desde el día uno: la interoperación con CEDI ya está planteada (reunión 2026-09-11).';
COMMENT ON TABLE public.ambulance_locations IS
  'Última posición de cada móvil, publicada por el teléfono de su tripulación. Distinta de emergency_tracking, que es el traslado de UNA emergencia y se borra al terminar.';
