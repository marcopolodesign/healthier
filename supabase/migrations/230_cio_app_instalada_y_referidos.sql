-- ═══════════════════════════════════════════════════════════════════════════
-- 230 · cio.people — quién tiene la app y quién vino referido por quién
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Pedido de Hyppo (Customer.io + Metabase), aprobado por Mateo, 2026-11-04:
--   1. Saber quién tiene la app instalada, para impactar a los que no la
--      descargaron.
--   2. Saber quién vino referido por qué profesional.
--
-- ── 1 · La app ─────────────────────────────────────────────────────────────
-- No hay en la base un "versión de app" ni un "último login por plataforma".
-- Hay dos señales y se combinan, porque cada una ve a gente que la otra no:
--
--   · expo_push_tokens (migración 088). La app lo guarda (upsert por token,
--     con updated_at = ahora) cada vez que se abre con sesión, pero SÓLO si la
--     persona aceptó las notificaciones. Se borra si las apaga desde su perfil
--     o si Expo contesta DeviceNotRegistered (app desinstalada).
--   · auth.sessions con el user agent de la app: "Healthier/<build> CFNetwork"
--     es la app de iOS y "okhttp/…" la de Android (React Native). Ve a quien
--     entró a la app aunque haya rechazado las notificaciones. Se pierde si
--     cierra sesión.
--
-- El WebView de la videollamada usa un user agent de Safari, así que no
-- confunde la web con la app. Quien instaló la app y nunca inició sesión no
-- figura en ninguna de las dos: no hay forma de saberlo desde la base.
--
-- Columnas nuevas:
--   tiene_app              boolean  — alguna de las dos señales.
--   app_plataforma         text     — 'ios' | 'android' | 'ambas' | NULL.
--   app_push_activo        boolean  — tiene un token: se le puede mandar push.
--   app_ultimo_uso_at      timestamptz — lo más reciente entre el token y la
--                                     sesión de la app (aprox. última apertura).
--
-- ── 2 · Referidos ──────────────────────────────────────────────────────────
--   referido_por_profesional_id      uuid — profiles.referred_by_professional_id
--                                     (migración 115). Es inmutable una vez
--                                     escrito (trigger de la 115).
--   referido_por_profesional_nombre  text — el full_name de ese profesional.
--   link_referido                    text — del lado del profesional: su link
--                                     base_url() || '/r/' || referral_code (la
--                                     ruta /r/:codigo de App.jsx), para que
--                                     Hyppo lo use directo en un template de
--                                     WhatsApp. NULL si no tiene código.
-- Sin datos de salud.
--
-- ── Cómo ───────────────────────────────────────────────────────────────────
-- Misma definición de cio.people que en staging al 2026-11-04 (la de la 201,
-- comparada con pg_get_viewdef) + las columnas nuevas AL FINAL: Customer.io ya
-- lee las existentes y `create or replace view` exige no reordenarlas.
-- security_invoker = false, como siempre: cio_reader no tiene USAGE en public
-- ni en auth; lee a través de la vista.
-- ═══════════════════════════════════════════════════════════════════════════

-- Señal combinada por persona. Una sola función para que la vista no repita
-- tres veces el mismo union. SECURITY DEFINER y search_path vacío: lee
-- public.expo_push_tokens y auth.sessions, que cio_reader no puede tocar.
create or replace function cio.app_instalada(p_user_id uuid)
returns table (
  tiene_app          boolean,
  app_plataforma     text,
  app_push_activo    boolean,
  app_ultimo_uso_at  timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with senales as (
    select case when t.platform in ('ios', 'android') then t.platform end as plataforma,
           true as es_push,
           t.updated_at as at
      from public.expo_push_tokens t
     where t.user_id = p_user_id
    union all
    select case
             when s.user_agent like 'Healthier/%' then 'ios'
             when s.user_agent like 'okhttp/%'    then 'android'
           end,
           false,
           -- refreshed_at es timestamp sin zona, guardado en UTC: se interpreta
           -- explícito, sin depender del TimeZone de quien consulta.
           greatest(s.refreshed_at at time zone 'UTC', s.updated_at, s.created_at)
      from auth.sessions s
     where s.user_id = p_user_id
       and (s.user_agent like 'Healthier/%' or s.user_agent like 'okhttp/%')
  )
  select count(*) > 0,
         case
           when count(distinct plataforma) > 1 then 'ambas'
           else max(plataforma)
         end,
         coalesce(bool_or(es_push), false),
         max(at)
    from senales
$$;

-- Los permisos de las funciones que llama una vista se chequean contra quien
-- consulta la vista (no contra su dueño): cio_reader necesita EXECUTE.
revoke all on function cio.app_instalada(uuid) from public;
grant execute on function cio.app_instalada(uuid) to cio_reader;

comment on function cio.app_instalada(uuid) is
  'Señal de app instalada para cio.people (migración 230): token de push de Expo (sólo si abrió la app y aceptó notificaciones) o sesión de auth con user agent de la app (Healthier/… = iOS, okhttp/… = Android).';

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
    p.es_extranjero,
    -- ↓ 230
    app.tiene_app,
    app.app_plataforma,
    app.app_push_activo,
    app.app_ultimo_uso_at,
    p.referred_by_professional_id AS referido_por_profesional_id,
    ( SELECT ref.full_name
           FROM profiles ref
          WHERE ref.id = p.referred_by_professional_id) AS referido_por_profesional_nombre,
    cio.base_url() || '/r/'::text || NULLIF(btrim(pp.referral_code), ''::text) AS link_referido
   FROM profiles p
     LEFT JOIN professional_profiles pp ON pp.user_id = p.id
     CROSS JOIN LATERAL ( SELECT cio.to_e164_ar(p.phone) AS e164) tel
     CROSS JOIN LATERAL cio.app_instalada(p.id) app(tiene_app, app_plataforma, app_push_activo, app_ultimo_uso_at)
  WHERE p.deleted_at IS NULL AND p.titular_id IS NULL AND NOT p.es_prueba;

comment on column cio.people.tiene_app is
  'true si la persona usó la app mobile: tiene un token de push (sólo existe si abrió la app con sesión y aceptó las notificaciones) o una sesión abierta desde la app. Quien la instaló y nunca inició sesión no se puede detectar. Migración 230.';
comment on column cio.people.app_plataforma is
  '''ios'' | ''android'' | ''ambas'' según los tokens de push y las sesiones de la app; NULL si no tiene app. Migración 230.';
comment on column cio.people.app_push_activo is
  'true si tiene un token de push vigente: abrió la app y aceptó las notificaciones, y no las apagó ni desinstaló la app. Migración 230.';
comment on column cio.people.app_ultimo_uso_at is
  'Lo más reciente entre el último registro del token de push (se renueva al abrir la app) y la última actividad de una sesión de la app. Aproxima la última apertura. Migración 230.';
comment on column cio.people.referido_por_profesional_id is
  'Profesional que refirió el registro (profiles.referred_by_professional_id, migración 115). NULL si no vino referido. Migración 230.';
comment on column cio.people.referido_por_profesional_nombre is
  'Nombre del profesional que lo refirió. Migración 230.';
comment on column cio.people.link_referido is
  'Link de referido del profesional (https://www.healthier.com.ar/r/<referral_code>), listo para un template de WhatsApp. NULL si no tiene código (no es profesional). Migración 230.';
