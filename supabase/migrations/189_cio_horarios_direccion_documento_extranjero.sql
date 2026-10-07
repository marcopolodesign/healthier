-- ═══════════════════════════════════════════════════════════════════════════
-- 189 · Customer.io: horarios, dirección y documento extranjero en cio.people
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Pedido de Mateo (2026-10-07, vía Healthier Support) para segmentar campañas:
--   · tiene_horarios       (profesionales) — tiene al menos una fila en
--                          professional_schedules. Sin horarios no lo pueden
--                          reservar. NULL para quien no es profesional.
--   · tiene_direccion      (profesionales) — professional_profiles.address no
--                          vacío. Sin dirección no sale en el mapa y la receta
--                          electrónica la exige. NULL para quien no es profesional.
--   · documento_extranjero (todos) — derivado de profiles.dni: numérico ≥ 90
--                          millones (DNI de extranjero residente) o no numérico
--                          (pasaporte u otro) → true; numérico menor → false;
--                          sin DNI → NULL.
-- 🔴 El número de documento NO sale nunca por cio (regla de la migración 140):
--    sólo el booleano. Por eso la cuenta vive en una función y la vista no
--    expone `dni`.
-- No se agrega nacionalidad al registro (decisión de Mateo).
--
-- Además: cio.base_url() pasa a https://www.healthier.com.ar (regla de Mateo
-- del 2026-10-07: todo link que se redacta va con el dominio propio).
--
-- La vista se recrea con `create or replace` agregando las columnas AL FINAL:
-- así no se rompe ninguna columna que ya use Customer.io y los grants se
-- conservan. El resto de la definición es la que estaba en las dos bases
-- (idéntica en staging y producción al 2026-10-07).

create or replace function cio.documento_extranjero(p_dni text)
returns boolean
language sql
immutable
as $$
  select case
    when nullif(regexp_replace(coalesce(p_dni, ''), '[.\s-]', '', 'g'), '') is null then null
    when regexp_replace(p_dni, '[.\s-]', '', 'g') !~ '^[0-9]+$' then true
    else regexp_replace(p_dni, '[.\s-]', '', 'g')::numeric >= 90000000
  end
$$;

comment on function cio.documento_extranjero(text) is
  'true si el documento es de extranjero (DNI ≥ 90.000.000 o no numérico), false si es DNI argentino, NULL sin documento. Nunca devuelve el número (migración 189).';

grant execute on function cio.documento_extranjero(text) to cio_reader;

create or replace function cio.base_url()
returns text
language sql
immutable
as $$ select 'https://www.healthier.com.ar'::text $$;

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
    cio.documento_extranjero(p.dni) AS documento_extranjero
   FROM profiles p
     LEFT JOIN professional_profiles pp ON pp.user_id = p.id
     CROSS JOIN LATERAL ( SELECT cio.to_e164_ar(p.phone) AS e164) tel
  WHERE p.deleted_at IS NULL AND p.titular_id IS NULL;
