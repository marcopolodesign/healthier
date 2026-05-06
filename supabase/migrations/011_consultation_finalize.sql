-- 010: consultation finalization handshake + validation codes + Daily.co room fields

-- 1. New columns on consultations
ALTER TABLE public.consultations
  ADD COLUMN IF NOT EXISTS patient_ended_at timestamptz,
  ADD COLUMN IF NOT EXISTS professional_ended_at timestamptz,
  ADD COLUMN IF NOT EXISTS daily_room_url text,
  ADD COLUMN IF NOT EXISTS daily_room_name text;

-- 2. Validation codes table (separate so RLS can restrict to patient only)
CREATE TABLE IF NOT EXISTS public.consultation_validation_codes (
  consultation_id uuid PRIMARY KEY REFERENCES public.consultations(id) ON DELETE CASCADE,
  code            text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.consultation_validation_codes ENABLE ROW LEVEL SECURITY;

-- Patient can read their own code; professional cannot.
CREATE POLICY "patient_reads_own_code"
  ON public.consultation_validation_codes FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.consultations c
      WHERE c.id = consultation_id AND c.patient_id = auth.uid()
    )
  );

CREATE POLICY "admin_reads_codes"
  ON public.consultation_validation_codes FOR SELECT
  USING (public.get_my_role() IN ('admin', 'super_admin'));

-- 3. Trigger: auto-generate a 4-digit code on every new consultation
CREATE OR REPLACE FUNCTION public.create_validation_code()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.consultation_validation_codes (consultation_id, code)
  VALUES (NEW.id, lpad(floor(random() * 10000)::int::text, 4, '0'));
  RETURN NEW;
END;
$$;

CREATE TRIGGER consultations_create_code
  AFTER INSERT ON public.consultations
  FOR EACH ROW EXECUTE FUNCTION public.create_validation_code();

-- Backfill: generate codes for existing consultations
INSERT INTO public.consultation_validation_codes (consultation_id, code)
SELECT id, lpad(floor(random() * 10000)::int::text, 4, '0')
FROM public.consultations
WHERE id NOT IN (SELECT consultation_id FROM public.consultation_validation_codes);

-- 4. RPC: finalize_consultation
--    - Sets patient_ended_at or professional_ended_at.
--    - Auto-completes when both sides have ended.
--    - Professional can force-complete by supplying the patient's validation code.
CREATE OR REPLACE FUNCTION public.finalize_consultation(
  p_consultation_id   uuid,
  p_role              text,           -- 'patient' | 'professional'
  p_code              text    DEFAULT NULL,
  p_closing_notes     text    DEFAULT NULL,
  p_prescription_url  text    DEFAULT NULL
)
RETURNS public.consultations
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_row  public.consultations%ROWTYPE;
  v_code text;
BEGIN
  SELECT * INTO v_row FROM public.consultations WHERE id = p_consultation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Consulta no encontrada';
  END IF;

  IF p_role = 'patient' THEN
    IF v_row.patient_id <> auth.uid() THEN
      RAISE EXCEPTION 'No autorizado';
    END IF;
    UPDATE public.consultations
      SET patient_ended_at = COALESCE(patient_ended_at, now())
      WHERE id = p_consultation_id;

  ELSIF p_role = 'professional' THEN
    IF v_row.professional_id <> auth.uid() THEN
      RAISE EXCEPTION 'No autorizado';
    END IF;

    IF p_code IS NOT NULL THEN
      -- Validate the code before proceeding
      SELECT code INTO v_code
        FROM public.consultation_validation_codes
        WHERE consultation_id = p_consultation_id;
      IF v_code IS DISTINCT FROM p_code THEN
        RAISE EXCEPTION 'Código inválido';
      END IF;
      -- Code matches → force complete
      UPDATE public.consultations
        SET professional_ended_at  = COALESCE(professional_ended_at, now()),
            status                 = 'completed',
            completed_at           = COALESCE(completed_at, now()),
            closing_notes          = COALESCE(p_closing_notes, closing_notes),
            prescription_url       = COALESCE(p_prescription_url, prescription_url)
        WHERE id = p_consultation_id;
    ELSE
      UPDATE public.consultations
        SET professional_ended_at  = COALESCE(professional_ended_at, now()),
            closing_notes          = COALESCE(p_closing_notes, closing_notes),
            prescription_url       = COALESCE(p_prescription_url, prescription_url)
        WHERE id = p_consultation_id;
    END IF;

  ELSE
    RAISE EXCEPTION 'Rol inválido: debe ser patient o professional';
  END IF;

  -- Auto-complete when both sides have ended (only if code path didn't already complete)
  SELECT * INTO v_row FROM public.consultations WHERE id = p_consultation_id;
  IF v_row.patient_ended_at IS NOT NULL
     AND v_row.professional_ended_at IS NOT NULL
     AND v_row.status <> 'completed' THEN
    UPDATE public.consultations
      SET status       = 'completed',
          completed_at = COALESCE(completed_at, now())
      WHERE id = p_consultation_id;
  END IF;

  SELECT * INTO v_row FROM public.consultations WHERE id = p_consultation_id;
  RETURN v_row;
END;
$$;
