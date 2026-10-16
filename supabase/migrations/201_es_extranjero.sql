-- ═══════════════════════════════════════════════════════════════════════════
-- 201 · profiles.es_extranjero — derivado del número de documento
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Pedido de Hyppo (Olivia, growth) vía Mateo, 2026-10-16: un campo
-- "extranjero sí/no" por profesional, para medir si el grupo de anuncios para
-- médicos que vivieron en otros países trae extranjeros de verdad.
--
-- Regla de Mateo: documento mayor a 90.000.000 → extranjero. Los DNI de
-- extranjeros residentes en Argentina arrancan en 9x millones.
--
--   · Se normaliza: se sacan puntos, espacios y guiones ("94.123.456" cuenta).
--   · Sin documento → NULL ("no sabemos"), nunca false. La mayoría de los
--     profesionales carga el DNI recién al enviar el legajo.
--   · No numérico (pasaporte u otro) → true. Es lo que ya hacía
--     `cio.documento_extranjero` (migración 189); se mantiene.
--   · 11 dígitos → es un CUIT/CUIL escrito en el campo del DNI: el DNI son los
--     8 del medio. Sin esto un "20-12345678-9" quedaba como extranjero.
--
-- Es una COLUMNA GENERADA, no un dato que escribe el front: la web, la app y el
-- panel no pueden dejarla desfasada del documento. Vale para todos los roles
-- porque el documento vive en `profiles.dni` (pacientes incluidos).
--
-- 🔴 Si algún día cambia la regla: `create or replace` de la función NO
-- recalcula lo guardado. Después de cambiarla hay que correr
-- `update public.profiles set dni = dni where dni is not null;`.
--
-- Customer.io (cio.people): `documento_extranjero` (189) pasa a leer esta misma
-- columna — una sola regla en toda la base — y se agrega `es_extranjero` al
-- final con el nombre que pidió Hyppo. El número de documento sigue sin salir
-- por cio (regla de la 140): sólo el booleano.
--
-- Orden de migraciones: 199 y 200 son de feat/verticales-dinamicas (ya en
-- staging). Ésta es la 201 y no depende de ellas.

create or replace function public.documento_es_extranjero(p_dni text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when d = '' then null
    when d !~ '^[0-9]+$' then true
    when length(d) = 11 then substr(d, 3, 8)::bigint > 90000000
    else d::numeric > 90000000
  end
  from (select regexp_replace(coalesce(p_dni, ''), '[.\s-]', '', 'g') as d) n
$$;

comment on function public.documento_es_extranjero(text) is
  'true si el documento es de extranjero (DNI > 90.000.000, o no numérico), false si es DNI argentino, NULL sin documento. 11 dígitos = CUIT/CUIL: se mira el DNI del medio. Migración 201.';

alter table public.profiles
  add column if not exists es_extranjero boolean
  generated always as (public.documento_es_extranjero(dni)) stored;

comment on column public.profiles.es_extranjero is
  'Derivado de dni (migración 201): > 90.000.000 o no numérico → true; DNI argentino → false; sin DNI → NULL. Lo lee Hyppo por cio.people.';

-- La función de la 189 queda, por si algo la llama, pero con la regla única.
create or replace function cio.documento_extranjero(p_dni text)
returns boolean
language sql
immutable
as $$ select public.documento_es_extranjero(p_dni) $$;

grant execute on function public.documento_es_extranjero(text) to cio_reader;

-- cio.people: misma definición que en las dos bases al 2026-10-16 (verificado
-- con md5 de pg_get_viewdef, idéntico en staging y producción). Cambia sólo
-- `documento_extranjero` (ahora lee la columna) y se agrega `es_extranjero`
-- AL FINAL, para no romper columnas que ya usa Customer.io y conservar grants.
create or replace view cio.people with (security_invoker = false) as
 SELECT p.id,
    p.email,
    p.full_name,
    tel.e164 AS phone,
    p.phone AS phone_raw,
    tel.e164 IS NOT NULL AS phone_valido,
    p.phone IS NOT NULL AND tel.e164 IS NULL AS phone_a_revisar,
    p.role,
    p.created_at,
    p.utm_source,
    p.utm_medium,
    p.utm_campaign,
    p.utm_id,
    p.utm_content,
    p.referrer_url,
    p.onboarding_step,
        CASE
            WHEN p.role = 'professional'::text THEN pp.submitted_at IS NOT NULL
            WHEN p.role = 'patient'::text THEN p.dni IS NOT NULL AND p.coverage_type IS NOT NULL
            ELSE true
        END AS signup_completo,
        CASE
            WHEN p.role = 'professional'::text AND pp.submitted_at IS NOT NULL THEN NULL::text
            WHEN p.role = 'professional'::text AND pp.user_id IS NULL THEN 'crear tu perfil profesional'::text
            WHEN p.role = 'professional'::text THEN COALESCE(('completar el paso "'::text || (ARRAY['Especialidad'::text, 'Presentación'::text, 'Documentos'::text, 'Privacidad'::text, 'Revisión'::text])[COALESCE(p.onboarding_step::integer, 0) + 1]) || '" y enviar tu legajo'::text, 'completar tu perfil profesional y enviarlo a revisión'::text)
            WHEN p.role = 'patient'::text AND p.dni IS NULL THEN 'cargar tu DNI'::text
            WHEN p.role = 'patient'::text AND p.coverage_type IS NULL THEN 'cargar tu cobertura médica'::text
            ELSE NULL::text
        END AS signup_paso_faltante,
    p.dni IS NOT NULL AS tiene_dni,
    p.coverage_type IS NOT NULL AS tiene_cobertura_declarada,
    pp.specialty,
    pp.sub_specialty,
    pp.is_verified,
    pp.is_on_demand,
    pp.mp_connected,
    pp.session_price,
    pp.average_rating,
    pp.total_reviews,
    pp.referral_code,
    cio.estado_verificacion(pp.*) AS verificacion_estado,
    cio.documentos_faltantes(pp.*) AS verificacion_documentos_faltantes,
    "left"(pp.rejection_reason, 300) AS verificacion_motivo_observacion,
    pp.rejection_type AS verificacion_tipo_observacion,
    pp.submitted_at AS legajo_enviado_at,
    pp.verified_at,
    cio.link_reserva(pp.id, pp.is_verified) AS link_reserva,
    ( SELECT count(*) AS count
           FROM consultations c
          WHERE c.patient_id = p.id) AS consultas_reservadas,
    ( SELECT count(*) AS count
           FROM consultations c
          WHERE c.patient_id = p.id AND c.status = 'completed'::text) AS consultas_completadas,
    ( SELECT count(*) AS count
           FROM consultations c
          WHERE c.patient_id = p.id AND c.status = 'cancelled'::text) AS consultas_canceladas,
    ( SELECT count(*) AS count
           FROM consultations c
          WHERE c.patient_id = p.id AND c.status = 'no_show'::text) AS consultas_no_show,
    ( SELECT min(c.created_at) AS min
           FROM consultations c
          WHERE c.patient_id = p.id) AS primera_reserva_at,
    ( SELECT max(c.completed_at) AS max
           FROM consultations c
          WHERE c.patient_id = p.id AND c.status = 'completed'::text) AS ultima_consulta_at,
    ( SELECT min(c.scheduled_at) AS min
           FROM consultations c
          WHERE c.patient_id = p.id AND c.scheduled_at > now() AND (c.status = ANY (ARRAY['pending'::text, 'confirmed'::text]))) AS proxima_consulta_at,
    (( SELECT min(c.scheduled_at) AS min
           FROM consultations c
          WHERE c.patient_id = p.id AND c.scheduled_at > now() AND (c.status = ANY (ARRAY['pending'::text, 'confirmed'::text])))) IS NOT NULL AS tiene_turno_futuro,
    ( SELECT count(*) AS count
           FROM consultations c
          WHERE c.professional_id = p.id AND c.status = 'completed'::text) AS atenciones_completadas,
    ( SELECT max(c.completed_at) AS max
           FROM consultations c
          WHERE c.professional_id = p.id AND c.status = 'completed'::text) AS ultima_atencion_at,
    ( SELECT COALESCE(sum(pay.charged_amount), 0::numeric) AS "coalesce"
           FROM payments pay
          WHERE pay.patient_id = p.id AND pay.status = 'approved'::text) AS gasto_total_ars,
    ( SELECT max(pay.created_at) AS max
           FROM payments pay
          WHERE pay.patient_id = p.id AND pay.status = 'approved'::text) AS ultimo_pago_at,
    ( SELECT COALESCE(sum(pay.net_to_professional), 0::numeric) AS "coalesce"
           FROM payments pay
          WHERE pay.professional_id = p.id AND pay.status = 'approved'::text) AS ingreso_total_ars,
    ( SELECT count(*) AS count
           FROM reviews r
          WHERE r.patient_id = p.id) AS resenas_dejadas,
    (EXISTS ( SELECT 1
           FROM clinical_medications m
          WHERE m.patient_id = p.id AND m.status = 'active'::text)) AS tiene_receta_activa,
    ( SELECT count(*) AS count
           FROM clinical_medications m
          WHERE m.patient_id = p.id) AS recetas_recibidas,
    ( SELECT count(*) AS count
           FROM medication_orders o
          WHERE o.patient_id = p.id) AS pedidos_farmacia,
    (EXISTS ( SELECT 1
           FROM medication_orders o
          WHERE o.patient_id = p.id AND (o.status = ANY (ARRAY['pendiente'::text, 'en_preparacion'::text, 'enviado'::text])))) AS tiene_pedido_farmacia_en_curso,
    (EXISTS ( SELECT 1
           FROM nutrition_plans n
          WHERE n.patient_id = p.id)) AS tiene_plan_nutricional,
    (EXISTS ( SELECT 1
           FROM ondemand_requests o
          WHERE o.patient_id = p.id)) AS uso_on_demand,
    p.financiador_id IS NOT NULL OR p.coverage_type IS NOT NULL AS tiene_cobertura,
        CASE
            WHEN p.role = 'professional'::text THEN (EXISTS ( SELECT 1
               FROM professional_schedules s
              WHERE s.professional_id = p.id))
            ELSE NULL::boolean
        END AS tiene_horarios,
        CASE
            WHEN p.role = 'professional'::text THEN NULLIF(btrim(pp.address), ''::text) IS NOT NULL
            ELSE NULL::boolean
        END AS tiene_direccion,
    p.es_extranjero AS documento_extranjero,
    p.es_extranjero
   FROM profiles p
     LEFT JOIN professional_profiles pp ON pp.user_id = p.id
     CROSS JOIN LATERAL ( SELECT cio.to_e164_ar(p.phone) AS e164) tel
  WHERE p.deleted_at IS NULL AND p.titular_id IS NULL AND NOT p.es_prueba;
