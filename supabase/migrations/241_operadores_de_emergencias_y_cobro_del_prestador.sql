-- ============================================================
-- Migración 241 — Operadores de emergencias + el cobro va al prestador
-- ============================================================
-- Decisiones de Mateo (2026-11-19), a partir de que Medizin (el prestador,
-- `emergency_providers`; hoy "Emergencias Healthier") va a tripular su móvil
-- con 5 cuentas `operador1..5@healthier.app` que rotan de persona día a día:
--
--   1. El operador hace lo mismo que hoy hace el médico del móvil (llegué,
--      foto, síntomas, cierre con desenlace) pero NO es un profesional:
--      sin verificación, sin ganancias, sin conectar Mercado Pago, sin
--      comisiones. Sin matrícula en el registro; el DNI se chequea contra
--      SISA (REFEPS) en segundo plano, sin frenar, y el resultado lo ve el
--      despacho. La carga de medicación sólo queda habilitada si SISA
--      confirma un médico habilitado.
--   2. El cobro de la emergencia va directo a la cuenta de Mercado Pago del
--      PRESTADOR (no a la del médico), que la conecta UNA vez desde
--      /despacho/configuración con el mismo OAuth que los profesionales.
--   3. Registro del día: con la primera emergencia asignada del día el
--      operador carga nombre, selfie y DNI. El paciente ve nombre y foto
--      (no el DNI); el despacho ve todo.
--
-- Modelo — por qué no un rol nuevo:
--   La cuenta del operador es `profiles.role = 'emergency_crew'` (el rol que
--   ya usan el chofer y el enfermero, migración 160): no tiene fila en
--   `professional_profiles`, así que ningún flujo de profesional la toca
--   (cola de verificación, ganancias, mp_accounts, comisión por profesional,
--   agenda). Lo que lo distingue del chofer es el `crew_role = 'operador'` en
--   `ambulance_crew`. Las policies de `emergencies`, `consultations` y las
--   tablas clínicas ya se atan a `professional_id = auth.uid()` /
--   `soy_tripulacion()` y no al rol, así que el operador cierra una atención
--   exactamente igual que el médico una vez que es `emergencies.professional_id`.
--   Eso lo resuelve el registro del día (ver 4).
--
-- No se renombra ni se toca ninguna tabla/función del flujo de estados.
-- ============================================================

-- ── 1 · La tripulación admite "operador" ───────────────────────────────────
ALTER TABLE public.ambulance_crew DROP CONSTRAINT IF EXISTS ambulance_crew_crew_role_check;
ALTER TABLE public.ambulance_crew
  ADD CONSTRAINT ambulance_crew_crew_role_check
  CHECK (crew_role IN ('medico', 'enfermero', 'chofer', 'operador'));

-- ¿Soy un operador activo de algún móvil? (helper de RLS / RPC)
CREATE OR REPLACE FUNCTION public.soy_operador_de_emergencias()
 RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.ambulance_crew c
      JOIN public.profiles p ON p.id = c.profile_id
     WHERE c.profile_id = auth.uid() AND c.active AND c.crew_role = 'operador'
       AND p.role = 'emergency_crew'
  );
$function$;

-- "Hoy" para el registro del día: el de Buenos Aires, no el de UTC (a las
-- 22:00 locales ya es el día siguiente en UTC y el registro se partiría).
CREATE OR REPLACE FUNCTION public.hoy_en_argentina()
 RETURNS date
 LANGUAGE sql STABLE
 SET search_path TO 'public'
AS $function$
  SELECT (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
$function$;

-- ── 2 · El registro del día ────────────────────────────────────────────────
-- Una fila por cuenta y día: quién es la persona que está detrás de la cuenta
-- hoy. Sin FK al paciente ni a la emergencia: la emergencia se vincula por
-- `professional_id` (la cuenta) y el día.
CREATE TABLE IF NOT EXISTS public.operadores_del_dia (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id        uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  provider_id       uuid REFERENCES public.emergency_providers(id) ON DELETE SET NULL,
  dia               date NOT NULL,
  nombre            text NOT NULL CHECK (char_length(btrim(nombre)) BETWEEN 3 AND 120),
  dni               text NOT NULL CHECK (dni ~ '^[0-9]{7,8}$'),
  -- Selfie en el bucket privado `operadores-dia`: `<profile_id>/<archivo>`.
  foto_path         text NOT NULL,
  -- Resultado del chequeo con SISA (REFEPS) por DNI. Nunca frena nada.
  sisa_estado       text NOT NULL DEFAULT 'pendiente'
                    CHECK (sisa_estado IN ('pendiente', 'habilitado', 'suspendido', 'no_encontrado', 'sin_respuesta')),
  sisa_es_medico    boolean NOT NULL DEFAULT false,
  sisa_profesion    text,
  sisa_matricula    text,
  sisa_nombre       text,
  sisa_detalle      jsonb,
  sisa_chequeado_at timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, dia)
);

CREATE INDEX IF NOT EXISTS operadores_del_dia_provider_dia_idx
  ON public.operadores_del_dia (provider_id, dia DESC);

COMMENT ON TABLE public.operadores_del_dia IS
  'Registro del día de las cuentas operador: nombre, selfie y DNI de la persona que está detrás de la cuenta ese día, y el resultado del chequeo con SISA. El paciente ve sólo nombre y foto (operador_de_mi_emergencia); el DNI lo ven la propia cuenta, el despacho de la entidad y el super admin.';

ALTER TABLE public.operadores_del_dia ENABLE ROW LEVEL SECURITY;

-- Lectura: la propia cuenta, el despacho de la entidad y el super admin.
-- Escritura: ninguna sesión — todo entra por `registrar_operador_del_dia` y
-- el resultado de SISA por `resolver_sisa_operador` (service_role).
DROP POLICY IF EXISTS operadores_del_dia_select ON public.operadores_del_dia;
CREATE POLICY operadores_del_dia_select ON public.operadores_del_dia
  FOR SELECT TO authenticated
  USING (
    profile_id = auth.uid()
    OR public.get_my_role() = 'super_admin'
    OR (public.get_my_role() IN ('emergency_admin', 'emergency_operator')
        AND provider_id IS NOT NULL
        AND provider_id = public.mi_entidad_de_emergencias())
  );

REVOKE ALL ON public.operadores_del_dia FROM anon, authenticated;
GRANT SELECT ON public.operadores_del_dia TO authenticated;

DROP TRIGGER IF EXISTS operadores_del_dia_updated_at ON public.operadores_del_dia;
CREATE TRIGGER operadores_del_dia_updated_at
  BEFORE UPDATE ON public.operadores_del_dia
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 3 · Bucket privado de las selfies ──────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('operadores-dia', 'operadores-dia', false, 5242880,
        ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
ON CONFLICT (id) DO NOTHING;

-- Carpeta = el id de la cuenta.
CREATE OR REPLACE FUNCTION public.cuenta_de_la_carpeta(p_name text)
 RETURNS uuid
 LANGUAGE plpgsql IMMUTABLE
 SET search_path TO 'public'
AS $function$
begin
  return (storage.foldername(p_name))[1]::uuid;
exception when others then
  return null;
end;
$function$;

-- ¿Puedo ver esta selfie? La propia cuenta, el despacho de la entidad, el
-- super admin, y el paciente cuya emergencia atendió esa cuenta ese día.
CREATE OR REPLACE FUNCTION public.puede_ver_foto_de_operador(p_name text)
 RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.cuenta_de_la_carpeta(p_name) = auth.uid()
      OR public.get_my_role() = 'super_admin'
      OR EXISTS (
           SELECT 1 FROM public.operadores_del_dia od
            WHERE od.foto_path = p_name
              AND public.get_my_role() IN ('emergency_admin', 'emergency_operator')
              AND od.provider_id IS NOT NULL
              AND od.provider_id = public.mi_entidad_de_emergencias()
         )
      OR EXISTS (
           SELECT 1
             FROM public.operadores_del_dia od
             JOIN public.emergencies e
               ON e.professional_id = od.profile_id
              AND od.dia = (coalesce(e.dispatched_at, e.created_at)
                            AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
            WHERE od.foto_path = p_name
              AND e.patient_id = auth.uid()
         );
$function$;

DROP POLICY IF EXISTS "operadores_dia_subir" ON storage.objects;
CREATE POLICY "operadores_dia_subir" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'operadores-dia'
    AND public.cuenta_de_la_carpeta(name) = auth.uid()
    AND public.soy_operador_de_emergencias()
  );

DROP POLICY IF EXISTS "operadores_dia_ver" ON storage.objects;
CREATE POLICY "operadores_dia_ver" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'operadores-dia' AND public.puede_ver_foto_de_operador(name));
-- Sin UPDATE ni DELETE: cada selfie usa un nombre nuevo.

-- ── 4 · Registrar al operador del día ──────────────────────────────────────
-- Un solo paso atómico: guarda el registro y se "adueña" de las emergencias
-- en curso de su móvil que todavía no tienen a nadie en `professional_id`
-- (es lo que le da acceso a cargar la atención y cerrar, igual que al médico).
CREATE OR REPLACE FUNCTION public.registrar_operador_del_dia(p_nombre text, p_dni text, p_foto_path text)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid      uuid := auth.uid();
  v_dni      text := regexp_replace(coalesce(p_dni, ''), '\D', '', 'g');
  v_provider uuid;
  v_id       uuid;
  v_tomadas  integer;
begin
  IF v_uid IS NULL OR NOT public.soy_operador_de_emergencias() THEN
    RAISE EXCEPTION 'Sólo una cuenta de operador registra al operador del día' USING ERRCODE = '42501';
  END IF;
  IF char_length(btrim(coalesce(p_nombre, ''))) < 3 THEN
    RAISE EXCEPTION 'Cargá el nombre y el apellido.' USING ERRCODE = 'check_violation';
  END IF;
  IF v_dni !~ '^[0-9]{7,8}$' THEN
    RAISE EXCEPTION 'El DNI tiene que tener 7 u 8 números.' USING ERRCODE = 'check_violation';
  END IF;
  -- La selfie tiene que estar en la carpeta de ESTA cuenta y existir.
  IF public.cuenta_de_la_carpeta(p_foto_path) IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'La foto no corresponde a esta cuenta.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'operadores-dia' AND o.name = p_foto_path
  ) THEN
    RAISE EXCEPTION 'La foto no se subió.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT public.entidad_de_ambulancia(c.ambulance_id) INTO v_provider
    FROM public.ambulance_crew c
   WHERE c.profile_id = v_uid AND c.active AND c.crew_role = 'operador'
   ORDER BY c.created_at
   LIMIT 1;

  -- Volver a registrarse el mismo día corrige el registro (un DNI mal tipeado)
  -- y reinicia el chequeo con SISA.
  INSERT INTO public.operadores_del_dia (profile_id, provider_id, dia, nombre, dni, foto_path)
  VALUES (v_uid, v_provider, public.hoy_en_argentina(), btrim(p_nombre), v_dni, p_foto_path)
  ON CONFLICT (profile_id, dia) DO UPDATE
     SET nombre = EXCLUDED.nombre, dni = EXCLUDED.dni, foto_path = EXCLUDED.foto_path,
         provider_id = EXCLUDED.provider_id,
         sisa_estado = 'pendiente', sisa_es_medico = false, sisa_profesion = NULL,
         sisa_matricula = NULL, sisa_nombre = NULL, sisa_detalle = NULL, sisa_chequeado_at = NULL
  RETURNING id INTO v_id;

  -- Las emergencias en curso de mi móvil que nadie atiende pasan a mí.
  UPDATE public.emergencies e
     SET professional_id = v_uid
   WHERE e.professional_id IS NULL
     AND e.status IN ('dispatched', 'in_transit', 'arrived')
     AND e.ambulance_id IN (
           SELECT c.ambulance_id FROM public.ambulance_crew c
            WHERE c.profile_id = v_uid AND c.active AND c.crew_role = 'operador'
         );
  GET DIAGNOSTICS v_tomadas = ROW_COUNT;

  -- SISA, en segundo plano y sin frenar: la función escribe el resultado
  -- con `resolver_sisa_operador`.
  PERFORM public.llamar_edge_function('operador-sisa', jsonb_build_object('registroId', v_id));

  RETURN jsonb_build_object('id', v_id, 'emergencias_tomadas', v_tomadas);
end;
$function$;

-- Resultado de SISA: sólo el servidor.
CREATE OR REPLACE FUNCTION public.resolver_sisa_operador(
  p_id uuid, p_estado text, p_es_medico boolean, p_profesion text,
  p_matricula text, p_nombre text, p_detalle jsonb
) RETURNS void
 LANGUAGE sql SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  UPDATE public.operadores_del_dia
     SET sisa_estado = p_estado, sisa_es_medico = coalesce(p_es_medico, false),
         sisa_profesion = p_profesion, sisa_matricula = p_matricula,
         sisa_nombre = p_nombre, sisa_detalle = p_detalle, sisa_chequeado_at = now()
   WHERE id = p_id AND p_estado IN ('habilitado', 'suspendido', 'no_encontrado', 'sin_respuesta');
$function$;

-- Cuando una emergencia recibe móvil sin médico a bordo (professional_id
-- NULL), el operador de ese móvil que ya se registró hoy toma la atención.
-- Trigger y no un cambio a `asignar_emergencia`: no toca el flujo de estados.
CREATE OR REPLACE FUNCTION public.emergencia_toma_operador_del_dia()
 RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  IF NEW.ambulance_id IS NOT NULL AND NEW.professional_id IS NULL
     AND NEW.ambulance_id IS DISTINCT FROM OLD.ambulance_id THEN
    SELECT od.profile_id INTO NEW.professional_id
      FROM public.operadores_del_dia od
      JOIN public.ambulance_crew c
        ON c.profile_id = od.profile_id AND c.ambulance_id = NEW.ambulance_id
       AND c.active AND c.crew_role = 'operador'
     WHERE od.dia = public.hoy_en_argentina()
     ORDER BY od.created_at DESC
     LIMIT 1;
  END IF;
  RETURN NEW;
end;
$function$;

DROP TRIGGER IF EXISTS emergencies_aa_toma_operador_del_dia ON public.emergencies;
CREATE TRIGGER emergencies_aa_toma_operador_del_dia
  BEFORE UPDATE OF ambulance_id, professional_id ON public.emergencies
  FOR EACH ROW EXECUTE FUNCTION public.emergencia_toma_operador_del_dia();

-- ── 5 · Lo que ve el paciente: nombre y foto, NADA más ─────────────────────
CREATE OR REPLACE FUNCTION public.operador_de_mi_emergencia(p_emergency_id uuid)
 RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object('nombre', od.nombre, 'foto_path', od.foto_path)
    FROM public.emergencies e
    JOIN public.operadores_del_dia od
      ON od.profile_id = e.professional_id
     AND od.dia = (coalesce(e.dispatched_at, e.created_at)
                   AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
   WHERE e.id = p_emergency_id
     AND e.patient_id = auth.uid()
   LIMIT 1;
$function$;

-- ── 6 · Recetar: sólo si SISA confirma a un médico habilitado ──────────────
-- Misma función de siempre (116/200) + la rama del operador. Un profesional
-- sigue decidiéndose exactamente como antes; el operador sin fila en
-- `professional_profiles` sólo pasa si hoy tiene registro con SISA "habilitado"
-- y la matrícula figura como médico. Sin registro, con SISA pendiente, sin
-- respuesta o no médico: no se ofrece.
CREATE OR REPLACE FUNCTION public.profesional_puede_recetar(p_professional_id uuid)
 RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(
    (select s.puede_recetar and coalesce(v.herramienta_receta, true)
       from public.professional_profiles pp
       join public.specialties s on s.slug = pp.specialty
       left join public.vertical_settings v on v.id = s.vertical_id
      where pp.user_id = p_professional_id
      limit 1),
    exists (
      select 1 from public.operadores_del_dia od
       where od.profile_id = p_professional_id
         and od.dia = public.hoy_en_argentina()
         and od.sisa_estado = 'habilitado' and od.sisa_es_medico
    ),
    false
  );
$function$;

-- ── 7 · El cobro de la emergencia va a la cuenta de MP del PRESTADOR ───────
-- Misma forma que `pharmacy_mp_accounts` (105): tabla propia, tokens
-- cifrados (tokenCrypto), todas las escrituras por service_role desde la
-- Edge Function `emergency-mp-connect`. A diferencia de farmacia NO tiene
-- policy de lectura: los tokens no salen de la base hacia ninguna sesión; el
-- estado de la conexión se lee con `estado_mp_de_entidad`.
CREATE TABLE IF NOT EXISTS public.emergency_provider_mp_accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id   uuid NOT NULL UNIQUE REFERENCES public.emergency_providers(id) ON DELETE CASCADE,
  mp_user_id    text NOT NULL,
  access_token  text NOT NULL,
  refresh_token text,
  public_key    text,
  mp_nickname   text,
  mp_email      text,
  active        boolean NOT NULL DEFAULT true,
  expires_at    timestamptz,
  live_mode     boolean,
  connected_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  connected_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.emergency_provider_mp_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.emergency_provider_mp_accounts FROM anon, authenticated;

-- A qué cuenta se le cobró cada reserva. Resolver / capturar / liberar una
-- preautorización tiene que usar el MISMO token con el que se creó: una
-- reserva hecha con el token de la plataforma sólo la puede mover ese token,
-- aunque el prestador conecte su cuenta mientras tanto. NULL = la plataforma
-- (todas las filas anteriores a esta migración y los cobros sin cuenta
-- conectada).
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS emergency_provider_id uuid
  REFERENCES public.emergency_providers(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.payments.emergency_provider_id IS
  'Emergencias: prestador cuya cuenta de Mercado Pago cobró esta reserva. NULL = cobró la plataforma. mp-capture usa el token que corresponde a esta columna.';

-- Estado de la conexión, sin tokens. Despacho (de su entidad) y super admin.
CREATE OR REPLACE FUNCTION public.estado_mp_de_entidad(p_provider_id uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_prov uuid := coalesce(p_provider_id, public.mi_entidad_de_emergencias());
  v_row  public.emergency_provider_mp_accounts%rowtype;
begin
  IF v_prov IS NULL THEN
    RETURN jsonb_build_object('conectado', false);
  END IF;
  IF NOT (public.get_my_role() = 'super_admin'
          OR (public.get_my_role() IN ('emergency_admin', 'emergency_operator')
              AND v_prov = public.mi_entidad_de_emergencias())) THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_row FROM public.emergency_provider_mp_accounts WHERE provider_id = v_prov;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('conectado', false, 'provider_id', v_prov);
  END IF;
  RETURN jsonb_build_object(
    'conectado', v_row.active, 'provider_id', v_prov,
    'nickname', v_row.mp_nickname, 'email', v_row.mp_email,
    'live_mode', v_row.live_mode, 'connected_at', v_row.connected_at
  );
end;
$function$;

-- ── 8 · Permisos de las funciones nuevas (nada para anon) ──────────────────
REVOKE ALL ON FUNCTION public.soy_operador_de_emergencias() FROM public, anon;
REVOKE ALL ON FUNCTION public.hoy_en_argentina() FROM public, anon;
REVOKE ALL ON FUNCTION public.cuenta_de_la_carpeta(text) FROM public, anon;
REVOKE ALL ON FUNCTION public.puede_ver_foto_de_operador(text) FROM public, anon;
REVOKE ALL ON FUNCTION public.registrar_operador_del_dia(text, text, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.resolver_sisa_operador(uuid, text, boolean, text, text, text, jsonb) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.emergencia_toma_operador_del_dia() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.operador_de_mi_emergencia(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.estado_mp_de_entidad(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.soy_operador_de_emergencias() TO authenticated;
GRANT EXECUTE ON FUNCTION public.hoy_en_argentina() TO authenticated;
GRANT EXECUTE ON FUNCTION public.cuenta_de_la_carpeta(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.puede_ver_foto_de_operador(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_operador_del_dia(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolver_sisa_operador(uuid, text, boolean, text, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.operador_de_mi_emergencia(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.estado_mp_de_entidad(uuid) TO authenticated;
