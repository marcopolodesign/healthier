-- 166 — Lo que pidió Hyppo para poder prender las campañas (mail del 2026-09-16,
--       "Alineamiento Healthier <> Hyppo <> Marcopolo").
--
-- Son seis pedidos, todos del lado "a nivel data". Nada de esto cambia la app:
-- amplía la superficie de lectura `cio` que ya consume Customer.io por Data
-- Warehouse Sync (migraciones 140 y 141).
--
--   1. Teléfono normalizado a E.164 con el 9 de móvil argentino. Sin esto el
--      WhatsApp falla o le llega a otro número. Hoy 66 de 187 teléfonos de
--      producción están en E.164; los otros 121 vienen a mano ("11 5555-0000",
--      "011...", "15..."). Se normaliza EN LA VISTA, no en `profiles`: el dato
--      que cargó la persona no se pisa.
--   2. Qué marca el "signup completo" de verdad, y qué paso le falta al que no.
--   3. Por qué una cuenta profesional sigue sin verificar: qué documento falta,
--      qué se le observó, o si ya está en la cola del equipo de Healthier.
--   4. `appointment_booked` con dirección y link de videollamada.
--   5. `appointment_attended` true/false — hoy no existía ninguna señal.
--   6. `consultation_completed` con el nombre del profesional y su link de reserva.
--
-- 🔴 Sigue valiendo la regla de la migración 140: acá NO entra un dato del art. 8
-- de la Ley 25.326. Todo lo que se agrega es logística (cuándo, dónde, con quién)
-- o estado administrativo del legajo de un PROFESIONAL — que es dato profesional,
-- no dato de salud de un paciente. La especialidad del paciente sigue sin salir:
-- la única excepción es `cio.appointment_confirmed`, decidida y documentada en 141.


-- ─────────────────────────────────────────────────────────────────────────────
-- 1 · Teléfono → E.164
--
-- Espeja `toE164Ar` de `src/utils/customerio.js`, con un agregado que la versión
-- JS no tenía y que Hyppo pidió explícito: el **9 de móvil**. Un "+5411…" es un
-- fijo para WhatsApp y el envío falla; si el número tiene pinta de móvil (10
-- dígitos después del 54) se le mete el 9.
--
-- Devuelve NULL cuando no puede decidir. Eso es a propósito: mandar un número
-- mal armado es peor que no mandarlo — la campaña lo saltea en vez de escribirle
-- a un desconocido. El crudo viaja igual en `phone_raw` para poder corregirlo.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function cio.to_e164_ar(crudo text)
returns text
language plpgsql
immutable
as $$
declare
  digitos text;
begin
  if crudo is null or btrim(crudo) = '' then
    return null;
  end if;

  -- Ya viene internacional: se limpian separadores y se respeta el país.
  if left(btrim(crudo), 1) = '+' then
    digitos := regexp_replace(substr(btrim(crudo), 2), '\D', '', 'g');
  else
    digitos := regexp_replace(crudo, '\D', '', 'g');
    if digitos = '' then
      return null;
    end if;
    if left(digitos, 2) <> '54' then
      -- Larga distancia nacional: el 0 de adelante no va en E.164.
      if left(digitos, 1) = '0' then
        digitos := substr(digitos, 2);
      end if;

      -- El 15 de celular va DESPUÉS del código de área (2 a 4 dígitos), y
      -- SÓLO se saca si el número quedó largo de más.
      --
      -- 🔴 Acá estaba el bug que rompía a los del interior. Un número de
      -- Mendoza tiene 10 dígitos: 261 + 7. Escrito de corrido, "2615123456",
      -- el regex lo lee como área "26" + "15" + "123456" y le arranca dos
      -- dígitos del medio: queda de 8 y la función devuelve NULL. Pasaba con
      -- 261, 341 y 351 — cinco profesionales de producción se quedaban sin
      -- WhatsApp para siempre, en silencio.
      --
      -- Un número argentino completo (área + abonado) SIEMPRE tiene 10
      -- dígitos. Si ya los tiene, no hay ningún 15 que sacar: lo que parece un
      -- 15 es parte del número. El 15 sólo existe en los de 11 o 12.
      if length(digitos) > 10 then
        digitos := regexp_replace(digitos, '^(\d{2,4})15(\d{6,8})$', '\1\2');
      end if;

      -- Formato móvil nacional: "9" + área + abonado, sin el país. Ningún
      -- código de área argentino arranca con 9, así que 11 dígitos que empiezan
      -- con 9 no son ambiguos.
      if length(digitos) = 11 and left(digitos, 1) = '9' then
        return '+54' || digitos;
      end if;

      if length(digitos) = 10 then
        return '+549' || digitos;
      end if;
      return null;
    end if;
  end if;

  if digitos = '' then
    return null;
  end if;

  -- Argentina: "+54" + 10 dígitos es un móvil escrito sin el 9. WhatsApp lo
  -- necesita, así que se lo agrega.
  if left(digitos, 2) = '54' and length(digitos) = 12 then
    return '+549' || substr(digitos, 3);
  end if;

  return '+' || digitos;
end;
$$;

comment on function cio.to_e164_ar(text) is
  'Teléfono argentino → E.164 con el 9 de móvil, para que Customer.io pueda mandar WhatsApp. '
  'NULL si no se puede decidir el formato: el crudo viaja aparte en `phone_raw`.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 2 · Base de la app, para armar los links que van en el cuerpo del mensaje.
--
-- Customer.io sólo lee producción, así que la constante es la de producción. En
-- staging la migración aplica igual (los links apuntan a prod y no los mira nadie):
-- vale más que las dos bases tengan el MISMO esquema que un link de staging que
-- nadie va a abrir.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function cio.base_url()
returns text language sql immutable as $$ select 'https://gethealthier.vercel.app'::text $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2b · ¿El turno es en un consultorio, o por video?
--
-- Parece una comparación tonta y no lo es: `modality` admite NULL en la base (hay
-- turnos viejos así), y en SQL `null <> 'presencial'` da NULL, no `true`. Escrito
-- a mano en cada vista, esos turnos se caían del lado de la dirección Y del lado
-- del link de video: el mensaje salía sin decir ni dónde ni por dónde entrar.
-- `is_on_demand` también admite NULL y rompe igual.
--
-- El default es video porque es el default de la plataforma: la consulta
-- inmediata y la videoconsulta son el caso mayoritario, y un turno presencial
-- siempre tiene la modalidad escrita.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function cio.es_presencial(modality text, is_on_demand boolean)
returns boolean language sql immutable as $$
  select coalesce(modality, 'video') = 'presencial' and not coalesce(is_on_demand, false)
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2c · Los pedazos que se repetían en varias vistas, en un solo lugar.
--
-- No es prolijidad: `documentos_faltantes` y `estado_verificacion` son la MISMA
-- regla de negocio leída desde dos vistas distintas (`cio.people` para segmentar
-- y `cio.professional_verification` para el cuerpo del mensaje). Copiadas, la
-- próxima vez que cambie la lista de documentos una de las dos queda vieja y
-- nadie se entera hasta que un profesional recibe un WhatsApp equivocado.
-- ─────────────────────────────────────────────────────────────────────────────

-- `to_char(..., 'Day')` sale en inglés: la base tiene lc_time en C y no se toca
-- por una etiqueta. Se mapea a mano, una vez.
create or replace function cio.dia_semana_es(cuando timestamptz)
returns text language sql immutable as $$
  select (array['domingo','lunes','martes','miércoles','jueves','viernes','sábado'])[
    extract(dow from cuando at time zone 'America/Argentina/Buenos_Aires')::int + 1]
$$;

-- Documentos REQUERIDOS = los mismos que exige `src/lib/profileCompleteness.js`:
-- título, matrícula y DNI siempre, más el certificado de especialista si declaró
-- sub-especialidad. El seguro de mala praxis y el CUIT son "recomendado" en el
-- wizard, así que no se reclaman: pedir algo opcional en un WhatsApp hace que el
-- profesional corrija algo que nadie le estaba pidiendo.
--
-- 🔴 Si cambia la lista, cambia también en `profileCompleteness.js`.
-- 🔴 `nullif(..., '')`: `array_to_string` de un array vacío devuelve CADENA
-- VACÍA, no NULL. Sin el nullif, "no le falta ningún documento" se lee como
-- "faltan documentos" en cualquier `is not null` — y en producción eso ponía a
-- los 55 profesionales como incompletos cuando los incompletos eran 35.
create or replace function cio.documentos_faltantes(pp professional_profiles)
returns text language sql immutable as $$
  select nullif(array_to_string(array_remove(array[
    case when pp.title_document_url   is null then 'Título profesional'    end,
    case when pp.license_document_url is null then 'Matrícula profesional' end,
    case when pp.dni_document_url     is null then 'DNI'                   end,
    case when pp.sub_specialty is not null and pp.specialist_certificate_document_url is null
         then 'Certificado de especialista' end
  ], null), ', '), '')
$$;

create or replace function cio.documentos_requeridos(pp professional_profiles)
returns int language sql immutable as $$
  select 3 + case when pp.sub_specialty is null then 0 else 1 end
$$;

create or replace function cio.documentos_subidos(pp professional_profiles)
returns int language sql immutable as $$
  select (case when pp.title_document_url   is not null then 1 else 0 end)
       + (case when pp.license_document_url is not null then 1 else 0 end)
       + (case when pp.dni_document_url     is not null then 1 else 0 end)
       + (case when pp.sub_specialty is null then 0
               when pp.specialist_certificate_document_url is not null then 1 else 0 end)
$$;

-- `pp.user_id is null` = la fila vino de un LEFT JOIN que no encontró nada, o
-- sea la persona no es profesional. Devuelve NULL, no 'sin_enviar'.
create or replace function cio.estado_verificacion(pp professional_profiles)
returns text language sql immutable as $$
  select case
    when pp.user_id is null                           then null
    when pp.is_verified and pp.reverification_pending then 'reverificacion_pendiente'
    when pp.is_verified                               then 'verificado'
    when pp.rejected_at is not null                   then 'rechazado'
    when pp.submitted_at is not null                  then 'en_revision'
    else                                                   'sin_enviar'
  end
$$;

-- Ficha pública del profesional — el botón "reservar"/"reagendar" de los
-- mensajes. NULL si todavía no está verificado: no tiene ficha que mostrar, y
-- ahí el botón del template cae solo a la home.
create or replace function cio.link_reserva(profile_id uuid, verificado boolean)
returns text language sql immutable as $$
  select case when profile_id is not null and verificado
              then cio.base_url() || '/paciente/profesional/' || profile_id::text end
$$;




-- ─────────────────────────────────────────────────────────────────────────────
-- 3 · Estado del legajo profesional — el "por qué sigue sin verificar".
--
-- Hyppo preguntó tres cosas por cuenta: si le faltan documentos y cuáles, si se
-- le observó alguno y por qué, o si ya mandó todo y está esperando al equipo de
-- Healthier. Las tres salen de `professional_profiles`; la bitácora
-- `professional_onboarding_events` (migración de recorrido) aporta el cuándo.
--
-- Documentos REQUERIDOS = los mismos que exige `lib/profileCompleteness.js`:
-- título, matrícula y DNI siempre, más el certificado de especialista si declaró
-- sub-especialidad. El seguro de mala praxis y el CUIT son recomendados en el
-- wizard, así que no se reclaman acá — reclamar algo opcional en un WhatsApp
-- hace que el profesional corrija algo que nadie le estaba pidiendo.
--
-- `motivo_observacion` es texto libre escrito por nuestro propio admin sobre el
-- legajo de un profesional (un documento ilegible, una matrícula vencida). No es
-- dato de salud de nadie; es lo que Hyppo necesita para que el mensaje diga qué
-- corregir en vez de "algo falta". Se recorta a 300 caracteres.
-- ─────────────────────────────────────────────────────────────────────────────
drop view if exists cio.professional_verification;

create view cio.professional_verification with (security_invoker = false) as
select
  p.id                                     as person_id,
  pp.id                                    as professional_profile_id,
  p.full_name,
  p.email,
  cio.to_e164_ar(p.phone)                  as phone,
  p.phone                                  as phone_raw,

  -- ── El estado, en una palabra ───────────────────────────────────────────
  cio.estado_verificacion(pp)              as estado,

  -- Y en una frase, lista para meter en el cuerpo del mensaje.
  case
    when pp.is_verified and pp.reverification_pending
      then 'Cambiaste un dato del legajo y volvió a revisión.'
    when pp.is_verified
      then 'Tu cuenta está verificada.'
    when pp.rejected_at is not null and pp.rejection_type = 'permanente'
      then 'Tu solicitud fue rechazada.'
    when pp.rejected_at is not null
      then 'Revisamos tu legajo y necesitamos que corrijas algo.'
    when pp.submitted_at is not null
      then 'Ya recibimos tu legajo y lo está revisando nuestro equipo.'
    else 'Todavía no nos enviaste tu legajo para revisión.'
  end                                      as estado_texto,

  -- ── ¿Le falta subir documentos? ¿Cuáles? ────────────────────────────────
  cio.documentos_faltantes(pp)             as documentos_faltantes,

  (cio.documentos_faltantes(pp) is not null) as faltan_documentos,

  -- Cuántos de los requeridos ya subió, para segmentar por "casi lo tiene".
  cio.documentos_subidos(pp)               as documentos_subidos,
  cio.documentos_requeridos(pp)            as documentos_requeridos,

  -- ── ¿Se le observó algo, y por qué? ─────────────────────────────────────
  (pp.rejected_at is not null)             as tiene_observacion,
  pp.rejection_type                        as tipo_observacion,
  left(pp.rejection_reason, 300)           as motivo_observacion,
  pp.rejected_at                           as observado_at,
  (pp.rejection_type = 'permanente')       as rechazo_definitivo,

  -- ── ¿O ya está todo y la pelota la tenemos nosotros? ────────────────────
  (pp.submitted_at is not null and not pp.is_verified and pp.rejected_at is null)
                                           as esperando_a_healthier,
  pp.submitted_at                          as legajo_enviado_at,
  pp.verified_at,
  pp.is_verified,

  -- Cuántos días lleva esperando la revisión. Es el dato con el que Hyppo puede
  -- decidir si el recordatorio va al profesional o si el problema es nuestro.
  case
    when pp.submitted_at is not null and not pp.is_verified and pp.rejected_at is null
      then floor(extract(epoch from (now() - pp.submitted_at)) / 86400)::int
  end                                      as dias_esperando_revision,

  -- Hasta dónde llegó en el wizard el que todavía no envió nada.
  p.onboarding_step,
  (array['Especialidad','Presentación','Documentos','Privacidad','Revisión'])[p.onboarding_step + 1]
                                           as onboarding_paso,
  p.created_at                             as cuenta_creada_at
from professional_profiles pp
join profiles p on p.id = pp.user_id
where p.deleted_at is null;

comment on view cio.professional_verification is
  'Por qué una cuenta profesional sigue sin verificar: documentos que faltan, observación '
  'recibida y su motivo, o si ya está en la cola de revisión de Healthier. Pedido de Hyppo '
  '(mail 2026-09-16). Dato administrativo del profesional — no hay dato de salud acá.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 4 · `cio.people` — se rehace para meter teléfono E.164, signup completo y el
--     estado de verificación como ATRIBUTOS (no sólo como vista aparte): así se
--     puede segmentar en Customer.io sin cruzar dos fuentes.
--
-- Se dropea en vez de `create or replace` porque Postgres sólo deja agregar
-- columnas al final, y los atributos nuevos van al lado de los que acompañan.
-- Nada depende de esta vista, así que el drop es seguro.
-- ─────────────────────────────────────────────────────────────────────────────
drop view if exists cio.people;

create view cio.people with (security_invoker = false) as
select
  p.id,
  p.email,
  p.full_name,

  -- ── Teléfono: el pedido transversal de Hyppo ────────────────────────────
  -- `phone` sale SIEMPRE en E.164 o NULL. El crudo va aparte para poder
  -- corregirlo sin perder el dato. Sale del lateral `tel` de abajo: la función
  -- es plpgsql, así que Postgres no la inlinea ni reusa el resultado — escrita
  -- tres veces se recorre el regex tres veces por fila.
  tel.e164                                 as phone,
  p.phone                                  as phone_raw,
  (tel.e164 is not null)                   as phone_valido,
  (p.phone is not null and tel.e164 is null) as phone_a_revisar,

  p.role,
  p.created_at,

  -- Atribución del alta.
  p.utm_source, p.utm_medium, p.utm_campaign, p.utm_id, p.utm_content, p.referrer_url,
  p.onboarding_step,

  -- ── Signup completo — el otro pedido transversal ────────────────────────
  -- Son dos recorridos distintos y por eso no hay un solo evento que lo marque,
  -- que era exactamente la duda de Hyppo:
  --
  --   • PACIENTE: la cuenta se crea con mail y nombre, pero el alta recién está
  --     terminada cuando pasó el onboarding de dos pasos — DNI (sin DNI no puede
  --     recibir una receta electrónica) y cobertura. `coverage_type` es lo último
  --     que guarda el wizard, así que es el que marca el final.
  --   • PROFESIONAL: está completo cuando ENVIÓ EL LEGAJO (`submitted_at`). No
  --     cuando lo verificamos — eso ya no depende de él, y reclamárselo sería
  --     pedirle que haga algo que le toca a Healthier.
  case
    when p.role = 'professional' then pp.submitted_at is not null
    when p.role = 'patient'      then p.dni is not null and p.coverage_type is not null
    else true
  end                                      as signup_completo,

  -- Qué paso exacto le falta, redactado para entrar tal cual en el template.
  case
    when p.role = 'professional' and pp.submitted_at is not null then null
    when p.role = 'professional' and pp.user_id is null then 'crear tu perfil profesional'
    when p.role = 'professional' then
      coalesce(
        'completar el paso "' ||
        (array['Especialidad','Presentación','Documentos','Privacidad','Revisión'])[coalesce(p.onboarding_step, 0) + 1]
        || '" y enviar tu legajo',
        'completar tu perfil profesional y enviarlo a revisión')
    when p.role = 'patient' and p.dni is null then 'cargar tu DNI'
    when p.role = 'patient' and p.coverage_type is null then 'cargar tu cobertura médica'
    else null
  end                                      as signup_paso_faltante,

  -- Los dos hitos sueltos, por si la campaña quiere ramificar sin parsear texto.
  (p.dni is not null)                      as tiene_dni,
  (p.coverage_type is not null)            as tiene_cobertura_declarada,

  -- Datos del PROFESIONAL. Especialidad = dato profesional del médico, null
  -- para pacientes.
  pp.specialty,
  pp.sub_specialty,
  pp.is_verified,
  pp.is_on_demand,
  pp.mp_connected,
  pp.session_price,
  pp.average_rating,
  pp.total_reviews,
  pp.referral_code,

  -- ── Estado de verificación como atributo ────────────────────────────────
  cio.estado_verificacion(pp)              as verificacion_estado,
  cio.documentos_faltantes(pp)             as verificacion_documentos_faltantes,
  left(pp.rejection_reason, 300)           as verificacion_motivo_observacion,
  pp.rejection_type                        as verificacion_tipo_observacion,
  pp.submitted_at                          as legajo_enviado_at,
  pp.verified_at,

  -- Link de reserva del profesional — el opcional que pidió Hyppo para el
  -- follow-up post-consulta. NULL si todavía no tiene ficha pública, y ahí el
  -- botón del mensaje cae solo a la home.
  cio.link_reserva(pp.id, pp.is_verified)  as link_reserva,

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
  -- Si ya tiene un turno futuro, el follow-up post-consulta NO se manda: la
  -- campaña de Hyppo ramifica por acá. Se deriva de `proxima_consulta_at` en vez
  -- de repetir la subconsulta: es exactamente la misma pregunta.
  ((select min(c.scheduled_at) from consultations c
     where c.patient_id = p.id and c.scheduled_at > now()
       and c.status in ('pending','confirmed')) is not null)
    as tiene_turno_futuro,

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

  (select count(*) from reviews r where r.patient_id = p.id) as resenas_dejadas,

  -- ── Salud reducida a EXISTENCIA, y siempre ciega a la especialidad ───────
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

  (p.financiador_id is not null or p.coverage_type is not null) as tiene_cobertura

from profiles p
left join professional_profiles pp on pp.user_id = p.id
cross join lateral (select cio.to_e164_ar(p.phone) as e164) tel
where p.deleted_at is null;

comment on view cio.people is
  'Atributos de persona para Customer.io. `phone` sale en E.164 o NULL (el crudo va en '
  '`phone_raw`). NO exponer nunca acá: allergies, blood_type, dni, birth_date, height_cm, '
  'weight_kg, insurance_name, insurance_num, ni la especialidad de un PACIENTE.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 5 · `cio.appointment_booked` — el turno con todo lo que el mensaje necesita
--     decir: con quién, cuándo, dónde y por dónde se entra.
--
-- Hasta hoy `appointment_booked` sólo existía como una fila flaca de `cio.events`
-- (ids y monto). El mail de confirmación y los dos recordatorios no podían decir
-- ni la dirección ni el link de la videollamada, que es justo lo que los hace
-- servir para algo.
--
-- LINK DE VIDEO — la parte con trampa: `consultations.daily_room_url` está en
-- NULL al reservar. La sala de Daily se crea recién cuando el primero de los dos
-- entra (edge function `daily-token`), así que mandar esa columna en un
-- recordatorio de 24 hs manda un campo vacío. El link que SÍ sirve siempre es el
-- de la pantalla de la app, que resuelve la sala cuando la persona llega: va uno
-- para el paciente y otro para el profesional, porque son rutas distintas.
--
-- DIRECCIÓN — la consulta no tiene dirección propia: el turno presencial es en
-- el consultorio del profesional (`professional_profiles.address`). Sólo sale si
-- la modalidad es presencial; en una videoconsulta una dirección confunde.
-- ─────────────────────────────────────────────────────────────────────────────
drop view if exists cio.appointment_booked;

create view cio.appointment_booked with (security_invoker = false) as
select
  c.id                                     as consultation_id,
  c.patient_id                             as person_id,
  pat.email                                as patient_email,
  cio.to_e164_ar(pat.phone)                as patient_phone,
  pat.phone                                as patient_phone_raw,
  pat.full_name                            as patient_name,

  c.created_at                             as booked_at,
  extract(epoch from c.created_at)::bigint as booked_timestamp,

  -- ── El profesional ──────────────────────────────────────────────────────
  c.professional_id,
  pro.full_name                            as profesional_nombre,
  pro.email                                as profesional_email,
  cio.to_e164_ar(pro.phone)                as profesional_phone,
  pro.phone                                as profesional_phone_raw,
  pp.id                                    as professional_profile_id,
  pp.is_verified                           as profesional_verificado,
  pp.average_rating                        as profesional_rating,

  -- ── El turno ────────────────────────────────────────────────────────────
  c.scheduled_at,
  extract(epoch from c.scheduled_at)::bigint as scheduled_timestamp,
  to_char(c.scheduled_at at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY') as fecha_turno,
  to_char(c.scheduled_at at time zone 'America/Argentina/Buenos_Aires', 'HH24:MI')    as hora_turno,
  to_char(c.scheduled_at at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI') as fecha_hora_turno,
  cio.dia_semana_es(c.scheduled_at)         as dia_turno,

  case when cio.es_presencial(c.modality, c.is_on_demand)
       then 'presencial' else 'videoconsulta' end as modalidad,
  c.is_on_demand,

  -- ── Dónde ───────────────────────────────────────────────────────────────
  case when cio.es_presencial(c.modality, c.is_on_demand) then pp.address end
                                           as direccion,
  case when cio.es_presencial(c.modality, c.is_on_demand) and pp.address is not null
       then 'https://www.google.com/maps/search/?api=1&query='
            || replace(replace(pp.address, ' ', '+'), '&', '')
  end                                      as direccion_mapa_url,

  -- ── Por dónde se entra ──────────────────────────────────────────────────
  (cio.es_presencial(c.modality, c.is_on_demand) and pp.address is null)
                                           as falta_direccion,
  case when not cio.es_presencial(c.modality, c.is_on_demand)
       then cio.base_url() || '/paciente/videollamada/' || c.id::text end
                                           as link_videollamada,
  case when not cio.es_presencial(c.modality, c.is_on_demand)
       then cio.base_url() || '/profesional/videollamada/' || c.id::text end
                                           as link_videollamada_profesional,
  (c.daily_room_url is not null)           as sala_ya_creada,

  -- ── Estado y plata ──────────────────────────────────────────────────────
  c.status,
  c.payment_status,
  c.price_at_booking                       as precio,
  (c.obra_social_name is not null)         as tiene_obra_social,
  cio.base_url() || '/paciente/consultas'  as link_mis_turnos
from consultations c
join profiles pat  on pat.id = c.patient_id
left join profiles pro on pro.id = c.professional_id
left join professional_profiles pp on pp.user_id = c.professional_id;

comment on view cio.appointment_booked is
  'Una fila por turno reservado, con todo lo que el mail/WhatsApp necesita nombrar: profesional, '
  'fecha, hora, fecha+hora, dirección y link de videollamada. Pedido de Hyppo (mail 2026-09-16). '
  'El link de video es el de la pantalla de la app, no `daily_room_url`: la sala de Daily se crea '
  'recién cuando alguien entra, así que al reservar esa columna está vacía.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 6 · `cio.appointment_attended` — ¿asistió o no?
--
-- La rama "¿asistió al turno?" de Hyppo ya estaba armada y no tenía de dónde
-- leer. La señal existía en la base pero repartida: `status = 'completed'` /
-- `'no_show'`, más `started_at` para el que arrancó.
--
-- Sólo aparecen los turnos YA RESUELTOS. Un turno de mañana no es un "no
-- asistió": es un turno que todavía no pasó, y meterlo acá con `false` dispara
-- el reagendado antes de que la consulta ocurra.
-- ─────────────────────────────────────────────────────────────────────────────
drop view if exists cio.appointment_attended;

create view cio.appointment_attended with (security_invoker = false) as
select
  c.id                                     as consultation_id,
  c.patient_id                             as person_id,
  pat.email                                as patient_email,
  cio.to_e164_ar(pat.phone)                as patient_phone,
  pat.full_name                            as patient_name,

  (c.status = 'completed')                 as attended,
  c.status,

  -- Cuándo quedó resuelto — es el disparador de la campaña.
  coalesce(c.completed_at, c.professional_ended_at, c.patient_ended_at, c.scheduled_at, c.updated_at)
                                           as resolved_at,
  extract(epoch from coalesce(c.completed_at, c.professional_ended_at, c.patient_ended_at, c.scheduled_at, c.updated_at))::bigint
                                           as resolved_timestamp,

  c.scheduled_at,
  extract(epoch from c.scheduled_at)::bigint as scheduled_timestamp,
  c.started_at,
  c.duration_minutes,

  c.professional_id,
  pro.full_name                            as profesional_nombre,
  pp.id                                    as professional_profile_id,
  cio.link_reserva(pp.id, pp.is_verified)  as link_reserva,
  cio.base_url() || '/paciente/reservar'   as link_reservar
from consultations c
join profiles pat  on pat.id = c.patient_id
left join profiles pro on pro.id = c.professional_id
left join professional_profiles pp on pp.user_id = c.professional_id
where c.status in ('completed', 'no_show');

comment on view cio.appointment_attended is
  'Turnos ya resueltos con `attended` true/false — la señal que le faltaba a la rama de '
  'reagendado de Hyppo. Sólo turnos resueltos: uno futuro no es un "no asistió".';


-- ─────────────────────────────────────────────────────────────────────────────
-- 7 · `cio.consultation_completed` — el follow-up de +7 días.
--
-- El evento ya existía en `cio.events` pero sin el nombre del profesional, que
-- es literalmente lo que dice el copy ("tu consulta con {{nombre_profesional}}").
-- Se suma el link de reserva de ESE profesional, que Hyppo pidió como opcional.
-- ─────────────────────────────────────────────────────────────────────────────
drop view if exists cio.consultation_completed;

create view cio.consultation_completed with (security_invoker = false) as
select
  c.id                                     as consultation_id,
  c.patient_id                             as person_id,
  pat.email                                as patient_email,
  cio.to_e164_ar(pat.phone)                as patient_phone,
  pat.phone                                as patient_phone_raw,
  pat.full_name                            as patient_name,

  c.completed_at,
  extract(epoch from c.completed_at)::bigint as completed_timestamp,
  c.scheduled_at,
  extract(epoch from c.scheduled_at)::bigint as scheduled_timestamp,
  to_char(c.scheduled_at at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY') as fecha_turno,
  to_char(c.scheduled_at at time zone 'America/Argentina/Buenos_Aires', 'HH24:MI')    as hora_turno,

  c.professional_id,
  pro.full_name                            as profesional_nombre,
  pp.id                                    as professional_profile_id,
  cio.link_reserva(pp.id, pp.is_verified)  as link_reserva,
  cio.base_url() || '/paciente/reservar'   as link_reservar,

  c.duration_minutes,
  c.is_on_demand,
  case when cio.es_presencial(c.modality, c.is_on_demand)
       then 'presencial' else 'videoconsulta' end as modalidad,

  -- Para que el follow-up no le escriba a quien ya volvió a sacar turno.
  exists (select 1 from consultations c2
           where c2.patient_id = c.patient_id
             and c2.id <> c.id
             and c2.created_at > c.completed_at
             and c2.status in ('pending','confirmed'))
                                           as reservo_de_nuevo
from consultations c
join profiles pat  on pat.id = c.patient_id
left join profiles pro on pro.id = c.professional_id
left join professional_profiles pp on pp.user_id = c.professional_id
where c.status = 'completed' and c.completed_at is not null;

comment on view cio.consultation_completed is
  'Consultas cerradas, con el nombre del profesional y su link de reserva — lo que necesita el '
  'follow-up de +7 días. `reservo_de_nuevo` evita escribirle a quien ya volvió a sacar turno.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 8 · `cio.reminders` — se rehace con teléfono E.164, dirección y link de video.
--     Es la vista del recordatorio: si no dice dónde ni por dónde, no recuerda nada.
-- ─────────────────────────────────────────────────────────────────────────────
drop view if exists cio.reminders;

create view cio.reminders with (security_invoker = false) as
select
  c.id as consultation_id,
  c.patient_id,
  pat.email                                as patient_email,
  cio.to_e164_ar(pat.phone)                as patient_phone,
  pat.phone                                as patient_phone_raw,
  pat.full_name                            as patient_name,

  c.professional_id,
  pro.full_name                            as professional_name,
  pro.email                                as professional_email,
  cio.to_e164_ar(pro.phone)                as professional_phone,
  pro.phone                                as professional_phone_raw,

  c.scheduled_at,
  extract(epoch from c.scheduled_at)::bigint as scheduled_timestamp,
  to_char(c.scheduled_at at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY') as fecha_turno,
  to_char(c.scheduled_at at time zone 'America/Argentina/Buenos_Aires', 'HH24:MI')    as hora_turno,
  to_char(c.scheduled_at at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI') as fecha_hora_turno,
  cio.dia_semana_es(c.scheduled_at)         as dia_turno,

  c.modality,
  case when cio.es_presencial(c.modality, c.is_on_demand)
       then 'presencial' else 'videoconsulta' end as modalidad,
  c.is_on_demand,
  c.status,
  c.payment_status,

  case when cio.es_presencial(c.modality, c.is_on_demand) then pp.address end
                                           as direccion,
  (cio.es_presencial(c.modality, c.is_on_demand) and pp.address is null)
                                           as falta_direccion,
  case when not cio.es_presencial(c.modality, c.is_on_demand)
       then cio.base_url() || '/paciente/videollamada/' || c.id::text end
                                           as link_videollamada,
  case when not cio.es_presencial(c.modality, c.is_on_demand)
       then cio.base_url() || '/profesional/videollamada/' || c.id::text end
                                           as link_videollamada_profesional,
  (c.daily_room_url is not null)           as tiene_sala_de_video
from consultations c
join profiles pat on pat.id = c.patient_id
left join profiles pro on pro.id = c.professional_id
left join professional_profiles pp on pp.user_id = c.professional_id
where c.scheduled_at > now()
  and c.status in ('pending','confirmed');

comment on view cio.reminders is
  'Turnos futuros para el recordatorio, con teléfono E.164, dirección del consultorio y link de '
  'videollamada. Sin vertical, sin especialidad y sin motivo: el "para qué" del turno no sale.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 9 · `cio.appointment_confirmed` — se le suman las tres cosas que le faltaban
--     (teléfono E.164, dirección, link de video). El resto queda igual, incluida
--     la excepción de `especialidad` documentada en la migración 141.
-- ─────────────────────────────────────────────────────────────────────────────
drop view if exists cio.appointment_confirmed;

create view cio.appointment_confirmed with (security_invoker = false) as
select
  c.id                                     as consultation_id,
  c.patient_id                             as person_id,
  pat.email                                as patient_email,
  cio.to_e164_ar(pat.phone)                as patient_phone,
  pat.phone                                as patient_phone_raw,
  pat.full_name                            as patient_name,

  ev.created_at                            as confirmed_at,
  extract(epoch from ev.created_at)::bigint as confirmed_timestamp,

  c.scheduled_at,
  extract(epoch from c.scheduled_at)::bigint as scheduled_timestamp,
  to_char(c.scheduled_at at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY') as fecha_turno,
  to_char(c.scheduled_at at time zone 'America/Argentina/Buenos_Aires', 'HH24:MI')    as hora_turno,
  to_char(c.scheduled_at at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI') as fecha_hora_turno,
  cio.dia_semana_es(c.scheduled_at)         as dia_turno,

  c.professional_id,
  pro.full_name                            as profesional_nombre,
  cio.to_e164_ar(pro.phone)                as profesional_phone,
  pp.id                                    as professional_profile_id,
  pp.is_verified                           as profesional_verificado,
  pp.average_rating                        as profesional_rating,

  -- ⚠️ Dato de salud del paciente — ver la nota de la migración 141.
  coalesce(esp.label, pp.specialty)        as especialidad,

  case when cio.es_presencial(c.modality, c.is_on_demand)
       then 'presencial' else 'videoconsulta' end as modalidad,

  case when cio.es_presencial(c.modality, c.is_on_demand) then pp.address end
                                           as direccion,
  (cio.es_presencial(c.modality, c.is_on_demand) and pp.address is null)
                                           as falta_direccion,
  case when not cio.es_presencial(c.modality, c.is_on_demand)
       then cio.base_url() || '/paciente/videollamada/' || c.id::text end
                                           as link_videollamada,
  case when not cio.es_presencial(c.modality, c.is_on_demand)
       then cio.base_url() || '/profesional/videollamada/' || c.id::text end
                                           as link_videollamada_profesional,

  c.is_on_demand,
  c.payment_status,
  c.price_at_booking                       as precio
from consultation_events ev
join consultations c on c.id = ev.consultation_id
join profiles pat    on pat.id = c.patient_id
left join profiles pro on pro.id = c.professional_id
left join professional_profiles pp on pp.user_id = c.professional_id
left join specialties esp on esp.slug = pp.specialty
where ev.event = 'status_changed'
  and ev.detail ->> 'to' = 'confirmed';

comment on view cio.appointment_confirmed is
  'Un renglón por cada vez que una reserva quedó confirmada, por cualquiera de los dos caminos. '
  'Lleva `especialidad`, que es dato de salud del paciente: sale a pedido explícito porque el copy '
  'del mail la nombra (ver migración 141). Desde la 166 también lleva teléfono E.164, dirección y '
  'link de videollamada.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 10 · `cio.events` — se suman los dos hechos que faltaban en la línea de tiempo:
--      asistió / no asistió, y el envío del legajo profesional. Sin texto libre.
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
  -- Asistencia. Dos nombres en vez de un booleano: así la campaña ramifica por
  -- nombre de evento, que es como está armada la rama de reagendado de Hyppo.
  select c.id, 'appointment_attended', c.patient_id, c.completed_at,
         c.price_at_booking, c.modality, c.is_on_demand, c.professional_id
    from consultations c where c.status = 'completed' and c.completed_at is not null
union all
  select c.id, 'appointment_no_show', c.patient_id,
         coalesce(c.professional_ended_at, c.patient_ended_at, c.scheduled_at), null,
         c.modality, c.is_on_demand, c.professional_id
    from consultations c where c.status = 'no_show'
union all
  select pay.id, 'payment_approved', pay.patient_id, pay.created_at, pay.charged_amount,
         null, null, pay.professional_id
    from payments pay where pay.status = 'approved'
union all
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
    from reviews r
union all
  -- El profesional envió el legajo a revisión: es el "signup completo" de su lado.
  select pp.id, 'professional_submitted', pp.user_id, pp.submitted_at, null,
         null, null, pp.user_id
    from professional_profiles pp where pp.submitted_at is not null
union all
  select pp.id, 'professional_verified', pp.user_id, pp.verified_at, null,
         null, null, pp.user_id
    from professional_profiles pp where pp.verified_at is not null;

comment on view cio.events is
  'Hechos de negocio para Customer.io. Sin motivo de consulta, notas de cierre, '
  'preconsulta_data, hc_draft, diagnóstico ni nombre de medicamento.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 11 · Un índice que faltaba. `reviews` tiene índice por `professional_id`
--      (migración 001) pero no por `patient_id`, que es por donde entra
--      `resenas_dejadas` en `cio.people` — una vez por persona en cada sync.
-- ─────────────────────────────────────────────────────────────────────────────
create index if not exists idx_reviews_patient on public.reviews(patient_id);


-- ─────────────────────────────────────────────────────────────────────────────
-- 12 · Permisos. Las vistas nuevas y las recreadas pierden sus grants al
--      dropearse, así que se vuelven a conceder de una.
-- ─────────────────────────────────────────────────────────────────────────────
grant usage  on schema cio to cio_reader;
grant select on all tables in schema cio to cio_reader;
alter default privileges in schema cio grant select on tables to cio_reader;
grant execute on function cio.to_e164_ar(text) to cio_reader;
grant execute on function cio.base_url()       to cio_reader;
grant execute on function cio.es_presencial(text, boolean)        to cio_reader;
grant execute on function cio.dia_semana_es(timestamptz)          to cio_reader;
grant execute on function cio.documentos_faltantes(professional_profiles)  to cio_reader;
grant execute on function cio.documentos_requeridos(professional_profiles) to cio_reader;
grant execute on function cio.documentos_subidos(professional_profiles)    to cio_reader;
grant execute on function cio.estado_verificacion(professional_profiles)   to cio_reader;
grant execute on function cio.link_reserva(uuid, boolean)         to cio_reader;
