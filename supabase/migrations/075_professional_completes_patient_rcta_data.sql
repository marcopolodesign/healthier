-- ─────────────────────────────────────────────────────────────────────────────
-- El profesional puede completar los datos del paciente que RCTA exige.
--
-- Pedido de Mateo (2026-07-29): "el profesional TIENE que poder cargar los datos
-- DEL paciente para completar la receta, incluso si el paciente no los dio".
--
-- Hasta ahora era imposible: la única policy de escritura sobre `profiles` es
-- `profiles_update_own` (auth.uid() = id). Si el paciente no tenía DNI, sexo o
-- fecha de nacimiento, la receta no se podía emitir (QBI156/QBI206/QBI224) y la
-- app le decía al profesional "se lo pedimos la próxima vez que entre" — o sea,
-- nunca, para la consulta que tenía adelante.
--
-- Por qué una RPC y no una policy de UPDATE: una policy no puede limitar QUÉ
-- columnas se escriben. Con una policy, un profesional podría cambiarle al
-- paciente el rol, el email o el avatar. Esta función escribe exactamente tres
-- campos y nada más.
--
-- Garantías:
--   • Sólo profesionales, y sólo sobre un paciente con el que comparten consulta.
--   • Sólo `dni`, `gender`, `birth_date`.
--   • NUNCA sobreescribe un valor que el paciente ya cargó (COALESCE sobre el
--     valor existente): el profesional completa huecos, no corrige al paciente.
--   • Deja asiento en `consultation_events` — son datos personales de un tercero
--     escritos por alguien que no es su titular (Ley 25.326), tiene que quedar
--     registrado quién los cargó.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.complete_patient_rcta_data(
  p_patient_id      uuid,
  p_consultation_id uuid    DEFAULT NULL,
  p_dni             text    DEFAULT NULL,
  p_gender          text    DEFAULT NULL,
  p_birth_date      date    DEFAULT NULL
)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row      public.profiles%ROWTYPE;
  v_actor    uuid := auth.uid();
  v_escritos text[] := ARRAY[]::text[];
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF public.get_my_role() <> 'professional' THEN
    RAISE EXCEPTION 'Solo un profesional puede completar los datos del paciente';
  END IF;

  -- Reutiliza la función SECURITY DEFINER que ya evita la recursión
  -- profiles→consultations→profiles.
  IF NOT public.has_shared_consultation(p_patient_id) THEN
    RAISE EXCEPTION 'No tenés una consulta con este paciente';
  END IF;

  IF p_gender IS NOT NULL AND p_gender NOT IN ('femenino', 'masculino', 'otro', 'no_binario', 'prefiero_no_decir') THEN
    RAISE EXCEPTION 'Sexo invalido: %', p_gender;
  END IF;

  -- Qué se va a escribir de verdad: sólo los campos que hoy están vacíos y que
  -- llegaron con valor. Se calcula ANTES del update para poder asentarlo.
  SELECT
    ARRAY_REMOVE(ARRAY[
      CASE WHEN p_dni        IS NOT NULL AND NULLIF(TRIM(COALESCE(pr.dni, '')), '') IS NULL THEN 'dni'        END,
      CASE WHEN p_gender     IS NOT NULL AND NULLIF(TRIM(COALESCE(pr.gender, '')), '') IS NULL THEN 'gender'     END,
      CASE WHEN p_birth_date IS NOT NULL AND pr.birth_date IS NULL                          THEN 'birth_date' END
    ], NULL)
  INTO v_escritos
  FROM public.profiles pr
  WHERE pr.id = p_patient_id;

  UPDATE public.profiles pr
     SET dni        = COALESCE(NULLIF(TRIM(COALESCE(pr.dni, '')), ''), NULLIF(TRIM(p_dni), '')),
         gender     = COALESCE(NULLIF(TRIM(COALESCE(pr.gender, '')), ''), p_gender),
         birth_date = COALESCE(pr.birth_date, p_birth_date)
   WHERE pr.id = p_patient_id
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Paciente no encontrado';
  END IF;

  -- Asiento. Va sin los valores: interesa quién y qué campos, no volver a
  -- guardar el DNI en un log.
  IF p_consultation_id IS NOT NULL AND array_length(v_escritos, 1) > 0 THEN
    INSERT INTO public.consultation_events (consultation_id, actor_id, actor_role, event, detail)
    VALUES (
      p_consultation_id,
      v_actor,
      'professional',
      'professional_completed_patient_data',
      jsonb_build_object('fields', v_escritos, 'patient_id', p_patient_id)
    );
  END IF;

  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION public.complete_patient_rcta_data IS
  'Permite al profesional completar dni/gender/birth_date de un paciente con el que comparte consulta, para poder emitir la receta electrónica. Nunca sobreescribe un valor ya cargado. Deja asiento en consultation_events.';

REVOKE ALL ON FUNCTION public.complete_patient_rcta_data(uuid, uuid, text, text, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_patient_rcta_data(uuid, uuid, text, text, date) TO authenticated;
