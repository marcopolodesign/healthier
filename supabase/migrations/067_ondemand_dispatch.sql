-- ============================================================
-- Migration 067 — despacho on-demand tipo Uber: pedido → timbre → aceptación
-- ============================================================
-- Decisión de Mateo (2026-07-27): el profesional NO tiene que tener la pestaña
-- abierta para aparecer disponible — eso es un impuesto de atención inviable.
-- En web no se puede latir con el browser cerrado, así que "presencia" siempre
-- va a significar "tené una pestaña abierta": es la primitiva equivocada.
--
-- Modelo nuevo: el pedido se crea SIN médico asignado y les suena a todos los
-- elegibles. El primero que acepta se lo queda. La presencia (066) queda como
-- señal secundaria — a quién mostrarle primero y qué ETA prometerle — no como
-- requisito para entrar al pool.
--
-- RESTRICCIÓN QUE DEFINE LA FORMA: el pre-auth de Mercado Pago se hace con el
-- token del VENDEDOR (el médico), así que no se puede autorizar el pago antes de
-- saber quién es. Por eso el paciente elige tarjeta ANTES de pedir y la
-- autorización sale sola al aceptarse — como Uber, sin segunda interacción.
-- Mientras suenan los timbres el paciente contesta la pre-consulta, así que el
-- tiempo de espera se usa en vez de mirar un spinner. Esas respuestas viven acá
-- y se copian a la consulta al aceptarse.
--
-- Sobre el claim: `walk_in_queue` (037) ya modela algo parecido y su claim está
-- MAL — hace `update ... where id = $1` sin ninguna guarda de que la entrada
-- siga libre, así que dos profesionales pueden tomar la misma entrada y el
-- segundo pisa al primero. (Fastpass está deshabilitado desde el 2026-07-23 por
-- un error al tomar; esto es candidato a ser la causa.) Acá la toma es una sola
-- sentencia condicional dentro de un RPC: gana quien llegue primero y el resto
-- recibe NULL.
-- ============================================================

CREATE TYPE ondemand_request_status AS ENUM ('pending', 'accepted', 'expired', 'cancelled');

CREATE TABLE IF NOT EXISTS public.ondemand_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  vertical         text NOT NULL,
  specialty        text NOT NULL,
  -- Respuestas de la pre-consulta, contestadas mientras suenan los timbres.
  -- Se copian a consultations.preconsulta_data al aceptarse.
  preconsulta_data jsonb,
  -- Tarjeta elegida antes de pedir. La autorización se dispara al aceptarse,
  -- ya con el token del médico que aceptó.
  payment_method_id uuid REFERENCES public.payment_methods(id) ON DELETE SET NULL,
  price_at_request numeric(10,2),
  status           ondemand_request_status NOT NULL DEFAULT 'pending',
  accepted_by      uuid REFERENCES public.profiles(id),
  accepted_at      timestamptz,
  consultation_id  uuid REFERENCES public.consultations(id),
  expires_at       timestamptz NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ondemand_requests IS
  'Pedidos de consulta inmediata sin médico asignado. Suenan a todos los elegibles; el primero que acepta se lo queda vía accept_ondemand_request().';

-- Lo que el profesional consulta todo el tiempo: pedidos vivos de su especialidad.
CREATE INDEX IF NOT EXISTS ondemand_requests_open_idx
  ON public.ondemand_requests (specialty, expires_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS ondemand_requests_patient_idx
  ON public.ondemand_requests (patient_id, created_at DESC);

ALTER TABLE public.ondemand_requests ENABLE ROW LEVEL SECURITY;

-- ── Paciente: solo lo suyo ───────────────────────────────────────────────────
CREATE POLICY "patient_select_own_request" ON public.ondemand_requests
  FOR SELECT USING (patient_id = auth.uid());

CREATE POLICY "patient_insert_own_request" ON public.ondemand_requests
  FOR INSERT WITH CHECK (patient_id = auth.uid());

-- Update acotado a lo suyo, para cancelar y para ir guardando la pre-consulta
-- mientras espera. La aceptación NO pasa por acá — va por el RPC.
CREATE POLICY "patient_update_own_request" ON public.ondemand_requests
  FOR UPDATE USING (patient_id = auth.uid()) WITH CHECK (patient_id = auth.uid());

-- ── Profesional: ve los pedidos abiertos que puede tomar, y los que aceptó ───
-- No es "todos los pedidos": solo los de su especialidad, vivos, y únicamente si
-- él mismo declara on-demand y puede cobrar. Un profesional sin MP conectado no
-- tiene por qué enterarse de un pedido que no va a poder atender.
CREATE POLICY "professional_select_open_requests" ON public.ondemand_requests
  FOR SELECT USING (
    accepted_by = auth.uid()
    OR (
      status = 'pending'
      AND expires_at > now()
      AND EXISTS (
        SELECT 1 FROM public.professional_profiles pp
         WHERE pp.user_id = auth.uid()
           AND pp.specialty = ondemand_requests.specialty
           AND pp.is_on_demand = true
           AND pp.is_verified = true
           AND pp.is_active = true
           AND pp.mp_connected = true
      )
    )
  );

-- ── Toma atómica ────────────────────────────────────────────────────────────
-- SECURITY DEFINER porque crea la consulta en nombre de ambas partes. Todas las
-- comprobaciones de quién puede tomar qué se hacen explícitas acá adentro.
CREATE OR REPLACE FUNCTION public.accept_ondemand_request(p_request_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pro           professional_profiles%ROWTYPE;
  v_req           ondemand_requests%ROWTYPE;
  v_consultation  uuid;
BEGIN
  SELECT * INTO v_pro FROM professional_profiles WHERE user_id = auth.uid();
  IF v_pro IS NULL OR NOT v_pro.is_on_demand OR NOT v_pro.is_verified
     OR NOT v_pro.is_active OR NOT v_pro.mp_connected THEN
    RAISE EXCEPTION 'No podés tomar consultas inmediatas en este momento.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- La toma en UNA sentencia condicional: si otro llegó primero, no matchea
  -- ninguna fila y v_req queda NULL. Sin ventana entre leer y escribir.
  UPDATE ondemand_requests
     SET status = 'accepted', accepted_by = auth.uid(), accepted_at = now()
   WHERE id = p_request_id
     AND status = 'pending'
     AND expires_at > now()
     AND specialty = v_pro.specialty
  RETURNING * INTO v_req;

  IF v_req.id IS NULL THEN
    RETURN NULL;  -- ya la tomó otro, venció, o no es de su especialidad
  END IF;

  INSERT INTO consultations (
    patient_id, professional_id, modality, status, is_on_demand,
    price_at_booking, scheduled_at, preconsulta_data
  ) VALUES (
    v_req.patient_id, auth.uid(), 'video', 'confirmed', true,
    v_req.price_at_request, now(), v_req.preconsulta_data
  ) RETURNING id INTO v_consultation;

  UPDATE ondemand_requests SET consultation_id = v_consultation WHERE id = v_req.id;

  RETURN v_consultation;
END;
$$;

COMMENT ON FUNCTION public.accept_ondemand_request(uuid) IS
  'Toma atómica de un pedido on-demand. Devuelve el id de la consulta creada, o NULL si otro profesional llegó primero / venció / no es de su especialidad.';

GRANT EXECUTE ON FUNCTION public.accept_ondemand_request(uuid) TO authenticated;

-- ── Barrido de vencidos ─────────────────────────────────────────────────────
-- El cliente marca el vencimiento cuando está mirando, pero el paciente puede
-- cerrar la pestaña. Esto es el backstop para que no queden pedidos 'pending'
-- eternos ensuciando lo que ve el profesional.
CREATE OR REPLACE FUNCTION public.expire_ondemand_requests()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH done AS (
    UPDATE ondemand_requests SET status = 'expired'
     WHERE status = 'pending' AND expires_at <= now()
    RETURNING 1
  ) SELECT count(*)::integer FROM done;
$$;

COMMENT ON FUNCTION public.expire_ondemand_requests() IS
  'Backstop: marca vencidos los pedidos que nadie tomó. El cliente ya lo hace mientras mira, pero el paciente puede cerrar la pestaña.';

-- Realtime: es todo el punto — al profesional le tiene que aparecer sin recargar.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
       AND tablename = 'ondemand_requests'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ondemand_requests;
  END IF;
END $$;

ALTER TABLE public.ondemand_requests REPLICA IDENTITY FULL;
