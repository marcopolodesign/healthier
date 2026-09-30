-- ============================================================
-- Migration 181 — Grupo familiar de verdad: cada familiar es un paciente
-- ============================================================
-- Hasta acá `family_members` (068) era una lista del titular: el familiar no
-- tenía perfil, así que sus consultas, sus estudios y su historia clínica
-- colgaban del titular. Un turno pediátrico terminaba en la HC del padre.
--
-- Decisión de Mateo (2026-09-30): "Menores de edad es perfil sin log in. Pero
-- también puedo yo solicitar una atención para ellos — para mantener su HC
-- distinta de la mía. Puede ser también para personas mayores. Tienen que ser
-- perfiles con todo lo que implica un perfil y estar vinculados. No es con
-- contraseña; de querer ingresar se manda un pin de acceso."
--
-- Modelo:
--   · Cada familiar es un `profiles` con role = 'patient' y su `auth.users`
--     (profiles.id → auth.users.id lo exige). El usuario de auth NO tiene
--     contraseña y su mail es interno (`familiar-<uuid>@familia.healthier.app`),
--     así que no hay forma de loguearse salvo con el PIN que genera el titular.
--   · `profiles.email` del familiar es el del TITULAR: los mails de la consulta
--     (reserva, cierre, receta) le llegan a quien la pidió sin tocar send-email.
--   · `profiles.titular_id` marca quién lo creó: a esa persona se redirigen las
--     push (`enviar_push_tipo`) y es quien genera los PIN.
--   · `family_members` pasa a ser la tabla de VÍNCULO: patient_id = titular,
--     familiar_id = el perfil del familiar, relationship = parentesco,
--     puede_gestionar. Se reusa en vez de crear otra para que la app (que hoy
--     inserta ahí) siga andando: un insert sin familiar_id crea el perfil solo.
--   · El titular actúa como el familiar vía `puedo_actuar_como(uuid)`, que se
--     suma como policies NUEVAS (OR) sin tocar las existentes. El profesional
--     sigue viendo al paciente de la consulta = el familiar, con lo de siempre.
-- ============================================================

-- ── 1. Columnas ──────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS titular_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.profiles.titular_id IS
  'Si no es null, es un familiar sin login propio creado por este titular (migración 181). Las push van al titular.';

CREATE INDEX IF NOT EXISTS profiles_titular_idx ON public.profiles (titular_id) WHERE titular_id IS NOT NULL;

ALTER TABLE public.family_members
  ADD COLUMN IF NOT EXISTS familiar_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS puede_gestionar boolean NOT NULL DEFAULT true;

CREATE UNIQUE INDEX IF NOT EXISTS family_members_titular_familiar_uidx
  ON public.family_members (patient_id, familiar_id);
CREATE INDEX IF NOT EXISTS family_members_familiar_idx
  ON public.family_members (familiar_id);

COMMENT ON TABLE public.family_members IS
  'Vínculo titular → familiar (migración 181). patient_id = titular, familiar_id = perfil del familiar. Un insert sin familiar_id crea el perfil.';

-- Quién pidió la consulta. Para una consulta propia es el mismo paciente; para
-- la de un familiar es el titular (que es además quien paga).
ALTER TABLE public.consultations
  ADD COLUMN IF NOT EXISTS solicitado_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL DEFAULT auth.uid();

-- ── 2. Funciones de acceso ───────────────────────────────────
-- No leen `profiles`: sólo `family_members`. Así se pueden usar en policies de
-- `profiles` sin volver a la recursión 42P17 (ver get_my_role()).
CREATE OR REPLACE FUNCTION public.es_titular_de(p_titular uuid, p_familiar uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT p_titular IS NOT NULL AND p_familiar IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.family_members fm
    WHERE fm.patient_id = p_titular
      AND fm.familiar_id = p_familiar
      AND fm.puede_gestionar
  );
$$;

CREATE OR REPLACE FUNCTION public.puedo_actuar_como(p_paciente uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT p_paciente = auth.uid() OR public.es_titular_de(auth.uid(), p_paciente);
$$;

REVOKE ALL ON FUNCTION public.es_titular_de(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.es_titular_de(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.puedo_actuar_como(uuid) TO authenticated, service_role;

-- ── 3. Alta del familiar como usuario sin contraseña ─────────
CREATE OR REPLACE FUNCTION public._crear_cuenta_familiar(p_titular uuid, p_nombre text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
DECLARE
  v_id    uuid := gen_random_uuid();
  v_mail  text := 'familiar-' || v_id::text || '@familia.healthier.app';
  v_contacto text;
BEGIN
  SELECT email INTO v_contacto FROM public.profiles WHERE id = p_titular;
  IF v_contacto IS NULL THEN
    RAISE EXCEPTION 'Titular inexistente' USING errcode = 'foreign_key_violation';
  END IF;

  -- Los tokens van en '' y no en NULL: GoTrue falla al leer un usuario con
  -- NULL en esas columnas ("converting NULL to string is unsupported").
  -- Sin `role` en el metadata, `crear_perfil_al_registrarse` no hace nada y el
  -- perfil se crea abajo, con la marca de bienvenida ya puesta (no hay a quién
  -- darle la bienvenida: el mail es interno).
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_mail, '', now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'cuenta_familiar', true),
    jsonb_build_object('full_name', p_nombre, 'titular_id', p_titular),
    now(), now(), '', '', '', '', '', '', '', ''
  );

  INSERT INTO auth.identities (id, user_id, provider_id, provider, identity_data, created_at, updated_at, last_sign_in_at)
  VALUES (
    gen_random_uuid(), v_id, v_id::text, 'email',
    jsonb_build_object('sub', v_id::text, 'email', v_mail, 'email_verified', true),
    now(), now(), NULL
  );

  INSERT INTO public.profiles (id, email, full_name, role, titular_id, mail_bienvenida_enviado_at)
  VALUES (v_id, v_contacto, nullif(trim(p_nombre), ''), 'patient', p_titular, now());

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public._crear_cuenta_familiar(uuid, text) FROM public, anon, authenticated;

-- ── 4. Triggers de family_members ────────────────────────────
CREATE OR REPLACE FUNCTION public.family_members_antes()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Desde la app nadie elige a qué perfil vincularse: eso le daría a
    -- cualquiera la historia clínica de otro con sólo saber su id. El perfil
    -- se crea acá, siempre. Sólo el service role (scripts) puede pasar uno.
    IF auth.uid() IS NOT NULL THEN
      NEW.familiar_id := NULL;
    END IF;
    IF NEW.familiar_id IS NULL THEN
      NEW.familiar_id := public._crear_cuenta_familiar(NEW.patient_id, NEW.full_name);
    END IF;
  ELSE
    IF auth.uid() IS NOT NULL AND (
         NEW.familiar_id IS DISTINCT FROM OLD.familiar_id
      OR NEW.patient_id  IS DISTINCT FROM OLD.patient_id) THEN
      RAISE EXCEPTION 'No se puede cambiar a quién está vinculado un familiar.' USING errcode = '42501';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Los datos se editan en el formulario del grupo familiar (acá y en la app) y
-- viven en el perfil, que es lo que leen el profesional y la receta.
CREATE OR REPLACE FUNCTION public.family_members_sincronizar_perfil()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.familiar_id IS NULL THEN RETURN NEW; END IF;
  UPDATE public.profiles p SET
    full_name      = coalesce(nullif(trim(NEW.full_name), ''), p.full_name),
    dni            = CASE WHEN TG_OP = 'INSERT' OR NEW.dni IS DISTINCT FROM OLD.dni THEN nullif(trim(NEW.dni), '') ELSE p.dni END,
    phone          = CASE WHEN TG_OP = 'INSERT' OR NEW.phone IS DISTINCT FROM OLD.phone THEN nullif(trim(NEW.phone), '') ELSE p.phone END,
    insurance_name = CASE WHEN TG_OP = 'INSERT' OR NEW.insurance_name IS DISTINCT FROM OLD.insurance_name THEN nullif(trim(NEW.insurance_name), '') ELSE p.insurance_name END,
    insurance_num  = CASE WHEN TG_OP = 'INSERT' OR NEW.insurance_num IS DISTINCT FROM OLD.insurance_num THEN nullif(trim(NEW.insurance_num), '') ELSE p.insurance_num END
  WHERE p.id = NEW.familiar_id AND p.titular_id = NEW.patient_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS family_members_antes ON public.family_members;
CREATE TRIGGER family_members_antes
  BEFORE INSERT OR UPDATE ON public.family_members
  FOR EACH ROW EXECUTE FUNCTION public.family_members_antes();

DROP TRIGGER IF EXISTS family_members_sincronizar_perfil ON public.family_members;
CREATE TRIGGER family_members_sincronizar_perfil
  AFTER INSERT OR UPDATE ON public.family_members
  FOR EACH ROW EXECUTE FUNCTION public.family_members_sincronizar_perfil();

-- ── 5. Las filas que ya existían pasan a tener perfil ────────
-- En producción todo es de prueba; igual se migran para que la pantalla actual
-- no pierda a nadie.
UPDATE public.family_members
   SET familiar_id = public._crear_cuenta_familiar(patient_id, full_name)
 WHERE familiar_id IS NULL;

ALTER TABLE public.family_members ALTER COLUMN familiar_id SET NOT NULL;

-- ── 6. Policies nuevas: el titular actúa como el familiar ────
-- Se SUMAN a las existentes (las policies permisivas se combinan con OR). No se
-- reescribe ninguna, así una diferencia entre staging y producción no se pisa.
DROP POLICY IF EXISTS profiles_titular_lee_familiar ON public.profiles;
CREATE POLICY profiles_titular_lee_familiar ON public.profiles
  FOR SELECT USING (public.es_titular_de(auth.uid(), id));

DROP POLICY IF EXISTS profiles_titular_edita_familiar ON public.profiles;
CREATE POLICY profiles_titular_edita_familiar ON public.profiles
  FOR UPDATE USING (public.es_titular_de(auth.uid(), id))
  WITH CHECK (public.es_titular_de(auth.uid(), id));

-- Y el familiar logueado con PIN ve la ficha de su titular (el nombre, para
-- el "te agregó X"). Sólo lectura.
DROP POLICY IF EXISTS profiles_familiar_lee_titular ON public.profiles;
CREATE POLICY profiles_familiar_lee_titular ON public.profiles
  FOR SELECT USING (public.es_titular_de(id, auth.uid()));

DROP POLICY IF EXISTS consultations_titular_del_familiar ON public.consultations;
CREATE POLICY consultations_titular_del_familiar ON public.consultations
  FOR ALL USING (public.es_titular_de(auth.uid(), patient_id))
  WITH CHECK (public.es_titular_de(auth.uid(), patient_id));

DO $$
DECLARE
  t text;
BEGIN
  -- Historia clínica: sólo lectura, igual que el paciente mismo.
  FOREACH t IN ARRAY ARRAY[
    'clinical_allergies', 'clinical_conditions', 'clinical_encounters', 'clinical_entries',
    'clinical_medications', 'clinical_observations', 'nutrition_plans', 'activity_plans'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_titular_lee', t);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT USING (public.es_titular_de(auth.uid(), patient_id))',
        t || '_titular_lee', t);
    END IF;
  END LOOP;

  -- Estudios y documentos: el titular los sube, los ve y los borra.
  FOREACH t IN ARRAY ARRAY['diagnostic_reports', 'medical_documents', 'consultation_arrivals'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_titular', t);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL USING (public.es_titular_de(auth.uid(), patient_id)) '
        'WITH CHECK (public.es_titular_de(auth.uid(), patient_id))',
        t || '_titular', t);
    END IF;
  END LOOP;
END $$;

DROP POLICY IF EXISTS clinical_notes_titular_external ON public.clinical_notes;
CREATE POLICY clinical_notes_titular_external ON public.clinical_notes
  FOR SELECT USING (note_type = 'external' AND public.es_titular_de(auth.uid(), patient_id));

DROP POLICY IF EXISTS validation_codes_titular ON public.consultation_validation_codes;
CREATE POLICY validation_codes_titular ON public.consultation_validation_codes
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.consultations c
    WHERE c.id = consultation_validation_codes.consultation_id
      AND public.es_titular_de(auth.uid(), c.patient_id)));

DROP POLICY IF EXISTS consultation_orders_titular ON public.consultation_orders;
CREATE POLICY consultation_orders_titular ON public.consultation_orders
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.consultations c
    WHERE c.id = consultation_orders.consultation_id
      AND public.es_titular_de(auth.uid(), c.patient_id)));

DROP POLICY IF EXISTS consultation_events_titular_lee ON public.consultation_events;
CREATE POLICY consultation_events_titular_lee ON public.consultation_events
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.consultations c
    WHERE c.id = consultation_events.consultation_id
      AND public.es_titular_de(auth.uid(), c.patient_id)));

DROP POLICY IF EXISTS consultation_events_titular_escribe ON public.consultation_events;
CREATE POLICY consultation_events_titular_escribe ON public.consultation_events
  FOR INSERT WITH CHECK (
    (actor_id IS NULL OR actor_id = auth.uid()) AND EXISTS (
      SELECT 1 FROM public.consultations c
      WHERE c.id = consultation_events.consultation_id
        AND public.es_titular_de(auth.uid(), c.patient_id)));

-- Storage: `patient-docs/<paciente>/...`. El titular escribe en la carpeta del familiar.
DROP POLICY IF EXISTS patient_docs_titular ON storage.objects;
CREATE POLICY patient_docs_titular ON storage.objects
  FOR ALL USING (
    bucket_id = 'patient-docs'
    AND (storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    AND public.es_titular_de(auth.uid(), ((storage.foldername(name))[1])::uuid))
  WITH CHECK (
    bucket_id = 'patient-docs'
    AND (storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    AND public.es_titular_de(auth.uid(), ((storage.foldername(name))[1])::uuid));

-- ── 7. Funciones que chequeaban patient_id = auth.uid() ──────
-- finalize_consultation es larga y no se copia entera: se le cambia sólo la
-- guarda del paciente sobre la definición que esté viva en esta base.
DO $$
DECLARE
  v_def text := pg_get_functiondef('public.finalize_consultation(uuid, text, text, text, text)'::regprocedure);
  v_viejo text := 'IF v_row.patient_id <> auth.uid() THEN';
  v_nuevo text := 'IF v_row.patient_id <> auth.uid() AND NOT public.es_titular_de(auth.uid(), v_row.patient_id) THEN';
BEGIN
  IF position(v_nuevo IN v_def) > 0 THEN
    RETURN;  -- ya aplicada
  END IF;
  IF position(v_viejo IN v_def) = 0 THEN
    RAISE EXCEPTION 'finalize_consultation cambió: no encuentro la guarda del paciente';
  END IF;
  EXECUTE replace(v_def, v_viejo, v_nuevo);
END $$;

CREATE OR REPLACE FUNCTION public.proteger_payment_status_consultations()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.role() = 'service_role' or public.get_my_role() = 'super_admin' then
    return new;
  end if;

  -- Atención de una emergencia (migración 177).
  if new.emergency_id is not null and new.payment_status = 'exempt' and exists (
    select 1 from public.emergencies e
    where e.id = new.emergency_id and e.professional_id = auth.uid()
  ) then
    return new;
  end if;

  -- La bonificación es de quien paga: para la consulta de un familiar cuenta
  -- la del titular (migración 181).
  if (new.patient_id = auth.uid() or public.es_titular_de(auth.uid(), new.patient_id))
     and new.payment_status = 'exempt' then
    if exists (select 1 from public.profiles where id = auth.uid() and payment_exempt = true) then
      return new;
    end if;
    raise exception 'Esta cuenta no tiene la videollamada bonificada.'
      using errcode = '42501';
  end if;

  if new.payment_status = 'pending_payment'
     and (new.patient_id = auth.uid() or new.professional_id = auth.uid()
          or public.es_titular_de(auth.uid(), new.patient_id)) then
    return new;
  end if;

  raise exception 'No autorizado para modificar el estado de pago de esta consulta.'
    using errcode = '42501';
end;
$function$;

-- Las push de un familiar sin login le llegan al titular: es el que tiene el
-- teléfono. Se redirige en un solo lugar para que todos los avisos existentes
-- (turno, cierre, receta) sirvan sin tocarlos uno por uno.
CREATE OR REPLACE FUNCTION public.enviar_push_tipo(p_user_id uuid, p_tipo text, p_datos jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'vault'
AS $function$
declare
  v_key  text;
  v_base text;
begin
  if p_user_id is null or p_tipo is null then return; end if;

  p_user_id := coalesce((select titular_id from public.profiles where id = p_user_id), p_user_id);

  select decrypted_secret into v_key
    from vault.decrypted_secrets where name = 'push_service_key' limit 1;
  select decrypted_secret into v_base
    from vault.decrypted_secrets where name = 'functions_base_url' limit 1;

  if v_key is null or v_base is null then
    raise warning 'push: faltan secretos en Vault — no se envió %', p_tipo;
    return;
  end if;

  perform net.http_post(
    url     := rtrim(v_base, '/') || '/send-push-notification',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body    := p_datos || jsonb_build_object('userId', p_user_id, 'tipo', p_tipo)
  );
end;
$function$;

-- ── 8. PIN de acceso ─────────────────────────────────────────
-- El titular genera un código de 6 dígitos, de un solo uso, que vence a los
-- 15 minutos. Se guarda sólo el hash. Lo canjea la Edge Function
-- `acceso-familiar`, que es la que abre la sesión.
CREATE TABLE IF NOT EXISTS public.familiar_pins (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  familiar_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  titular_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  pin_hash     text NOT NULL,
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS familiar_pins_vivos_idx ON public.familiar_pins (pin_hash) WHERE used_at IS NULL;
CREATE INDEX IF NOT EXISTS familiar_pins_familiar_idx ON public.familiar_pins (familiar_id, created_at DESC);

ALTER TABLE public.familiar_pins ENABLE ROW LEVEL SECURITY;

-- El titular ve cuándo generó y cuándo se usó (nunca el PIN: sólo está el hash).
DROP POLICY IF EXISTS familiar_pins_titular_lee ON public.familiar_pins;
CREATE POLICY familiar_pins_titular_lee ON public.familiar_pins
  FOR SELECT USING (titular_id = auth.uid() OR public.get_my_role() = 'super_admin');

-- Registro de intentos de canje, para frenar a quien prueba códigos al azar.
CREATE TABLE IF NOT EXISTS public.familiar_pin_intentos (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ip         text,
  ok         boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS familiar_pin_intentos_ip_idx ON public.familiar_pin_intentos (ip, created_at DESC);
ALTER TABLE public.familiar_pin_intentos ENABLE ROW LEVEL SECURITY;  -- sin policies: sólo service role

CREATE OR REPLACE FUNCTION public.generar_pin_familiar(p_familiar uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_pin    text;
  v_hash   text;
  v_vence  timestamptz := now() + interval '15 minutes';
BEGIN
  IF NOT public.es_titular_de(auth.uid(), p_familiar) THEN
    RAISE EXCEPTION 'Sólo quien administra a este familiar puede generarle un código.' USING errcode = '42501';
  END IF;

  -- Un código vivo por familiar: generar uno nuevo invalida el anterior.
  UPDATE public.familiar_pins SET used_at = now()
   WHERE familiar_id = p_familiar AND used_at IS NULL AND expires_at > now();

  -- Único entre los vivos, para que el canje sepa a quién corresponde.
  LOOP
    v_pin  := lpad(((('x' || encode(gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0');
    v_hash := encode(digest(v_pin, 'sha256'), 'hex');
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.familiar_pins WHERE pin_hash = v_hash AND used_at IS NULL AND expires_at > now());
  END LOOP;

  INSERT INTO public.familiar_pins (familiar_id, titular_id, pin_hash, expires_at)
  VALUES (p_familiar, auth.uid(), v_hash, v_vence);

  RETURN jsonb_build_object('pin', v_pin, 'expiraAt', v_vence);
END;
$$;

REVOKE ALL ON FUNCTION public.generar_pin_familiar(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.generar_pin_familiar(uuid) TO authenticated;

-- Canje: sólo el service role (la Edge Function). Devuelve el familiar o null.
-- Más de 10 intentos fallidos desde la misma IP en 15 minutos → bloquea.
CREATE OR REPLACE FUNCTION public.canjear_pin_familiar(p_pin text, p_ip text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_familiar uuid;
BEGIN
  IF (SELECT count(*) FROM public.familiar_pin_intentos
       WHERE ip IS NOT DISTINCT FROM p_ip AND NOT ok AND created_at > now() - interval '15 minutes') >= 10 THEN
    RAISE EXCEPTION 'Demasiados intentos. Esperá unos minutos.' USING errcode = 'P0429';
  END IF;

  UPDATE public.familiar_pins
     SET used_at = now()
   WHERE id = (
     SELECT id FROM public.familiar_pins
      WHERE pin_hash = encode(digest(coalesce(p_pin, ''), 'sha256'), 'hex')
        AND used_at IS NULL AND expires_at > now()
      ORDER BY created_at DESC LIMIT 1
      FOR UPDATE SKIP LOCKED)
  RETURNING familiar_id INTO v_familiar;

  INSERT INTO public.familiar_pin_intentos (ip, ok) VALUES (p_ip, v_familiar IS NOT NULL);
  RETURN v_familiar;
END;
$$;

REVOKE ALL ON FUNCTION public.canjear_pin_familiar(text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.canjear_pin_familiar(text, text) TO service_role;

-- ── 9. Super admin: los vínculos a la vista ──────────────────
CREATE OR REPLACE FUNCTION public.admin_grupos_familiares()
RETURNS TABLE (
  vinculo_id uuid, titular_id uuid, titular_nombre text, titular_email text,
  familiar_id uuid, familiar_nombre text, parentesco text, familiar_dni text,
  puede_gestionar boolean, creado_at timestamptz,
  consultas bigint, ultimo_pin_at timestamptz, ultimo_ingreso_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, auth
AS $$
BEGIN
  IF public.get_my_role() IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'No autorizado' USING errcode = '42501';
  END IF;
  RETURN QUERY
  SELECT fm.id, t.id, t.full_name, t.email,
         f.id, f.full_name, fm.relationship, f.dni,
         fm.puede_gestionar, fm.created_at,
         (SELECT count(*) FROM public.consultations c WHERE c.patient_id = f.id),
         (SELECT max(fp.created_at) FROM public.familiar_pins fp WHERE fp.familiar_id = f.id),
         (SELECT u.last_sign_in_at FROM auth.users u WHERE u.id = f.id)
    FROM public.family_members fm
    JOIN public.profiles t ON t.id = fm.patient_id
    JOIN public.profiles f ON f.id = fm.familiar_id
   ORDER BY fm.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_grupos_familiares() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_grupos_familiares() TO authenticated;

-- ── 10. Customer.io no le escribe a un familiar ──────────────
-- Tiene el mail del titular y, a veces, el teléfono de un chico: afuera de las
-- campañas. Se agrega la condición a la vista viva en vez de copiarla entera.
DO $$
DECLARE
  v_def text;
BEGIN
  IF to_regclass('cio.people') IS NULL THEN RETURN; END IF;
  v_def := pg_get_viewdef('cio.people'::regclass);
  IF position('titular_id' IN v_def) > 0 THEN RETURN; END IF;
  IF position('WHERE (p.deleted_at IS NULL);' IN v_def) = 0 THEN
    RAISE WARNING 'cio.people cambió: no se filtraron los familiares';
    RETURN;
  END IF;
  EXECUTE 'CREATE OR REPLACE VIEW cio.people AS ' ||
    replace(v_def, 'WHERE (p.deleted_at IS NULL);', 'WHERE ((p.deleted_at IS NULL) AND (p.titular_id IS NULL));');
END $$;
