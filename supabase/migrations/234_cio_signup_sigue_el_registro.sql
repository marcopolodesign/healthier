-- 234 — cio.people: signup_completo y signup_paso_faltante del paciente siguen
-- los pasos obligatorios del registro (pedido de Hyppo por la sala, 2026-11-06).
--
-- Hasta hoy la vista daba por completo a un paciente con DNI y cobertura
-- cargados, aunque no hubiera aceptado el consentimiento ni cargado sexo o
-- fecha de nacimiento: Customer.io recibía signup_completo = true y
-- signup_paso_faltante vacío para gente que no había terminado el registro.
--
-- Ahora, para los pacientes que pasan por el registro guiado
-- (requiere_onboarding = true, migración 206), es la misma regla que
-- completitudPaciente() en src/lib/pacienteOnboarding.js:
--   1. consentimiento  → consentimiento_at
--   2. datos           → DNI válido (7 u 8 números, o un CUIT/CUIL), sexo y
--                         fecha de nacimiento
--   3. cobertura       → particular, o una obra social del catálogo
--                         (coverage_type = 'financiador' con financiador_id)
-- El paso faltante es el primero que falta, en ese orden.
--
-- Sin cambios: profesionales, pacientes de antes del registro guiado
-- (requiere_onboarding false/null: siguen con DNI + cobertura) y familiares a
-- cargo (la vista ya los deja afuera por titular_id).
--
-- Se edita la definición viva en vez de reescribirla entera: staging tiene
-- columnas que producción todavía no (migración 230), y así la misma migración
-- sirve para las dos bases sin pisar nada. Mismas columnas, mismo orden, mismos
-- grants. Las columnas de profiles se leen adentro de la vista, no se exponen.

DO $$
DECLARE
  v_def text;
  v_dni text := $q$(CASE WHEN length(regexp_replace(COALESCE(p.dni, ''), '\D', '', 'g')) = 11 AND left(regexp_replace(p.dni, '\D', '', 'g'), 2) = ANY (ARRAY['20','23','24','27','30','33','34']) THEN substr(regexp_replace(p.dni, '\D', '', 'g'), 3, 8) ELSE regexp_replace(COALESCE(p.dni, ''), '\D', '', 'g') END ~ '^\d{7,8}$')$q$;
  -- COALESCE: con coverage_type NULL la comparación da NULL, no false.
  v_cob text := $q$COALESCE(p.coverage_type = 'particular' OR (p.coverage_type = 'financiador' AND p.financiador_id IS NOT NULL), false)$q$;
  v_nuevo_reg text := $q$((p.role = 'patient'::text) AND (p.requiere_onboarding IS TRUE))$q$;
  v_completo_viejo text := $q$WHEN (p.role = 'patient'::text) THEN ((p.dni IS NOT NULL) AND (p.coverage_type IS NOT NULL))$q$;
  v_paso_viejo text := $q$WHEN ((p.role = 'patient'::text) AND (p.dni IS NULL)) THEN 'cargar tu DNI'::text$q$;
BEGIN
  v_def := pg_get_viewdef('cio.people'::regclass);

  IF position('aceptar el consentimiento' IN v_def) > 0 THEN
    RETURN;  -- ya aplicada
  END IF;
  IF position(v_completo_viejo IN v_def) = 0 OR position(v_paso_viejo IN v_def) = 0 THEN
    RAISE EXCEPTION 'cio.people cambió: no encuentro los CASE de signup del paciente';
  END IF;

  v_def := replace(v_def, v_completo_viejo,
    'WHEN ' || v_nuevo_reg || ' THEN ((p.consentimiento_at IS NOT NULL) AND ' || v_dni
      || ' AND (NULLIF(btrim(p.gender), '''') IS NOT NULL) AND (p.birth_date IS NOT NULL) AND ' || v_cob || ') '
      || v_completo_viejo);

  v_def := replace(v_def, v_paso_viejo,
       'WHEN (' || v_nuevo_reg || ' AND (p.consentimiento_at IS NULL)) THEN ''aceptar el consentimiento''::text '
    || 'WHEN (' || v_nuevo_reg || ' AND NOT ' || v_dni || ') THEN ''cargar tu DNI''::text '
    || 'WHEN (' || v_nuevo_reg || ' AND (NULLIF(btrim(p.gender), '''') IS NULL)) THEN ''cargar tu sexo''::text '
    || 'WHEN (' || v_nuevo_reg || ' AND (p.birth_date IS NULL)) THEN ''cargar tu fecha de nacimiento''::text '
    || 'WHEN (' || v_nuevo_reg || ' AND NOT ' || v_cob || ') THEN ''cargar tu cobertura médica''::text '
    || 'WHEN ' || v_nuevo_reg || ' THEN NULL::text '
    || v_paso_viejo);

  EXECUTE 'CREATE OR REPLACE VIEW cio.people WITH (security_invoker = false) AS ' || v_def;
END $$;
