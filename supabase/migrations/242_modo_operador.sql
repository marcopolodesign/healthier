-- ============================================================
-- Migración 242 — "Modo operador": la cuenta operadorN actúa como el
-- profesional real de Medizin
-- ============================================================
-- Cambio de modelo de Mateo (2026-11-19), sobre la 241: "que cada profesional
-- pueda asignarse al operador. Se confirma con el DNI al ingresar como
-- operador, pero quiero que tengan todas las funcionalidades que tiene un
-- profesional hoy, para que quede bien el registro (receta incluida)".
--
-- Cómo, de la forma más simple: el mismo mecanismo que ya usa "iniciar sesión
-- como" del super admin (impersonate-user, migración 113): la Edge Function
-- `operador-modo` recibe el DNI de quien está detrás de la cuenta operadorN y,
-- si coincide con un profesional de la lista de la entidad (acá abajo), abre
-- una SESIÓN REAL de ese profesional. Con eso emergencia, consulta, historia
-- clínica, receta (matrícula y firma) y todo lo demás quedan a su nombre sin
-- tocar una sola policy ni la receta: auth.uid() ES el profesional.
--
-- Auditoría: cada ingreso queda en `operador_sesiones_log` con la cuenta
-- operadorN, el profesional, el DNI ingresado y el `session_id` de la sesión
-- (el mismo que lleva el JWT). Así la base sabe, en cualquier momento, que una
-- sesión es "modo operador" (`modo_operador_cuenta()`), la UI esconde
-- ganancias / verificación / conectar MP, y las emergencias llevan
-- `cuenta_operador_id` (por qué cuenta se atendió).
--
-- Si el DNI no está en la lista, todo sigue como en la 241 (registro del día,
-- sin receta).
-- ============================================================

-- ── 1 · La lista de profesionales de la entidad ────────────────────────────
CREATE TABLE IF NOT EXISTS public.emergency_provider_profesionales (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id     uuid NOT NULL REFERENCES public.emergency_providers(id) ON DELETE CASCADE,
  professional_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  active          boolean NOT NULL DEFAULT true,
  added_by        uuid REFERENCES public.profiles(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id, professional_id)
);
CREATE INDEX IF NOT EXISTS emergency_provider_profesionales_prov_idx
  ON public.emergency_provider_profesionales (provider_id) WHERE active;

-- Sólo profesionales reales de Healthier (con su legajo): un paciente o un
-- admin no se puede cargar en la lista.
CREATE OR REPLACE FUNCTION public.validar_profesional_de_entidad()
 RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  IF NOT EXISTS (SELECT 1 FROM public.professional_profiles pp WHERE pp.user_id = NEW.professional_id) THEN
    RAISE EXCEPTION 'Esa persona todavía no tiene cuenta de profesional. Que se dé de alta como profesional y volvé a cargarla.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
end;
$function$;
DROP TRIGGER IF EXISTS emergency_provider_profesionales_validar ON public.emergency_provider_profesionales;
CREATE TRIGGER emergency_provider_profesionales_validar
  BEFORE INSERT ON public.emergency_provider_profesionales
  FOR EACH ROW EXECUTE FUNCTION public.validar_profesional_de_entidad();

ALTER TABLE public.emergency_provider_profesionales ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS emergency_provider_profesionales_all ON public.emergency_provider_profesionales;
CREATE POLICY emergency_provider_profesionales_all ON public.emergency_provider_profesionales
  FOR ALL TO authenticated
  USING (
    public.get_my_role() = 'super_admin'
    OR (public.get_my_role() IN ('emergency_admin', 'emergency_operator')
        AND provider_id = public.mi_entidad_de_emergencias())
  )
  WITH CHECK (
    public.get_my_role() = 'super_admin'
    OR (public.get_my_role() = 'emergency_admin'
        AND provider_id = public.mi_entidad_de_emergencias())
  );
REVOKE ALL ON public.emergency_provider_profesionales FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.emergency_provider_profesionales TO authenticated;
-- (El emergency_operator del despacho sólo lee: el WITH CHECK pide emergency_admin.)

COMMENT ON TABLE public.emergency_provider_profesionales IS
  'Profesionales reales de Healthier que trabajan para el prestador. Si el DNI que ingresa quien está detrás de una cuenta operadorN coincide con uno de ellos, la cuenta actúa ese día como ese profesional (modo operador, migración 242). La cargan el admin del despacho o el super admin.';

-- ── 2 · El log de ingresos en modo operador ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.operador_sesiones_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  professional_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  provider_id     uuid REFERENCES public.emergency_providers(id) ON DELETE SET NULL,
  dni_ingresado   text NOT NULL,
  -- El session_id del JWT del profesional: lo que identifica a la sesión como "modo operador".
  session_id      uuid NOT NULL UNIQUE,
  foto_path       text,
  dia             date NOT NULL DEFAULT public.hoy_en_argentina(),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS operador_sesiones_log_op_dia_idx ON public.operador_sesiones_log (operator_id, dia DESC);
ALTER TABLE public.operador_sesiones_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS operador_sesiones_log_select ON public.operador_sesiones_log;
CREATE POLICY operador_sesiones_log_select ON public.operador_sesiones_log
  FOR SELECT TO authenticated
  USING (
    public.get_my_role() = 'super_admin'
    OR (public.get_my_role() IN ('emergency_admin', 'emergency_operator')
        AND provider_id IS NOT NULL AND provider_id = public.mi_entidad_de_emergencias())
  );
REVOKE ALL ON public.operador_sesiones_log FROM anon, authenticated;
GRANT SELECT ON public.operador_sesiones_log TO authenticated;
-- Sin escritura para ninguna sesión: sólo la Edge Function (service_role). Inmutable.
CREATE OR REPLACE FUNCTION public.operador_sesiones_log_inmutable()
 RETURNS trigger LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  RAISE EXCEPTION 'El log de ingresos en modo operador no se modifica.' USING ERRCODE = '42501';
end;
$function$;
DROP TRIGGER IF EXISTS operador_sesiones_log_no_tocar ON public.operador_sesiones_log;
CREATE TRIGGER operador_sesiones_log_no_tocar
  BEFORE UPDATE OR DELETE ON public.operador_sesiones_log
  FOR EACH ROW EXECUTE FUNCTION public.operador_sesiones_log_inmutable();

-- ── 3 · ¿Esta sesión es "modo operador"? ───────────────────────────────────
-- La cuenta operadorN detrás de la sesión actual (NULL si es una sesión común).
CREATE OR REPLACE FUNCTION public.modo_operador_cuenta()
 RETURNS uuid
 LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT l.operator_id
    FROM public.operador_sesiones_log l
   WHERE l.professional_id = auth.uid()
     AND l.session_id::text = (auth.jwt() ->> 'session_id')
     AND l.dia = public.hoy_en_argentina()
   LIMIT 1;
$function$;

-- Para la UI: esconder ganancias, verificación y conectar MP.
CREATE OR REPLACE FUNCTION public.estoy_en_modo_operador()
 RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN c.cuenta IS NULL THEN jsonb_build_object('activo', false)
              ELSE jsonb_build_object('activo', true, 'cuenta_operador_id', c.cuenta,
                                      'cuenta_operador_email', (SELECT email FROM public.profiles WHERE id = c.cuenta))
         END
    FROM (SELECT public.modo_operador_cuenta() AS cuenta) c;
$function$;

-- ── 4 · El profesional en modo operador es tripulación y "médico" del móvil ─
-- Dos helpers de RLS que ya usan emergencias, ubicación, orden de traslado…
-- Se les suma una rama: la cuenta operadorN detrás de la sesión es tripulante
-- operador de ese móvil. (Y de paso el operador sin modo —registro de la 241—
-- también publica la ubicación del móvil, que quedaba sólo para el 'medico'.)
CREATE OR REPLACE FUNCTION public.soy_tripulacion(amb_id uuid)
 RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.ambulance_crew
     WHERE ambulance_id = amb_id AND active
       AND profile_id IN (auth.uid(), public.modo_operador_cuenta())
  );
$function$;

CREATE OR REPLACE FUNCTION public.soy_medico_del_movil(amb_id uuid)
 RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT coalesce((
    SELECT profile_id = auth.uid()
      FROM public.ambulance_crew
     WHERE ambulance_id = amb_id AND active AND crew_role = 'medico'
     ORDER BY created_at, id
     LIMIT 1
  ), false)
  OR EXISTS (
    SELECT 1 FROM public.ambulance_crew
     WHERE ambulance_id = amb_id AND active AND crew_role = 'operador'
       AND profile_id IN (auth.uid(), public.modo_operador_cuenta())
  );
$function$;

-- ── 5 · La emergencia queda a nombre del profesional ───────────────────────
ALTER TABLE public.emergencies
  ADD COLUMN IF NOT EXISTS cuenta_operador_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.emergencies.cuenta_operador_id IS
  'Cuenta operadorN por la que se atendió (registro del día o modo operador). professional_id es la persona: el profesional real en modo operador, la propia cuenta en el registro de la 241.';

-- Las emergencias en curso del móvil de la cuenta que todavía no tienen a
-- nadie (o están a nombre de la propia cuenta) pasan al profesional. La llama
-- `operador-modo` con la service key.
CREATE OR REPLACE FUNCTION public.tomar_emergencias_en_modo_operador(p_cuenta uuid, p_profesional uuid)
 RETURNS integer
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare n integer;
begin
  UPDATE public.emergencies e
     SET professional_id = p_profesional, cuenta_operador_id = p_cuenta
   WHERE (e.professional_id IS NULL OR e.professional_id = p_cuenta)
     AND e.status IN ('dispatched', 'in_transit', 'arrived')
     AND e.ambulance_id IN (
           SELECT c.ambulance_id FROM public.ambulance_crew c
            WHERE c.profile_id = p_cuenta AND c.active AND c.crew_role = 'operador');
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
end;
$function$;

-- El trigger de la 241: ahora elige entre el registro del día y el modo
-- operador, el más reciente del día, y marca la cuenta.
CREATE OR REPLACE FUNCTION public.emergencia_toma_operador_del_dia()
 RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_prof uuid; v_cuenta uuid;
begin
  IF NEW.ambulance_id IS NOT NULL AND NEW.professional_id IS NULL
     AND NEW.ambulance_id IS DISTINCT FROM OLD.ambulance_id THEN
    SELECT x.profesional, x.cuenta INTO v_prof, v_cuenta FROM (
      SELECT od.profile_id AS profesional, od.profile_id AS cuenta, od.created_at
        FROM public.operadores_del_dia od
        JOIN public.ambulance_crew c ON c.profile_id = od.profile_id AND c.ambulance_id = NEW.ambulance_id
         AND c.active AND c.crew_role = 'operador'
       WHERE od.dia = public.hoy_en_argentina()
      UNION ALL
      SELECT l.professional_id, l.operator_id, l.created_at
        FROM public.operador_sesiones_log l
        JOIN public.ambulance_crew c ON c.profile_id = l.operator_id AND c.ambulance_id = NEW.ambulance_id
         AND c.active AND c.crew_role = 'operador'
       WHERE l.dia = public.hoy_en_argentina()
    ) x ORDER BY x.created_at DESC LIMIT 1;
    IF v_prof IS NOT NULL THEN
      NEW.professional_id := v_prof;
      NEW.cuenta_operador_id := v_cuenta;
    END IF;
  END IF;
  RETURN NEW;
end;
$function$;

-- La toma por el registro de la 241 también deja la cuenta.
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
   ORDER BY c.created_at LIMIT 1;

  INSERT INTO public.operadores_del_dia (profile_id, provider_id, dia, nombre, dni, foto_path)
  VALUES (v_uid, v_provider, public.hoy_en_argentina(), btrim(p_nombre), v_dni, p_foto_path)
  ON CONFLICT (profile_id, dia) DO UPDATE
     SET nombre = EXCLUDED.nombre, dni = EXCLUDED.dni, foto_path = EXCLUDED.foto_path,
         provider_id = EXCLUDED.provider_id,
         sisa_estado = 'pendiente', sisa_es_medico = false, sisa_profesion = NULL,
         sisa_matricula = NULL, sisa_nombre = NULL, sisa_detalle = NULL, sisa_chequeado_at = NULL
  RETURNING id INTO v_id;

  UPDATE public.emergencies e
     SET professional_id = v_uid, cuenta_operador_id = v_uid
   WHERE e.professional_id IS NULL
     AND e.status IN ('dispatched', 'in_transit', 'arrived')
     AND e.ambulance_id IN (
           SELECT c.ambulance_id FROM public.ambulance_crew c
            WHERE c.profile_id = v_uid AND c.active AND c.crew_role = 'operador'
         );
  GET DIAGNOSTICS v_tomadas = ROW_COUNT;

  PERFORM public.llamar_edge_function('operador-sisa', jsonb_build_object('registroId', v_id));
  RETURN jsonb_build_object('id', v_id, 'emergencias_tomadas', v_tomadas);
end;
$function$;

-- ── 6 · Sesiones de modo operador: no sobreviven al día ────────────────────
-- Un teléfono compartido no puede quedar "siendo" el profesional al otro día:
-- cada hora se cierran las sesiones de modo operador de días anteriores.
CREATE OR REPLACE FUNCTION public.cerrar_sesiones_modo_operador_vencidas()
 RETURNS integer
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare n integer;
begin
  DELETE FROM auth.sessions s
   WHERE s.id IN (SELECT l.session_id FROM public.operador_sesiones_log l WHERE l.dia < public.hoy_en_argentina());
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
end;
$function$;
DO $$ BEGIN
  PERFORM cron.unschedule('cerrar-sesiones-modo-operador');
EXCEPTION WHEN others THEN NULL; END $$;
SELECT cron.schedule('cerrar-sesiones-modo-operador', '7 * * * *', 'select public.cerrar_sesiones_modo_operador_vencidas()');

-- ── 7 · Permisos ───────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.modo_operador_cuenta() FROM public, anon;
REVOKE ALL ON FUNCTION public.estoy_en_modo_operador() FROM public, anon;
REVOKE ALL ON FUNCTION public.tomar_emergencias_en_modo_operador(uuid, uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.cerrar_sesiones_modo_operador_vencidas() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.validar_profesional_de_entidad() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.operador_sesiones_log_inmutable() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.modo_operador_cuenta() TO authenticated;
GRANT EXECUTE ON FUNCTION public.estoy_en_modo_operador() TO authenticated;
GRANT EXECUTE ON FUNCTION public.tomar_emergencias_en_modo_operador(uuid, uuid) TO service_role;

-- service_role escribe el log (Edge Function `operador-modo`) y usa el helper
-- de "hoy" en el default de `dia`.
GRANT SELECT, INSERT ON public.operador_sesiones_log TO service_role;
GRANT EXECUTE ON FUNCTION public.hoy_en_argentina() TO service_role;
