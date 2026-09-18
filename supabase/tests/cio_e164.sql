-- Test de `cio.to_e164_ar` (migración 166).
--
-- El formato del teléfono es el stopper transversal de todas las campañas de
-- WhatsApp de Hyppo: si sale mal, el envío falla o le llega a otra persona. Los
-- casos de abajo son los formatos que de verdad hay cargados en `profiles`,
-- escritos con el número de ejemplo 11-0000-0000 (reservado, no asignado).
--
--   bash scripts/correr-test.sh cio_e164 staging
--
-- Todas las filas tienen que dar `ok = true`.
select
  caso,
  cio.to_e164_ar(entrada) as obtenido,
  esperado,
  cio.to_e164_ar(entrada) is not distinct from esperado as ok
from (values
  ('local con guion',        '11 0000-0000',      '+5491100000000'),
  ('local con 0 de LD',      '01100000000',       '+5491100000000'),
  ('local con 15 de celular','11 15 0000-0000',   '+5491100000000'),
  ('diez digitos pelados',   '1100000000',        '+5491100000000'),
  ('ya en E.164 con 9',      '+54 9 11 0000-0000','+5491100000000'),
  ('E.164 sin el 9',         '+541100000000',     '+5491100000000'),
  ('sin + pero con 54 y 9',  '5491100000000',     '+5491100000000'),
  ('sin + con 54 sin el 9',  '541100000000',      '+5491100000000'),
  ('interior 10 digitos con 5 al medio', '2615000000',  '+5492615000000'),
  ('interior con 15 de verdad',          '261 15 500-0000', '+5492615000000'),
  ('movil nacional con 9 adelante',      '91100000000', '+5491100000000'),
  ('demasiado corto',                    '1160000',     null),
  -- Sin el "+" no hay forma de saber si "591…" es Bolivia o un número
  -- argentino mal cargado. Adivinar manda un WhatsApp a un desconocido, así
  -- que se devuelve NULL y la persona cae en `phone_a_revisar`.
  ('otro pais sin +',                    '59170000000', null),
  ('otro pais',              '+1 415 000 0000',   '+14150000000'),
  ('texto',                  'no tengo',           null),
  ('vacio',                  '',                   null),
  ('nulo',                   null,                 null)
) v(caso, entrada, esperado);
