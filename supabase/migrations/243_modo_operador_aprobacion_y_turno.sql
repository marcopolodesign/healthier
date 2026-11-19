-- ============================================================
-- Migración 243 — Modo operador: el despacho aprueba el ingreso, "terminar
-- turno" y DNI cargado por el admin
-- ============================================================
-- Decisiones de Mateo (2026-11-19) sobre la 242:
--   1. Segundo factor: el ingreso por DNI queda PENDIENTE y lo aprueba (o
--      rechaza) el despacho de la entidad. Recién al aprobar, `operador-modo`
--      entrega la sesión del profesional. Mientras está pendiente, las
--      emergencias del móvil no se mueven (la toma ocurre al entregar la
--      sesión). Queda registrado quién aprobó.
--   2. Si al profesional le falta el DNI, lo carga el admin del despacho.
--   3. "Terminar turno": el servidor cierra la sesión del profesional en el
--      momento (la UI la hace la app).
-- ============================================================

-- ── 1 · Los pedidos de ingreso ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.operador_ingresos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  professional_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  provider_id     uuid NOT NULL REFERENCES public.emergency_providers(id) ON DELETE CASCADE,
  dni_ingresado   text NOT NULL,
  foto_path       text,
  -- pendiente → aprobado → entregado (la sesión se entregó) | rechazado | vencido | cancelado
  estado          text NOT NULL DEFAULT 'pendiente'
                  CHECK (estado IN ('pendiente', 'aprobado', 'rechazado', 'entregado', 'vencido', 'cancelado')),
  decidido_por    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  decidido_at     timestamptz,
  motivo          text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS operador_ingresos_prov_estado_idx ON public.operador_ingresos (provider_id, estado, created_at DESC);
CREATE INDEX IF NOT EXISTS operador_ingresos_op_idx ON public.operador_ingresos (operator_id, created_at DESC);

ALTER TABLE public.operador_ingresos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS operador_ingresos_select ON public.operador_ingresos;
CREATE POLICY operador_ingresos_select ON public.operador_ingresos
  FOR SELECT TO authenticated
  USING (
    operator_id = auth.uid()
    OR public.get_my_role() = 'super_admin'
    OR (public.get_my_role() IN ('emergency_admin', 'emergency_operator')
        AND provider_id = public.mi_entidad_de_emergencias())
  );
REVOKE ALL ON public.operador_ingresos FROM anon, authenticated;
GRANT SELECT ON public.operador_ingresos TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.operador_ingresos TO service_role;

DROP TRIGGER IF EXISTS operador_ingresos_updated_at ON public.operador_ingresos;
CREATE TRIGGER operador_ingresos_updated_at
  BEFORE UPDATE ON public.operador_ingresos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Realtime: la app del operador espera la decisión, el despacho ve llegar los pedidos.
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.operador_ingresos;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL; END $$;

-- Quién aprobó, en el log inmutable de la 242.
ALTER TABLE public.operador_sesiones_log
  ADD COLUMN IF NOT EXISTS ingreso_id uuid REFERENCES public.operador_ingresos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS aprobado_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- ── 2 · Aviso al despacho cuando llega un pedido ───────────────────────────
CREATE OR REPLACE FUNCTION public.avisar_ingreso_operador()
 RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_staff uuid;
  v_cuenta text;
  v_pro text;
begin
  SELECT coalesce(full_name, email) INTO v_cuenta FROM public.profiles WHERE id = NEW.operator_id;
  SELECT coalesce(full_name, email) INTO v_pro FROM public.profiles WHERE id = NEW.professional_id;
  FOR v_staff IN
    SELECT s.profile_id FROM public.emergency_provider_staff s
      JOIN public.emergency_providers p ON p.id = s.provider_id
     WHERE s.active AND p.active AND s.provider_id = NEW.provider_id
  LOOP
    PERFORM public.enviar_push(
      v_staff,
      'Ingreso en modo operador',
      v_cuenta || ' quiere entrar como ' || v_pro || '. Aprobalo o rechazalo.',
      '/despacho'
    );
  END LOOP;
  RETURN NEW;
end;
$function$;
DROP TRIGGER IF EXISTS operador_ingresos_avisar ON public.operador_ingresos;
CREATE TRIGGER operador_ingresos_avisar
  AFTER INSERT ON public.operador_ingresos
  FOR EACH ROW WHEN (NEW.estado = 'pendiente')
  EXECUTE FUNCTION public.avisar_ingreso_operador();

-- ── 3 · Aprobar / rechazar ─────────────────────────────────────────────────
-- Un pedido pendiente vale 10 minutos; una aprobación, 10 minutos para retirar
-- la sesión. Pasado eso, hay que pedirlo de nuevo.
CREATE OR REPLACE FUNCTION public.resolver_ingreso_operador(p_id uuid, p_aprobar boolean, p_motivo text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  i public.operador_ingresos%rowtype;
begin
  SELECT * INTO i FROM public.operador_ingresos WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No existe el pedido' USING ERRCODE = 'P0002'; END IF;
  IF NOT (public.get_my_role() = 'super_admin'
          OR (public.get_my_role() IN ('emergency_admin', 'emergency_operator')
              AND i.provider_id = public.mi_entidad_de_emergencias())) THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;
  IF i.estado <> 'pendiente' THEN
    RAISE EXCEPTION 'Este pedido ya está %.', i.estado USING ERRCODE = 'check_violation';
  END IF;
  IF i.created_at < now() - interval '10 minutes' THEN
    UPDATE public.operador_ingresos SET estado = 'vencido' WHERE id = i.id;
    RAISE EXCEPTION 'El pedido venció. Que vuelva a pedirlo.' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE public.operador_ingresos
     SET estado = CASE WHEN p_aprobar THEN 'aprobado' ELSE 'rechazado' END,
         decidido_por = auth.uid(), decidido_at = now(), motivo = nullif(btrim(p_motivo), '')
   WHERE id = i.id;
  RETURN jsonb_build_object('estado', CASE WHEN p_aprobar THEN 'aprobado' ELSE 'rechazado' END);
end;
$function$;

-- Vencimientos (cada minuto): pedidos sin decidir y aprobaciones sin retirar.
CREATE OR REPLACE FUNCTION public.vencer_ingresos_operador()
 RETURNS integer
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare n integer;
begin
  UPDATE public.operador_ingresos SET estado = 'vencido'
   WHERE (estado = 'pendiente' AND created_at < now() - interval '10 minutes')
      OR (estado = 'aprobado' AND decidido_at < now() - interval '10 minutes');
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
end;
$function$;
DO $$ BEGIN PERFORM cron.unschedule('vencer-ingresos-operador'); EXCEPTION WHEN others THEN NULL; END $$;
SELECT cron.schedule('vencer-ingresos-operador', '* * * * *', 'select public.vencer_ingresos_operador()');

-- ── 4 · Terminar turno ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.operador_sesiones_fin (
  session_id uuid PRIMARY KEY,
  ended_at   timestamptz NOT NULL DEFAULT now(),
  ended_by   uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);
ALTER TABLE public.operador_sesiones_fin ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.operador_sesiones_fin FROM anon, authenticated;

-- Una sesión terminada ya no es "modo operador" (y la emergencia no vuelve a
-- asignarse a su nombre).
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
     AND NOT EXISTS (SELECT 1 FROM public.operador_sesiones_fin f WHERE f.session_id = l.session_id)
   LIMIT 1;
$function$;

-- El trigger de asignación no reasigna con sesiones terminadas.
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
         AND NOT EXISTS (SELECT 1 FROM public.operador_sesiones_fin f WHERE f.session_id = l.session_id)
    ) x ORDER BY x.created_at DESC LIMIT 1;
    IF v_prof IS NOT NULL THEN
      NEW.professional_id := v_prof;
      NEW.cuenta_operador_id := v_cuenta;
    END IF;
  END IF;
  RETURN NEW;
end;
$function$;

-- `terminar_turno_operador()`: el profesional en modo operador cierra SU sesión
-- ahora. Con `p_session_id`, el despacho de la entidad (o el super admin) cierra
-- la de otra cuenta. Borra la sesión de Auth (el refresh token muere, y las
-- Edge Functions que validan el JWT contra Auth —receta, pagos— dejan de
-- aceptarlo) y la marca terminada.
-- ⚠️ El access token ya emitido sigue pasando por PostgREST hasta que venza
-- (el JWT dura `jwt_exp`, hoy 1 h): Supabase no lo puede revocar antes. Por eso
-- la UI de la app, al terminar el turno, tira esa sesión de inmediato.
CREATE OR REPLACE FUNCTION public.terminar_turno_operador(p_session_id uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  l public.operador_sesiones_log%rowtype;
  v_sid uuid;
begin
  IF p_session_id IS NULL THEN
    BEGIN v_sid := (auth.jwt() ->> 'session_id')::uuid; EXCEPTION WHEN others THEN v_sid := NULL; END;
    SELECT * INTO l FROM public.operador_sesiones_log WHERE session_id = v_sid AND professional_id = auth.uid();
    IF NOT FOUND THEN RAISE EXCEPTION 'Esta sesión no es de modo operador.' USING ERRCODE = '42501'; END IF;
  ELSE
    SELECT * INTO l FROM public.operador_sesiones_log WHERE session_id = p_session_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'No existe esa sesión.' USING ERRCODE = 'P0002'; END IF;
    IF NOT (public.get_my_role() = 'super_admin'
            OR (public.get_my_role() IN ('emergency_admin', 'emergency_operator')
                AND l.provider_id IS NOT NULL AND l.provider_id = public.mi_entidad_de_emergencias())) THEN
      RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
    END IF;
  END IF;
  INSERT INTO public.operador_sesiones_fin (session_id, ended_by) VALUES (l.session_id, auth.uid())
    ON CONFLICT (session_id) DO NOTHING;
  DELETE FROM auth.sessions WHERE id = l.session_id;
  RETURN jsonb_build_object('terminada', true, 'session_id', l.session_id);
end;
$function$;

-- ── 5 · DNI del profesional, cargado por el admin del despacho ─────────────
-- Sólo si el perfil NO tiene DNI y la persona está en la lista de la entidad;
-- nunca pisa uno existente. El trigger de identidad (225) hace el chequeo con
-- SISA en segundo plano, igual que cuando el profesional lo completa solo.
CREATE OR REPLACE FUNCTION public.cargar_dni_de_profesional_de_entidad(p_professional_id uuid, p_dni text)
 RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_dni text := regexp_replace(coalesce(p_dni, ''), '\D', '', 'g');
begin
  IF NOT (public.get_my_role() = 'super_admin'
          OR (public.get_my_role() = 'emergency_admin'
              AND EXISTS (SELECT 1 FROM public.emergency_provider_profesionales l
                           WHERE l.professional_id = p_professional_id AND l.active
                             AND l.provider_id = public.mi_entidad_de_emergencias()))) THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;
  IF v_dni !~ '^[0-9]{7,8}$' THEN
    RAISE EXCEPTION 'El DNI tiene que tener 7 u 8 números.' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = p_professional_id AND nullif(btrim(coalesce(dni, '')), '') IS NOT NULL) THEN
    RAISE EXCEPTION 'Este profesional ya tiene DNI cargado.' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE regexp_replace(coalesce(dni, ''), '\D', '', 'g') = v_dni AND id <> p_professional_id) THEN
    RAISE EXCEPTION 'Ese DNI ya figura en otra cuenta.' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE public.profiles SET dni = v_dni WHERE id = p_professional_id;
end;
$function$;

-- ── 6 · Permisos ───────────────────────────────────────────────────────────
GRANT SELECT, INSERT ON public.operador_sesiones_fin TO service_role;
REVOKE ALL ON FUNCTION public.avisar_ingreso_operador() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.vencer_ingresos_operador() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.resolver_ingreso_operador(uuid, boolean, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.terminar_turno_operador(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.cargar_dni_de_profesional_de_entidad(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.resolver_ingreso_operador(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.terminar_turno_operador(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cargar_dni_de_profesional_de_entidad(uuid, text) TO authenticated;
