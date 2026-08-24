-- Seed working hours for profesional@healthier.app (Dra. Valentina Ortega)
-- Mon–Fri: 09:00–13:00 and 15:00–19:00  |  Sat: 09:00–13:00

DO $seed$
BEGIN
  -- Guard agregado el 2026-08-24: estos datos demo apuntan a usuarios de
  -- `auth.users` con UUID fijo que existen en producción pero NO en una base
  -- nueva. Sin esto, reconstruir la base desde el repo fallaba acá por
  -- violación de foreign key. Donde no están los usuarios, la migración
  -- simplemente no siembra nada — que es lo correcto: son datos de demo, no
  -- esquema. (Ver la migración 000 y el catchup del 2026-08-24.)
  if not exists (select 1 from public.profiles where id = 'a0fb6e60-a920-4290-b9fe-d926c5d2f7c3') then
    raise notice 'Seed omitido: no existe la profesional demo en esta base.';
    return;
  end if;

  INSERT INTO public.professional_schedules (professional_id, day_of_week, start_time, end_time)
  VALUES
    -- Lunes
    ('a0fb6e60-a920-4290-b9fe-d926c5d2f7c3', 1, '09:00', '13:00'),
    ('a0fb6e60-a920-4290-b9fe-d926c5d2f7c3', 1, '15:00', '19:00'),
    -- Martes
    ('a0fb6e60-a920-4290-b9fe-d926c5d2f7c3', 2, '09:00', '13:00'),
    ('a0fb6e60-a920-4290-b9fe-d926c5d2f7c3', 2, '15:00', '19:00'),
    -- Miércoles
    ('a0fb6e60-a920-4290-b9fe-d926c5d2f7c3', 3, '09:00', '13:00'),
    ('a0fb6e60-a920-4290-b9fe-d926c5d2f7c3', 3, '15:00', '19:00'),
    -- Jueves
    ('a0fb6e60-a920-4290-b9fe-d926c5d2f7c3', 4, '09:00', '13:00'),
    ('a0fb6e60-a920-4290-b9fe-d926c5d2f7c3', 4, '15:00', '19:00'),
    -- Viernes
    ('a0fb6e60-a920-4290-b9fe-d926c5d2f7c3', 5, '09:00', '13:00'),
    ('a0fb6e60-a920-4290-b9fe-d926c5d2f7c3', 5, '15:00', '19:00'),
    -- Sábado (mañana)
    ('a0fb6e60-a920-4290-b9fe-d926c5d2f7c3', 6, '09:00', '13:00')
  ON CONFLICT (professional_id, day_of_week, start_time) DO NOTHING;
END $seed$;
