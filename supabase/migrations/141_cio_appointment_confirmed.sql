-- 141 — `cio.appointment_confirmed`: el evento que pidió el equipo de Hyppo.
--
-- Momento: cuando la reserva queda CONFIRMADA, no cuando se crea. Son dos cosas
-- distintas y hay dos caminos que llevan al mismo estado:
--   1. el profesional confirma el turno a mano (`updateStatus`), y
--   2. `mp-payment` pasa `pending` → `confirmed` al acreditarse el pago.
-- Por eso la fuente es `consultation_events` y no un hook en el código: el
-- trigger `consultations_log_status` (migración 070) escribe una fila por CADA
-- transición, venga de donde venga. Un hook en el cliente se perdería el camino 2.
--
-- ⚠️ ESTA VISTA LLEVA `especialidad`, Y ESO ES UN DATO DE SALUD DEL PACIENTE.
-- El resto de `cio` está construido para que no salga (ver migración 140). Acá
-- sale a pedido explícito de Mateo, porque el mail de confirmación lo nombra
-- ("tu videoconsulta de Dermatología con la Dra. X"): si el copy lo dice, el
-- dato entra a Customer.io sí o sí y no hay truco de esquema que lo evite.
-- Lo que lo hace legítimo entonces no es técnico — es el contrato de encargado
-- de tratamiento con Customer.io cubriendo datos de salud, más el consentimiento
-- del paciente. Si esa cobertura no está, se saca `especialidad` de acá y el
-- copy pasa a "tu consulta con la Dra. X": es una línea, y el resto sigue igual.

create or replace view cio.appointment_confirmed with (security_invoker = false) as
select
  c.id                                     as consultation_id,
  c.patient_id                             as person_id,
  pat.email                                as patient_email,
  pat.phone                                as patient_phone,
  pat.full_name                            as patient_name,

  -- Cuándo quedó confirmada (para deduplicar del lado de Customer.io).
  ev.created_at                            as confirmed_at,
  extract(epoch from ev.created_at)::bigint as confirmed_timestamp,

  -- El turno, en hora de Buenos Aires y ya formateado: armar esto con Liquid
  -- adentro de Customer.io es incómodo porque guarda UTC y no tiene timezone.
  c.scheduled_at,
  to_char(c.scheduled_at at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY') as fecha_turno,
  to_char(c.scheduled_at at time zone 'America/Argentina/Buenos_Aires', 'HH24:MI')    as hora_turno,
  -- `to_char(..., 'Day')` sale en inglés: la base tiene lc_time en C y no se
  -- toca por una etiqueta. Se mapea a mano.
  (array['domingo','lunes','martes','miércoles','jueves','viernes','sábado'])[
    extract(dow from c.scheduled_at at time zone 'America/Argentina/Buenos_Aires')::int + 1
  ]                                        as dia_turno,

  -- El profesional.
  c.professional_id,
  pro.full_name                            as profesional_nombre,
  pp.is_verified                           as profesional_verificado,
  pp.average_rating                        as profesional_rating,

  -- ⚠️ Dato de salud del paciente — ver la nota de arriba.
  coalesce(esp.label, pp.specialty)        as especialidad,

  -- Modalidad, con las etiquetas que van al copy.
  case
    when c.is_on_demand              then 'videoconsulta'
    when c.modality = 'presencial'   then 'presencial'
    when c.modality is null          then null
    else 'videoconsulta'
  end                                      as modalidad,

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
  'Un renglón por cada vez que una reserva quedó confirmada, por cualquiera de los dos caminos '
  '(el profesional la confirma, o se acredita el pago). Lleva `especialidad`, que es dato de salud '
  'del paciente: sale a pedido explícito porque el copy del mail la nombra, y depende del contrato '
  'de encargado de tratamiento con Customer.io — no de un recorte de esquema.';

grant select on cio.appointment_confirmed to cio_reader;
