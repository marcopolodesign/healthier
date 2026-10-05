-- ============================================================
-- 185 — El referido también cuenta por el grupo familiar
--
-- Decisión de Mateo (2026-10-05): una consulta va sin comisión de Healthier si
-- el PACIENTE o SU TITULAR (grupo familiar, migración 181) llegaron por el link
-- de ese mismo profesional. Si una madre vino por el link de la pediatra y
-- reserva para su hijo, el profesional trajo a la familia.
--
-- Titular = quien tiene al paciente en `family_members` (patient_id = titular,
-- familiar_id = paciente) o, por las dudas, `profiles.titular_id` del paciente
-- (quien creó su perfil). El resto de comision_efectiva (184) queda igual.
-- ============================================================

CREATE OR REPLACE FUNCTION public.comision_efectiva(
  p_professional_id uuid,
  p_patient_id      uuid,
  p_at              timestamptz DEFAULT now()
)
RETURNS TABLE (rate numeric, origen text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_rate numeric;
BEGIN
  IF p_patient_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.profiles r
    WHERE r.referred_by_professional_id = p_professional_id
      AND (
        r.id = p_patient_id
        OR r.id IN (SELECT fm.patient_id FROM public.family_members fm WHERE fm.familiar_id = p_patient_id)
        OR r.id = (SELECT p.titular_id FROM public.profiles p WHERE p.id = p_patient_id)
      )
  ) THEN
    RETURN QUERY SELECT 0::numeric, 'referido'::text;
    RETURN;
  END IF;

  SELECT v.rate INTO v_rate FROM public.comision_propia_vigente(p_professional_id, p_at) v;
  IF FOUND THEN
    RETURN QUERY SELECT v_rate, 'profesional'::text;
    RETURN;
  END IF;

  SELECT coalesce(commission_rate, 0.20) INTO v_rate FROM public.platform_settings WHERE id = 1;
  RETURN QUERY SELECT coalesce(v_rate, 0.20), 'general'::text;
END;
$$;

REVOKE ALL ON FUNCTION public.comision_efectiva(uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.comision_efectiva(uuid, uuid, timestamptz) TO service_role;
