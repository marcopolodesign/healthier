-- Verificación de la migración 189 — horarios, dirección y documento
-- extranjero en cio.people, y los links con www.healthier.com.ar.
--
--   bash scripts/correr-test.sh cio_189 staging
--   bash scripts/correr-test.sh cio_189 prod
--
-- Corre COMO `cio_reader`, el rol con el que entra Customer.io. Devuelve
-- aserciones y contadores — nunca una fila con los datos de una persona, y
-- nunca un número de documento.
set local role cio_reader;

-- Todas las filas de aserción tienen que dar ok = true.
select 'el número de documento no sale por cio' as asercion,
       count(*) = 0 as ok,
       count(*)     as detalle
  from information_schema.columns
 where table_schema = 'cio'
   and column_name ilike '%dni%'
   and data_type <> 'boolean'  -- tiene_dni es booleano: el número nunca
union all
select 'documento: DNI argentino con puntos → false',
       cio.documento_extranjero('30.111.222') is false, null
union all
select 'documento: DNI ≥ 90 millones → true',
       cio.documento_extranjero('95123456') is true, null
union all
select 'documento: justo 90.000.000 → true',
       cio.documento_extranjero('90.000.000') is true, null
union all
select 'documento: pasaporte (no numérico) → true',
       cio.documento_extranjero('AB123456') is true, null
union all
select 'documento: sin documento → NULL',
       cio.documento_extranjero(null) is null and cio.documento_extranjero('  ') is null, null
union all
select 'todo profesional tiene tiene_horarios y tiene_direccion', count(*) = 0, count(*)
  from cio.people
 where role = 'professional' and (tiene_horarios is null or tiene_direccion is null)
union all
select 'quien no es profesional no tiene tiene_horarios ni tiene_direccion', count(*) = 0, count(*)
  from cio.people
 where role <> 'professional' and (tiene_horarios is not null or tiene_direccion is not null)
union all
select 'documento_extranjero es NULL sólo sin DNI', count(*) = 0, count(*)
  from cio.people
 where (documento_extranjero is null) <> (not tiene_dni)
union all
select 'base_url es el dominio propio', cio.base_url() = 'https://www.healthier.com.ar', null
union all
select 'ningún link de reserva apunta a vercel', count(*) = 0, count(*)
  from cio.people
 where link_reserva is not null and link_reserva not like 'https://www.healthier.com.ar/%'

-- Contadores (para comparar con lo que pidió Mateo: 52/30 de 76, 66/9/1).
union all
select 'conteo · profesionales con legajo', null,
       count(*) from cio.people where role = 'professional' and verificacion_estado is not null
union all
select 'conteo · con legajo y horarios', null,
       count(*) from cio.people where verificacion_estado is not null and tiene_horarios
union all
select 'conteo · con legajo y dirección', null,
       count(*) from cio.people where verificacion_estado is not null and tiene_direccion
union all
select 'conteo · con legajo, documento argentino', null,
       count(*) from cio.people where verificacion_estado is not null and documento_extranjero is false
union all
select 'conteo · con legajo, documento extranjero', null,
       count(*) from cio.people where verificacion_estado is not null and documento_extranjero
union all
select 'conteo · con legajo, sin documento', null,
       count(*) from cio.people where verificacion_estado is not null and documento_extranjero is null;
