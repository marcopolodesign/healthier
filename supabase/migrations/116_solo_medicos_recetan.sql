-- ============================================================
-- 116 — Sólo los médicos pueden recetar
--
-- Pedido de Mateo (2026-08-14): "que SOLO los médicos clínicos puedan emitir
-- recetas (los pediatras se supone que son clínicos)". Hoy cualquier profesional
-- verificado puede cargar medicación y emitir una receta electrónica — un
-- psicólogo, un nutricionista o un entrenador incluidos. Eso no es un detalle de
-- UI: la receta sale firmada con su matrícula.
--
-- Se resuelve como un dato del catálogo (`specialties.puede_recetar`) y no como
-- una lista en el código, por el mismo motivo por el que el catálogo dejó de
-- estar hardcodeado en la 101: agregar una especialidad médica nueva no debería
-- necesitar un deploy. Se administra desde /super-admin/verticales.
--
-- Arranca en `false` para todas y se prende sólo en las dos que Mateo nombró.
-- Cardiología y Dermatología existen en el catálogo pero hoy no hay ningún
-- profesional dado de alta con ellas, así que dejarlas apagadas no le saca el
-- recetario a nadie — y prenderlas después es un clic, no un deploy.
--
-- El bloqueo real vive acá abajo (trigger), no en el frontend: esconder el botón
-- no impide un POST a mano, y la firma de una receta es exactamente lo que no se
-- puede dejar del lado del cliente.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. La bandera en el catálogo
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.specialties
  ADD COLUMN IF NOT EXISTS puede_recetar boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.specialties.puede_recetar IS
  'Si los profesionales de esta especialidad pueden cargar medicación y emitir recetas electrónicas. Editable desde /super-admin/verticales.';

UPDATE public.specialties
SET puede_recetar = true
WHERE slug IN ('medicina_general', 'pediatria');

-- ────────────────────────────────────────────────────────────
-- 2. El chequeo, en un solo lugar
-- ────────────────────────────────────────────────────────────
-- `professional_profiles.specialty` guarda el slug de la especialidad de primer
-- nivel. Si el slug no está en el catálogo (dato viejo o cargado a mano), la
-- respuesta es `false`: ante la duda, no se receta.
CREATE OR REPLACE FUNCTION public.profesional_puede_recetar(p_professional_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    (SELECT s.puede_recetar
       FROM public.professional_profiles pp
       JOIN public.specialties s ON s.slug = pp.specialty
      WHERE pp.user_id = p_professional_id
      LIMIT 1),
    false
  );
$$;

GRANT EXECUTE ON FUNCTION public.profesional_puede_recetar(uuid) TO authenticated;

-- ────────────────────────────────────────────────────────────
-- 3. El bloqueo
-- ────────────────────────────────────────────────────────────
-- Trigger y no policy de RLS a propósito: una policy devuelve un 403 mudo, y
-- acá el profesional necesita entender por qué no puede — si no, escribe a
-- soporte pensando que la app está rota. El repo ya tiene la regla de que los
-- errores de la app muestran el mensaje real.
CREATE OR REPLACE FUNCTION public.verificar_que_puede_recetar()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT public.profesional_puede_recetar(NEW.professional_id) THEN
    RAISE EXCEPTION 'Tu especialidad no tiene habilitada la prescripción de medicamentos en Healthier'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS verificar_que_puede_recetar ON public.clinical_medications;
CREATE TRIGGER verificar_que_puede_recetar
  BEFORE INSERT ON public.clinical_medications
  FOR EACH ROW EXECUTE FUNCTION public.verificar_que_puede_recetar();

-- Sólo se valida en el INSERT: las recetas ya cargadas por especialidades que
-- ahora quedan sin permiso siguen existiendo en la historia clínica. Borrarlas
-- o bloquear su lectura sería reescribir un registro clínico que ya se le
-- entregó a un paciente.
