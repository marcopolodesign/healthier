-- ============================================================
-- Migración 244 — Un solo turno activo por móvil
-- ============================================================
-- Bug (Tomás, staging, 2026-11-19): con varias cuentas operadorN en el mismo
-- móvil, la emergencia se asignó al profesional del ÚLTIMO ingreso en modo
-- operador del día — que venía de una prueba con otra cuenta — y quien tenía el
-- teléfono no pudo cargar la atención. "El más reciente del día" no es "quien
-- tiene el teléfono".
--
-- Regla (Mateo):
--   1. Sólo cuenta un TURNO ACTIVO: el ingreso aprobado cuya sesión se retiró,
--      sigue existiendo (no hubo `terminar_turno` ni cierre de sesión) y es de
--      hoy; o el registro del día de la 241 que no fue reemplazado.
--   2. Al registrarse un operador (241) o al retirar la sesión de un ingreso
--      aprobado (243) en un móvil, se cierra el turno anterior de ESE móvil,
--      aunque sea de otra cuenta: un solo responsable por móvil.
--   3. Sin turno activo, la emergencia queda asignada al móvil sin médico
--      (`professional_id` vacío); la toma quien se registre o sea aprobado
--      después.
--
-- "Al aprobarse": el turno anterior se cierra cuando la sesión nueva se RETIRA
-- (no al tocar "Aprobar"). Una aprobación que nadie retira no puede dejar al
-- móvil sin responsable.
-- ============================================================

ALTER TABLE public.operadores_del_dia ADD COLUMN IF NOT EXISTS terminado_at timestamptz;

-- ¿Este ingreso de modo operador sigue siendo un turno activo? (hoy, sin
-- terminar, y con la sesión viva en Auth: cerrar sesión desde el teléfono
-- también lo termina.)
CREATE OR REPLACE FUNCTION public.turno_en_modo_operador_activo(p_session_id uuid, p_dia date)
 RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  SELECT p_dia = public.hoy_en_argentina()
     AND NOT EXISTS (SELECT 1 FROM public.operador_sesiones_fin f WHERE f.session_id = p_session_id)
     AND EXISTS (SELECT 1 FROM auth.sessions s WHERE s.id = p_session_id);
$function$;

-- Cierra los turnos de OTRAS cuentas operador del mismo móvil (y los viejos de
-- la propia cuenta, salvo la sesión `p_conservar`). Lo llaman la 241 al
-- registrarse y `operador-modo` al entregar la sesión.
CREATE OR REPLACE FUNCTION public.cerrar_turnos_previos_del_movil(p_cuenta uuid, p_conservar uuid DEFAULT NULL)
 RETURNS integer
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_amb uuid[];
  v_cuentas uuid[];
  v_n integer := 0;
  r record;
begin
  SELECT coalesce(array_agg(DISTINCT c.ambulance_id), '{}') INTO v_amb
    FROM public.ambulance_crew c
   WHERE c.profile_id = p_cuenta AND c.active AND c.crew_role = 'operador';
  IF coalesce(array_length(v_amb, 1), 0) = 0 THEN RETURN 0; END IF;

  -- Un solo cierre a la vez por móvil: dos entregas simultáneas no se matan entre sí.
  PERFORM pg_advisory_xact_lock(hashtext(a::text)) FROM unnest(v_amb) a ORDER BY a;

  -- Las cuentas que comparten móvil con ésta (incluida ella).
  SELECT coalesce(array_agg(DISTINCT c.profile_id), '{}') INTO v_cuentas
    FROM public.ambulance_crew c
   WHERE c.ambulance_id = ANY (v_amb) AND c.active AND c.crew_role = 'operador';

  FOR r IN
    SELECT l.session_id FROM public.operador_sesiones_log l
     WHERE l.operator_id = ANY (v_cuentas)
       AND l.dia = public.hoy_en_argentina()
       AND (p_conservar IS NULL OR l.session_id <> p_conservar)
       AND public.turno_en_modo_operador_activo(l.session_id, l.dia)
  LOOP
    INSERT INTO public.operador_sesiones_fin (session_id, ended_by) VALUES (r.session_id, auth.uid())
      ON CONFLICT (session_id) DO NOTHING;
    DELETE FROM auth.sessions WHERE id = r.session_id;
    v_n := v_n + 1;
  END LOOP;

  -- Registros del día (241) de las otras cuentas del móvil.
  UPDATE public.operadores_del_dia od SET terminado_at = now()
   WHERE od.profile_id = ANY (v_cuentas) AND od.profile_id <> p_cuenta
     AND od.dia = public.hoy_en_argentina() AND od.terminado_at IS NULL;

  RETURN v_n;
end;
$function$;

-- Quién queda a cargo cuando una emergencia recibe móvil sin médico: SÓLO un
-- turno activo del móvil. Sin turno activo, queda sin médico.
CREATE OR REPLACE FUNCTION public.emergencia_toma_operador_del_dia()
 RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'auth'
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
       WHERE od.dia = public.hoy_en_argentina() AND od.terminado_at IS NULL
      UNION ALL
      SELECT l.professional_id, l.operator_id, l.created_at
        FROM public.operador_sesiones_log l
        JOIN public.ambulance_crew c ON c.profile_id = l.operator_id AND c.ambulance_id = NEW.ambulance_id
         AND c.active AND c.crew_role = 'operador'
       WHERE public.turno_en_modo_operador_activo(l.session_id, l.dia)
    ) x ORDER BY x.created_at DESC LIMIT 1;
    IF v_prof IS NOT NULL THEN
      NEW.professional_id := v_prof;
      NEW.cuenta_operador_id := v_cuenta;
    END IF;
  END IF;
  RETURN NEW;
end;
$function$;

-- Las emergencias en curso del móvil que nadie atiende pasan al nuevo
-- responsable: las que no tienen a nadie, las que quedaron a nombre de la
-- propia cuenta, y las que eran de un turno YA CERRADO de otra cuenta si todavía
-- no se empezó a cargar la atención (si ya hay consulta, sigue quien la empezó).
CREATE OR REPLACE FUNCTION public.tomar_emergencias_en_modo_operador(p_cuenta uuid, p_profesional uuid)
 RETURNS integer
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare n integer;
begin
  UPDATE public.emergencies e
     SET professional_id = p_profesional, cuenta_operador_id = p_cuenta
   WHERE e.status IN ('dispatched', 'in_transit', 'arrived')
     AND e.ambulance_id IN (
           SELECT c.ambulance_id FROM public.ambulance_crew c
            WHERE c.profile_id = p_cuenta AND c.active AND c.crew_role = 'operador')
     AND (e.professional_id IS NULL
          OR e.professional_id = p_cuenta
          OR (e.cuenta_operador_id IS NOT NULL AND e.cuenta_operador_id <> p_cuenta
              AND NOT EXISTS (SELECT 1 FROM public.consultations c WHERE c.emergency_id = e.id)));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
end;
$function$;

-- Registro del día (241): ahora cierra el turno anterior del móvil y toma lo
-- que quedó sin responsable.
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

  -- Un solo responsable por móvil: se cierra el turno anterior (de cualquier cuenta).
  PERFORM public.cerrar_turnos_previos_del_movil(v_uid, NULL);

  INSERT INTO public.operadores_del_dia (profile_id, provider_id, dia, nombre, dni, foto_path)
  VALUES (v_uid, v_provider, public.hoy_en_argentina(), btrim(p_nombre), v_dni, p_foto_path)
  ON CONFLICT (profile_id, dia) DO UPDATE
     SET nombre = EXCLUDED.nombre, dni = EXCLUDED.dni, foto_path = EXCLUDED.foto_path,
         provider_id = EXCLUDED.provider_id, terminado_at = NULL, created_at = now(),
         sisa_estado = 'pendiente', sisa_es_medico = false, sisa_profesion = NULL,
         sisa_matricula = NULL, sisa_nombre = NULL, sisa_detalle = NULL, sisa_chequeado_at = NULL
  RETURNING id INTO v_id;

  v_tomadas := public.tomar_emergencias_en_modo_operador(v_uid, v_uid);

  PERFORM public.llamar_edge_function('operador-sisa', jsonb_build_object('registroId', v_id));
  RETURN jsonb_build_object('id', v_id, 'emergencias_tomadas', v_tomadas);
end;
$function$;

REVOKE ALL ON FUNCTION public.turno_en_modo_operador_activo(uuid, date) FROM public, anon;
REVOKE ALL ON FUNCTION public.cerrar_turnos_previos_del_movil(uuid, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.turno_en_modo_operador_activo(uuid, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cerrar_turnos_previos_del_movil(uuid, uuid) TO service_role;
