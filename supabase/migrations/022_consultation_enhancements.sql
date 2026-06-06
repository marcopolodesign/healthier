-- 022: consultation enhancements
-- • started_at / duration_minutes columns
-- • consultation_orders table (multiple orders per consultation)
-- • start_consultation RPC (presencial code-at-entry)
-- • updated finalize_consultation (duration tracking, presencial direct close)

-- 1. New columns
ALTER TABLE public.consultations
  ADD COLUMN IF NOT EXISTS started_at       timestamptz,
  ADD COLUMN IF NOT EXISTS duration_minutes integer;

-- 2. consultation_orders
CREATE TABLE IF NOT EXISTS public.consultation_orders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id uuid NOT NULL REFERENCES public.consultations(id) ON DELETE CASCADE,
  description     text NOT NULL,
  order_type      text NOT NULL DEFAULT 'orden'
                    CHECK (order_type IN ('orden', 'receta', 'derivacion')),
  url             text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.consultation_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "professional_manages_orders"
  ON public.consultation_orders FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.consultations c
      WHERE c.id = consultation_id AND c.professional_id = auth.uid()
    )
  );

CREATE POLICY "patient_reads_orders"
  ON public.consultation_orders FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.consultations c
      WHERE c.id = consultation_id AND c.patient_id = auth.uid()
    )
  );

CREATE POLICY "admin_reads_orders"
  ON public.consultation_orders FOR SELECT
  USING (public.get_my_role() IN ('admin', 'super_admin'));

-- 3. start_consultation — validates patient code, opens presencial consultation
CREATE OR REPLACE FUNCTION public.start_consultation(
  p_consultation_id uuid,
  p_code            text
)
RETURNS public.consultations
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_row  public.consultations%ROWTYPE;
  v_code text;
BEGIN
  SELECT * INTO v_row FROM public.consultations WHERE id = p_consultation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Consulta no encontrada'; END IF;
  IF v_row.professional_id <> auth.uid() THEN RAISE EXCEPTION 'No autorizado'; END IF;

  SELECT code INTO v_code
    FROM public.consultation_validation_codes
    WHERE consultation_id = p_consultation_id;
  IF v_code IS DISTINCT FROM p_code THEN
    RAISE EXCEPTION 'Código inválido';
  END IF;

  UPDATE public.consultations
    SET status     = 'in_progress',
        started_at = COALESCE(started_at, now())
  WHERE id = p_consultation_id;

  SELECT * INTO v_row FROM public.consultations WHERE id = p_consultation_id;
  RETURN v_row;
END;
$$;

-- 4. Updated finalize_consultation
--    • Computes duration_minutes from started_at when completing
--    • Presencial: professional closes directly (code already validated at entry)
--    • Video: keeps existing dual-handshake / code-force logic
CREATE OR REPLACE FUNCTION public.finalize_consultation(
  p_consultation_id   uuid,
  p_role              text,
  p_code              text    DEFAULT NULL,
  p_closing_notes     text    DEFAULT NULL,
  p_prescription_url  text    DEFAULT NULL
)
RETURNS public.consultations
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_row     public.consultations%ROWTYPE;
  v_code    text;
  v_duration integer;
BEGIN
  SELECT * INTO v_row FROM public.consultations WHERE id = p_consultation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Consulta no encontrada'; END IF;

  IF p_role = 'patient' THEN
    IF v_row.patient_id <> auth.uid() THEN RAISE EXCEPTION 'No autorizado'; END IF;
    UPDATE public.consultations
      SET patient_ended_at = COALESCE(patient_ended_at, now())
      WHERE id = p_consultation_id;

  ELSIF p_role = 'professional' THEN
    IF v_row.professional_id <> auth.uid() THEN RAISE EXCEPTION 'No autorizado'; END IF;

    IF v_row.started_at IS NOT NULL THEN
      v_duration := GREATEST(1, EXTRACT(EPOCH FROM (now() - v_row.started_at))::integer / 60);
    END IF;

    IF v_row.modality = 'presencial' THEN
      -- Presencial: direct close, duration already tracked via started_at
      UPDATE public.consultations
        SET professional_ended_at = COALESCE(professional_ended_at, now()),
            status                = 'completed',
            completed_at          = COALESCE(completed_at, now()),
            duration_minutes      = COALESCE(duration_minutes, v_duration),
            closing_notes         = COALESCE(p_closing_notes, closing_notes),
            prescription_url      = COALESCE(p_prescription_url, prescription_url)
        WHERE id = p_consultation_id;
    ELSE
      -- Video: code force-complete or dual-handshake
      IF p_code IS NOT NULL THEN
        SELECT code INTO v_code
          FROM public.consultation_validation_codes
          WHERE consultation_id = p_consultation_id;
        IF v_code IS DISTINCT FROM p_code THEN
          RAISE EXCEPTION 'Código inválido';
        END IF;
        UPDATE public.consultations
          SET professional_ended_at = COALESCE(professional_ended_at, now()),
              status                = 'completed',
              completed_at          = COALESCE(completed_at, now()),
              duration_minutes      = COALESCE(duration_minutes, v_duration),
              closing_notes         = COALESCE(p_closing_notes, closing_notes),
              prescription_url      = COALESCE(p_prescription_url, prescription_url)
          WHERE id = p_consultation_id;
      ELSE
        UPDATE public.consultations
          SET professional_ended_at = COALESCE(professional_ended_at, now()),
              duration_minutes      = COALESCE(duration_minutes, v_duration),
              closing_notes         = COALESCE(p_closing_notes, closing_notes),
              prescription_url      = COALESCE(p_prescription_url, prescription_url)
          WHERE id = p_consultation_id;
      END IF;
    END IF;

  ELSE
    RAISE EXCEPTION 'Rol inválido: debe ser patient o professional';
  END IF;

  -- Auto-complete (video dual-handshake)
  SELECT * INTO v_row FROM public.consultations WHERE id = p_consultation_id;
  IF v_row.patient_ended_at IS NOT NULL
     AND v_row.professional_ended_at IS NOT NULL
     AND v_row.status <> 'completed' THEN
    UPDATE public.consultations
      SET status           = 'completed',
          completed_at     = COALESCE(completed_at, now()),
          duration_minutes = COALESCE(duration_minutes, v_duration)
      WHERE id = p_consultation_id;
  END IF;

  SELECT * INTO v_row FROM public.consultations WHERE id = p_consultation_id;
  RETURN v_row;
END;
$$;
