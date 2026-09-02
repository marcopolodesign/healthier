-- 140 — Superficie de lectura para Customer.io: esquema `cio` + rol `cio_reader`.
--
-- POR QUÉ NO ES UN USUARIO DE SOLO LECTURA SOBRE `public`.
-- "Solo lectura" protege la base de que le escriban; no protege la confidencialidad.
-- Un rol con SELECT sobre `public` lee `clinical_entries`, `clinical_medications`,
-- `clinical_allergies`, `nutrition_plans` y `rcta_issue_log` (que guarda nombre, DNI,
-- cobertura y medicación del paciente dentro de `request`). Tampoco alcanza con RLS:
-- RLS filtra FILAS, no columnas — dejarle ver `profiles` es dejarle ver `allergies`,
-- `blood_type`, `dni` y `birth_date` de esas mismas filas.
--
-- Hashear el contenido clínico tampoco sirve: son campos de cardinalidad baja
-- (26 especialidades, 8 grupos sanguíneos, un vademécum acotado), así que el hash
-- se revierte armando la tabla de equivalencias en segundos. Y un hash no se puede
-- segmentar ni meter en un template: transfiere el riesgo sin dar el beneficio.
--
-- Entonces el límite es el ESQUEMA, no la policy: `cio_reader` sólo puede nombrar
-- `cio`, y en `cio` lo sensible no está filtrado — no está escrito.
--
-- Se revoca en un comando: `drop owned by cio_reader; drop role cio_reader;`

create schema if not exists cio;
comment on schema cio is
  'Superficie de lectura para Customer.io. Sólo dato de uso de producto y logística: '
  'existencia sí / contenido no, agregado sí / ítem no. Nada de lo que entra acá puede '
  'ser un dato del art. 8 de la Ley 25.326. Ver docs/reports/customerio-datos-sensibles-2026-09-02.html';


-- ─────────────────────────────────────────────────────────────────────────────
-- cio.people — una fila por persona. Es lo que Customer.io sincroniza como
-- atributos del perfil. Los agregados van como subconsultas escalares y no como
-- joins: con tres left join a la vez los contadores se multiplican entre sí.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace view cio.people with (security_invoker = false) as
select
  p.id,
  p.email,
  p.full_name,
  p.phone,
  p.role,
  p.created_at,

  -- Atribución del alta (ya viaja hoy en el identify del cliente).
  p.utm_source, p.utm_medium, p.utm_campaign, p.utm_id, p.utm_content, p.referrer_url,
  p.onboarding_step,

  -- Datos del PROFESIONAL. La especialidad es un dato profesional del médico,
  -- no un dato de salud de un paciente. Es null para pacientes.
  pp.specialty,
  pp.sub_specialty,
  pp.is_verified,
  pp.is_on_demand,
  pp.mp_connected,
  pp.session_price,
  pp.average_rating,
  pp.total_reviews,
  pp.referral_code,

  -- Consultas COMO PACIENTE: cuántas y cuándo. Nunca de qué.
  (select count(*) from consultations c where c.patient_id = p.id)
    as consultas_reservadas,
  (select count(*) from consultations c where c.patient_id = p.id and c.status = 'completed')
    as consultas_completadas,
  (select count(*) from consultations c where c.patient_id = p.id and c.status = 'cancelled')
    as consultas_canceladas,
  (select count(*) from consultations c where c.patient_id = p.id and c.status = 'no_show')
    as consultas_no_show,
  (select min(c.created_at) from consultations c where c.patient_id = p.id)
    as primera_reserva_at,
  (select max(c.completed_at) from consultations c where c.patient_id = p.id and c.status = 'completed')
    as ultima_consulta_at,
  (select min(c.scheduled_at) from consultations c
    where c.patient_id = p.id and c.scheduled_at > now()
      and c.status in ('pending','confirmed'))
    as proxima_consulta_at,

  -- Consultas COMO PROFESIONAL.
  (select count(*) from consultations c where c.professional_id = p.id and c.status = 'completed')
    as atenciones_completadas,
  (select max(c.completed_at) from consultations c where c.professional_id = p.id and c.status = 'completed')
    as ultima_atencion_at,

  -- Plata. Monto y fecha, sin detalle de qué se compró.
  (select coalesce(sum(pay.charged_amount), 0) from payments pay
    where pay.patient_id = p.id and pay.status = 'approved')
    as gasto_total_ars,
  (select max(pay.created_at) from payments pay
    where pay.patient_id = p.id and pay.status = 'approved')
    as ultimo_pago_at,
  (select coalesce(sum(pay.net_to_professional), 0) from payments pay
    where pay.professional_id = p.id and pay.status = 'approved')
    as ingreso_total_ars,

  -- Reseñas dejadas.
  (select count(*) from reviews r where r.patient_id = p.id) as resenas_dejadas,

  -- ── Salud reducida a EXISTENCIA, y siempre ciega a la especialidad ────────
  -- `tiene_receta_activa` se puede defender; `tiene_receta_psiquiatrica` sería
  -- un dato de salud disfrazado de booleano. Por eso ningún contador de acá
  -- se abre por vertical, por especialidad ni por droga.
  exists (select 1 from clinical_medications m
           where m.patient_id = p.id and m.status = 'active')
    as tiene_receta_activa,
  (select count(*) from clinical_medications m where m.patient_id = p.id)
    as recetas_recibidas,
  (select count(*) from medication_orders o where o.patient_id = p.id)
    as pedidos_farmacia,
  exists (select 1 from medication_orders o
           where o.patient_id = p.id and o.status in ('pendiente','en_preparacion','enviado'))
    as tiene_pedido_farmacia_en_curso,
  exists (select 1 from nutrition_plans n where n.patient_id = p.id)
    as tiene_plan_nutricional,
  exists (select 1 from ondemand_requests o where o.patient_id = p.id)
    as uso_on_demand,

  -- Cobertura: sí o no. El nombre de la obra social y el número de afiliado no salen.
  (p.financiador_id is not null or p.coverage_type is not null) as tiene_cobertura

from profiles p
left join professional_profiles pp on pp.user_id = p.id
where p.deleted_at is null;

comment on view cio.people is
  'Atributos de persona para Customer.io. NO exponer nunca acá: allergies, blood_type, dni, '
  'birth_date, height_cm, weight_kg, insurance_name, insurance_num, ni la especialidad de un PACIENTE.';


-- ─────────────────────────────────────────────────────────────────────────────
-- cio.events — línea de tiempo de negocio. Ids, timestamps y montos.
-- Ni una sola columna de texto libre: no hay dónde meter texto clínico.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace view cio.events with (security_invoker = false) as
  select c.id as ref_id, 'appointment_booked'::text as event_name, c.patient_id as person_id,
         c.created_at as occurred_at, c.price_at_booking as amount,
         c.modality, c.is_on_demand, c.professional_id
    from consultations c
union all
  select c.id, 'consultation_completed', c.patient_id, c.completed_at, c.price_at_booking,
         c.modality, c.is_on_demand, c.professional_id
    from consultations c where c.status = 'completed' and c.completed_at is not null
union all
  select c.id, 'consultation_cancelled', c.patient_id, c.cancelled_at, null,
         c.modality, c.is_on_demand, c.professional_id
    from consultations c where c.cancelled_at is not null
union all
  select pay.id, 'payment_approved', pay.patient_id, pay.created_at, pay.charged_amount,
         null, null, pay.professional_id
    from payments pay where pay.status = 'approved'
union all
  -- Que se emitió una receta, no qué dice. `medication_name`, `dosage_text`,
  -- `cie10_code`, `nombre_droga` y `notes` quedan del lado de adentro.
  select m.id, 'prescription_issued', m.patient_id, m.rcta_issued_at, null,
         null, null, m.professional_id
    from clinical_medications m where m.rcta_issued_at is not null
union all
  select o.id, 'pharmacy_order_placed', o.patient_id, o.created_at, o.total,
         null, null, null
    from medication_orders o
union all
  select r.id, 'review_left', r.patient_id, r.created_at, r.rating,
         null, null, r.professional_id
    from reviews r;

comment on view cio.events is
  'Hechos de negocio para Customer.io. Sin motivo de consulta, notas de cierre, '
  'preconsulta_data, hc_draft, diagnóstico ni nombre de medicamento.';


-- ─────────────────────────────────────────────────────────────────────────────
-- cio.reminders — turnos futuros. Es lo único que necesita el "con quién y
-- cuándo", porque es literalmente el contenido del recordatorio.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace view cio.reminders with (security_invoker = false) as
select
  c.id as consultation_id,
  c.patient_id,
  pat.email  as patient_email,
  pat.phone  as patient_phone,
  pat.full_name as patient_name,
  c.professional_id,
  pro.full_name as professional_name,
  pro.email  as professional_email,
  pro.phone  as professional_phone,
  c.scheduled_at,
  c.modality,
  c.is_on_demand,
  c.status,
  c.payment_status,
  (c.daily_room_url is not null) as tiene_sala_de_video
from consultations c
join profiles pat on pat.id = c.patient_id
left join profiles pro on pro.id = c.professional_id
where c.scheduled_at > now()
  and c.status in ('pending','confirmed');

comment on view cio.reminders is
  'Turnos futuros para el recordatorio. Sin vertical, sin especialidad y sin motivo: '
  'el "para qué" del turno no sale.';


-- ─────────────────────────────────────────────────────────────────────────────
-- El rol. Se crea SIN login: la contraseña se pone aparte para no versionarla.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'cio_reader') then
    create role cio_reader nologin;
  end if;
end $$;

-- Todo lo que no sea `cio` queda afuera, incluido lo que se cree en el futuro.
revoke all on schema public from cio_reader;
revoke all on all tables    in schema public from cio_reader;
revoke all on all sequences in schema public from cio_reader;
revoke all on all functions in schema public from cio_reader;
alter default privileges in schema public revoke all on tables    from cio_reader;
alter default privileges in schema public revoke all on sequences from cio_reader;
alter default privileges in schema public revoke all on functions from cio_reader;

-- Y sólo puede leer `cio`.
grant usage  on schema cio to cio_reader;
grant select on all tables in schema cio to cio_reader;
alter default privileges in schema cio grant select on tables to cio_reader;

-- Para que el test de aislamiento pueda hacer `set role cio_reader` sin abrir una
-- conexión aparte. No le da nada nuevo a nadie: `postgres` ya puede todo.
grant cio_reader to postgres;


-- ─────────────────────────────────────────────────────────────────────────────
-- Cerrar la puerta de atrás: las funciones SECURITY DEFINER de `public`.
--
-- Producción tiene `USAGE` en `public` concedido a PUBLIC (el pseudo-rol), y eso
-- NO se puede revocar para un rol solo — así que `cio_reader` entra al esquema
-- aunque no pueda leer ninguna tabla. Ahí adentro hay funciones SECURITY DEFINER
-- que corren como `postgres`: con `EXECUTE` concedido a PUBLIC, cualquiera podía
-- llamarlas y leer por la ventana lo que la puerta no le deja.
--
-- ⚠️ EL ORDEN IMPORTA. Varias de estas funciones tenían el permiso SÓLO por el
-- grant a PUBLIC: si se revoca antes de conceder explícito, `anon` y
-- `authenticated` se quedan sin poder llamarlas y se rompe la app. Primero se
-- concede a los tres roles de Supabase, después se le saca a PUBLIC.
--
-- Las funciones de trigger quedan fuera a propósito: Postgres no chequea EXECUTE
-- cuando las dispara un trigger, así que revocarles no protege nada y podría
-- romper triggers de `auth` (p. ej. `crear_perfil_al_registrarse`).
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace nsp on nsp.oid = p.pronamespace
    where nsp.nspname = 'public'
      and p.prosecdef
      and p.prorettype <> 'trigger'::regtype
  loop
    -- 1º conceder explícito a quien hoy la usa…
    execute format('grant execute on function %s to anon, authenticated, service_role', f.sig);
    -- …2º recién ahí sacarle el permiso a PUBLIC.
    execute format('revoke execute on function %s from public', f.sig);
  end loop;
end $$;
