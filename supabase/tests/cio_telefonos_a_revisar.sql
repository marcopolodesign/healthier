-- Cuántos teléfonos no se pueden normalizar a E.164, y qué forma tienen.
--
--   bash scripts/correr-test.sh cio_telefonos_a_revisar prod
--
-- Es la lista de trabajo manual que queda antes de que las campañas de WhatsApp
-- de Hyppo lleguen a todos. Devuelve SÓLO la forma —código de área, cuántos
-- dígitos— y el conteo; nunca el número.
with crudos as (
  select role, regexp_replace(phone_raw, '\D', '', 'g') as d
    from cio.people where phone_a_revisar
)
select role,
       left(d, 3)                     as prefijo,
       length(d)                      as digitos,
       (left(d, 1) = '0')             as empieza_con_0,
       count(*)                       as cuantos
  from crudos
 group by 1, 2, 3, 4
 order by cuantos desc, prefijo;
