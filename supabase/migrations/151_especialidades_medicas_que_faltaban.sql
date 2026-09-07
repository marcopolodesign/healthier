-- 151 — Las especialidades médicas que faltaban en el catálogo
--
-- El onboarding del profesional sólo ofrecía cuatro especialidades bajo la
-- profesión "Médico": Medicina General, Pediatría, Cardiología y Dermatología.
-- Un ginecólogo, un traumatólogo o un oftalmólogo no encontraba la suya y el
-- único camino era elegir la profesión "Otra" y escribirla a mano como
-- sub-especialidad — con lo cual quedaba fuera de cualquier agrupación.
--
-- `vertical_id` queda en NULL a propósito, igual que Cardiología y Dermatología:
-- las verticales son los pools de consulta inmediata del paciente (Clínica,
-- Pediatría, Nutrición, Psicología, Kinesiología, Veterinaria). Meter a un
-- ginecólogo en el pool de "Clínica" haría que le llegue una consulta general
-- que no pidió.
--
-- `puede_recetar` va en true: todas son especialidades médicas con matrícula
-- habilitante. De paso se corrige lo mismo en Cardiología y Dermatología, que
-- habían quedado en false cuando se agregó la columna (migración 116) — un
-- cardiólogo no podía emitir una receta.

insert into specialties (slug, label, vertical_id, parent_id, active, sort_order, puede_recetar)
values
  ('ginecologia',          'Ginecología',          null, null, true, 31, true),
  ('traumatologia',        'Traumatología',        null, null, true, 32, true),
  ('neurologia',           'Neurología',           null, null, true, 33, true),
  ('oftalmologia',         'Oftalmología',         null, null, true, 34, true),
  ('psiquiatria',          'Psiquiatría',          null, null, true, 35, true),
  ('endocrinologia',       'Endocrinología',       null, null, true, 36, true),
  ('gastroenterologia',    'Gastroenterología',    null, null, true, 37, true),
  ('otorrinolaringologia', 'Otorrinolaringología', null, null, true, 38, true),
  ('urologia',             'Urología',             null, null, true, 39, true)
on conflict (slug) do update
  set label         = excluded.label,
      active        = true,
      puede_recetar = excluded.puede_recetar;

update specialties
   set puede_recetar = true
 where slug in ('cardiologia', 'dermatologia');
