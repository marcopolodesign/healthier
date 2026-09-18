-- Contadores de la migración 166 — para mirar que las vistas de Hyppo traen
-- poblado lo que se pidió. Las aserciones pasa/falla están en `cio_hyppo_166`.
--
--   bash scripts/correr-test.sh cio_hyppo_166_conteos staging
--
-- Corre COMO `cio_reader`, el rol con el que entra Customer.io.
set local role cio_reader;

select 'people'                as vista,
       count(*)                as filas,
       count(phone)            as con_phone_e164,
       count(*) filter (where phone_a_revisar)      as phone_a_revisar,
       count(*) filter (where signup_completo)      as signup_completo,
       count(signup_paso_faltante)                  as con_paso_faltante,
       count(verificacion_estado)                   as con_estado_verificacion,
       count(link_reserva)                          as con_link_reserva
  from cio.people
union all
select 'professional_verification', count(*), count(phone),
       count(*) filter (where faltan_documentos),
       count(*) filter (where estado = 'verificado'),
       count(*) filter (where estado = 'en_revision'),
       count(*) filter (where tiene_observacion),
       count(dias_esperando_revision)
  from cio.professional_verification
union all
select 'appointment_booked', count(*), count(patient_phone), count(profesional_nombre),
       count(fecha_hora_turno), count(direccion), count(link_videollamada),
       count(*) filter (where falta_direccion)
  from cio.appointment_booked
union all
select 'appointment_attended', count(*), count(patient_phone),
       count(*) filter (where attended), count(*) filter (where not attended),
       count(resolved_timestamp), count(profesional_nombre), 0
  from cio.appointment_attended
union all
select 'consultation_completed', count(*), count(patient_phone), count(profesional_nombre),
       count(completed_timestamp), count(link_reserva),
       count(*) filter (where reservo_de_nuevo), 0
  from cio.consultation_completed
union all
select 'reminders', count(*), count(patient_phone), count(professional_name),
       count(fecha_hora_turno), count(direccion), count(link_videollamada), 0
  from cio.reminders
union all
select 'appointment_confirmed', count(*), count(patient_phone), count(profesional_nombre),
       count(fecha_hora_turno), count(direccion), count(link_videollamada), 0
  from cio.appointment_confirmed
union all
select 'events', count(*),
       count(*) filter (where event_name = 'appointment_attended'),
       count(*) filter (where event_name = 'appointment_no_show'),
       count(*) filter (where event_name = 'consultation_completed'),
       count(*) filter (where event_name = 'professional_submitted'),
       count(*) filter (where event_name = 'professional_verified'), 0
  from cio.events;
