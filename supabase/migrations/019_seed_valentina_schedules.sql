-- Seed working hours for profesional@healthier.app (Dra. Valentina Ortega)
-- Mon–Fri: 09:00–13:00 and 15:00–19:00  |  Sat: 09:00–13:00

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
