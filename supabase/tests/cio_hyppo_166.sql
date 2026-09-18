-- Verificación de la migración 166 — lo que pidió Hyppo para prender las campañas.
--
--   bash scripts/correr-test.sh cio_hyppo_166 staging
--
-- Corre COMO `cio_reader`, que es el rol con el que entra Customer.io: si una
-- vista existe pero el rol no la puede leer, acá sale. Devuelve contadores y
-- aserciones — nunca una fila con los datos de una persona.
set local role cio_reader;

-- Todas las filas tienen que dar ok = true.
select 'todo turno dice dónde o por dónde' as asercion,
       count(*) = 0 as ok,
       count(*)     as filas_mal
  from cio.appointment_booked
 where direccion is null and link_videollamada is null and not falta_direccion
union all
select 'todo turno resuelto tiene fecha', count(*) = 0, count(*)
  from cio.appointment_attended where resolved_at is null
union all
select 'todo turno tiene modalidad', count(*) = 0, count(*)
  from cio.appointment_booked where modalidad is null
union all
select 'el follow-up sabe con quién fue', count(*) = 0, count(*)
  from cio.consultation_completed where profesional_nombre is null
union all
select 'ningún profesional sin estado', count(*) = 0, count(*)
  from cio.professional_verification where estado is null
union all
select 'todo signup incompleto dice qué falta', count(*) = 0, count(*)
  from cio.people where not signup_completo and signup_paso_faltante is null
union all
-- La bandera y la lista tienen que decir lo mismo. `array_to_string` de un
-- array vacío devuelve '' y no NULL, así que esto ya se rompió una vez.
select 'faltan_documentos coincide con la lista', count(*) = 0, count(*)
  from cio.professional_verification
 where faltan_documentos <> (documentos_faltantes is not null)
union all
select 'documentos_faltantes nunca es cadena vacía', count(*) = 0, count(*)
  from cio.professional_verification where documentos_faltantes = ''
union all
select 'ningún teléfono E.164 malformado', count(*) = 0, count(*)
  from cio.people where phone is not null and phone !~ '^\+[1-9]\d{7,14}$';
