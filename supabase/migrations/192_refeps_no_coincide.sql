-- Verificación de matrícula contra REFEPS por el bus FHIR (sisa-verify).
-- Nuevo estado 'no_coincide': la persona está en REFEPS, pero la matrícula que
-- declaró en Healthier no figura entre las suyas (o no declaró ninguna). No es
-- lo mismo que 'not_found' (el DNI no está en el registro) y el super admin
-- tiene que verlo distinto: en sisa_raw.matriculas quedan las que sí tiene.

ALTER TABLE public.professional_profiles
  DROP CONSTRAINT IF EXISTS professional_profiles_sisa_status_check;

ALTER TABLE public.professional_profiles
  ADD CONSTRAINT professional_profiles_sisa_status_check
  CHECK (sisa_status IN ('habilitada', 'suspendida', 'not_found', 'no_coincide', 'error'));
