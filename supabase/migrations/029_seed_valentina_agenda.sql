-- ============================================================
-- Seed: Dra. Valentina Ortega — patients, today's agenda, and
-- 4 weeks of historical consultations for revenue dashboard.
--
-- profesional@healthier.app → a0fb6e60-a920-4290-b9fe-d926c5d2f7c3
-- Today: 2026-06-11 (Wednesday)  ART = UTC-3
-- ============================================================

DO $$
DECLARE
  v_pro uuid := 'a0fb6e60-a920-4290-b9fe-d926c5d2f7c3';

  -- Patient IDs
  p1 uuid := '00000030-0000-0000-0000-000000000030';  -- Lucía Fernández
  p2 uuid := '00000031-0000-0000-0000-000000000031';  -- Matías Rodríguez
  p3 uuid := '00000032-0000-0000-0000-000000000032';  -- Camila Herrera
  p4 uuid := '00000033-0000-0000-0000-000000000033';  -- Diego Suárez
  p5 uuid := '00000034-0000-0000-0000-000000000034';  -- Sofía Méndez
  p6 uuid := '00000035-0000-0000-0000-000000000035';  -- Valentín Castro
  p7 uuid := '00000036-0000-0000-0000-000000000036';  -- Ana Belén Torres

  -- Extra patients for historical consultations
  p8  uuid := '00000037-0000-0000-0000-000000000037';  -- Ramiro Acosta
  p9  uuid := '00000038-0000-0000-0000-000000000038';  -- Florencia Leal
  p10 uuid := '00000039-0000-0000-0000-000000000039';  -- Nicolás Vera

  c_id uuid;
BEGIN

  -- ────────────────────────────────────────────────────────────
  -- 1. Auth users (minimal — email-confirmed, no password needed
  --    for seed purposes; these accounts won't be logged into)
  -- ────────────────────────────────────────────────────────────
  INSERT INTO auth.users (
    instance_id, id, aud, role, email,
    encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) VALUES
    ('00000000-0000-0000-0000-000000000000', p1, 'authenticated', 'authenticated',
     'lucia.fernandez@demo.healthier.app',
     extensions.crypt('DemoUser2026!', extensions.gen_salt('bf', 10)),
     NOW(), '{"provider":"email","providers":["email"]}', '{}', NOW(), NOW()),
    ('00000000-0000-0000-0000-000000000000', p2, 'authenticated', 'authenticated',
     'matias.rodriguez@demo.healthier.app',
     extensions.crypt('DemoUser2026!', extensions.gen_salt('bf', 10)),
     NOW(), '{"provider":"email","providers":["email"]}', '{}', NOW(), NOW()),
    ('00000000-0000-0000-0000-000000000000', p3, 'authenticated', 'authenticated',
     'camila.herrera@demo.healthier.app',
     extensions.crypt('DemoUser2026!', extensions.gen_salt('bf', 10)),
     NOW(), '{"provider":"email","providers":["email"]}', '{}', NOW(), NOW()),
    ('00000000-0000-0000-0000-000000000000', p4, 'authenticated', 'authenticated',
     'diego.suarez@demo.healthier.app',
     extensions.crypt('DemoUser2026!', extensions.gen_salt('bf', 10)),
     NOW(), '{"provider":"email","providers":["email"]}', '{}', NOW(), NOW()),
    ('00000000-0000-0000-0000-000000000000', p5, 'authenticated', 'authenticated',
     'sofia.mendez@demo.healthier.app',
     extensions.crypt('DemoUser2026!', extensions.gen_salt('bf', 10)),
     NOW(), '{"provider":"email","providers":["email"]}', '{}', NOW(), NOW()),
    ('00000000-0000-0000-0000-000000000000', p6, 'authenticated', 'authenticated',
     'valentin.castro@demo.healthier.app',
     extensions.crypt('DemoUser2026!', extensions.gen_salt('bf', 10)),
     NOW(), '{"provider":"email","providers":["email"]}', '{}', NOW(), NOW()),
    ('00000000-0000-0000-0000-000000000000', p7, 'authenticated', 'authenticated',
     'anabelen.torres@demo.healthier.app',
     extensions.crypt('DemoUser2026!', extensions.gen_salt('bf', 10)),
     NOW(), '{"provider":"email","providers":["email"]}', '{}', NOW(), NOW()),
    ('00000000-0000-0000-0000-000000000000', p8, 'authenticated', 'authenticated',
     'ramiro.acosta@demo.healthier.app',
     extensions.crypt('DemoUser2026!', extensions.gen_salt('bf', 10)),
     NOW(), '{"provider":"email","providers":["email"]}', '{}', NOW(), NOW()),
    ('00000000-0000-0000-0000-000000000000', p9, 'authenticated', 'authenticated',
     'florencia.leal@demo.healthier.app',
     extensions.crypt('DemoUser2026!', extensions.gen_salt('bf', 10)),
     NOW(), '{"provider":"email","providers":["email"]}', '{}', NOW(), NOW()),
    ('00000000-0000-0000-0000-000000000000', p10, 'authenticated', 'authenticated',
     'nicolas.vera@demo.healthier.app',
     extensions.crypt('DemoUser2026!', extensions.gen_salt('bf', 10)),
     NOW(), '{"provider":"email","providers":["email"]}', '{}', NOW(), NOW())
  ON CONFLICT (id) DO NOTHING;

  -- ────────────────────────────────────────────────────────────
  -- 2. Profiles
  -- ────────────────────────────────────────────────────────────
  INSERT INTO public.profiles (id, email, full_name, avatar_url, role, blood_type, insurance_name, insurance_num) VALUES
    (p1, 'lucia.fernandez@demo.healthier.app',   'Lucía Fernández',     'https://randomuser.me/api/portraits/women/12.jpg', 'patient', 'A+',  'OSDE',       '1234567'),
    (p2, 'matias.rodriguez@demo.healthier.app',  'Matías Rodríguez',    'https://randomuser.me/api/portraits/men/22.jpg',   'patient', 'O+',  'Swiss Medical', '9876543'),
    (p3, 'camila.herrera@demo.healthier.app',    'Camila Herrera',      'https://randomuser.me/api/portraits/women/33.jpg', 'patient', 'B+',  'Galeno',     '5551234'),
    (p4, 'diego.suarez@demo.healthier.app',      'Diego Suárez',        'https://randomuser.me/api/portraits/men/44.jpg',   'patient', 'AB-', 'PAMI',       '4445678'),
    (p5, 'sofia.mendez@demo.healthier.app',      'Sofía Méndez',        'https://randomuser.me/api/portraits/women/55.jpg', 'patient', 'O-',  'Medifé',     '3337890'),
    (p6, 'valentin.castro@demo.healthier.app',   'Valentín Castro',     'https://randomuser.me/api/portraits/men/66.jpg',   'patient', 'A-',  'OSDE',       '2221234'),
    (p7, 'anabelen.torres@demo.healthier.app',   'Ana Belén Torres',    'https://randomuser.me/api/portraits/women/77.jpg', 'patient', 'B-',  'Swiss Medical', '1115678'),
    (p8, 'ramiro.acosta@demo.healthier.app',     'Ramiro Acosta',       'https://randomuser.me/api/portraits/men/11.jpg',   'patient', 'O+',  'Galeno',     '9990123'),
    (p9, 'florencia.leal@demo.healthier.app',    'Florencia Leal',      'https://randomuser.me/api/portraits/women/88.jpg', 'patient', 'A+',  'OSDE',       '8880123'),
    (p10,'nicolas.vera@demo.healthier.app',      'Nicolás Vera',        'https://randomuser.me/api/portraits/men/99.jpg',   'patient', 'O-',  'Medifé',     '7770123')
  ON CONFLICT (id) DO NOTHING;

  -- ────────────────────────────────────────────────────────────
  -- 3. TODAY'S AGENDA — Wednesday 2026-06-11 (ART = UTC-3)
  --    09:00 completed (presencial)
  --    09:45 completed (presencial)
  --    10:30 in_progress (presencial)
  --    11:15 confirmed  (presencial)
  --    12:00 confirmed  (presencial)
  --    15:30 confirmed  (video)
  --    16:15 confirmed  (video)
  -- ────────────────────────────────────────────────────────────

  -- 09:00 ART — Lucía Fernández — COMPLETED presencial
  INSERT INTO public.consultations (
    patient_id, professional_id, status, modality,
    scheduled_at, started_at, completed_at,
    duration_minutes, closing_notes,
    payment_status, price_at_booking,
    vertical, created_at, updated_at
  ) VALUES (
    p1, v_pro, 'completed', 'presencial',
    '2026-06-11 12:00:00+00', '2026-06-11 12:02:00+00', '2026-06-11 12:47:00+00',
    45, 'Control rutinario. Presión arterial normal. Sin cambios en medicación.',
    'paid', 10500,
    'Cardiología', NOW(), NOW()
  ) ON CONFLICT DO NOTHING;

  -- 09:45 ART — Matías Rodríguez — COMPLETED presencial
  INSERT INTO public.consultations (
    patient_id, professional_id, status, modality,
    scheduled_at, started_at, completed_at,
    duration_minutes, closing_notes,
    payment_status, price_at_booking,
    vertical, obra_social_name, affiliate_number,
    created_at, updated_at
  ) VALUES (
    p2, v_pro, 'completed', 'presencial',
    '2026-06-11 12:45:00+00', '2026-06-11 12:47:00+00', '2026-06-11 13:35:00+00',
    48, 'Ecocardiograma solicitado. Seguimiento en 30 días.',
    'paid', 10500,
    'Cardiología', 'Swiss Medical', '9876543',
    NOW(), NOW()
  ) ON CONFLICT DO NOTHING;

  -- 10:30 ART — Camila Herrera — IN PROGRESS presencial
  INSERT INTO public.consultations (
    patient_id, professional_id, status, modality,
    scheduled_at, started_at,
    payment_status, price_at_booking,
    vertical, obra_social_name, affiliate_number,
    created_at, updated_at
  ) VALUES (
    p3, v_pro, 'in_progress', 'presencial',
    '2026-06-11 13:30:00+00', '2026-06-11 13:33:00+00',
    'pending_payment', 10500,
    'Cardiología', 'Galeno', '5551234',
    NOW(), NOW()
  ) ON CONFLICT DO NOTHING;

  -- 11:15 ART — Diego Suárez — CONFIRMED presencial
  INSERT INTO public.consultations (
    patient_id, professional_id, status, modality,
    scheduled_at, payment_status, price_at_booking,
    vertical, obra_social_name, affiliate_number,
    created_at, updated_at
  ) VALUES (
    p4, v_pro, 'confirmed', 'presencial',
    '2026-06-11 14:15:00+00', 'pending_payment', 10500,
    'Cardiología', 'PAMI', '4445678',
    NOW(), NOW()
  ) ON CONFLICT DO NOTHING;

  -- 12:00 ART — Sofía Méndez — CONFIRMED presencial
  INSERT INTO public.consultations (
    patient_id, professional_id, status, modality,
    scheduled_at, payment_status, price_at_booking,
    vertical, created_at, updated_at
  ) VALUES (
    p5, v_pro, 'confirmed', 'presencial',
    '2026-06-11 15:00:00+00', 'pending_payment', 10500,
    'Cardiología', NOW(), NOW()
  ) ON CONFLICT DO NOTHING;

  -- 15:30 ART — Valentín Castro — CONFIRMED video
  INSERT INTO public.consultations (
    patient_id, professional_id, status, modality,
    scheduled_at, payment_status, price_at_booking,
    vertical, obra_social_name, affiliate_number,
    created_at, updated_at
  ) VALUES (
    p6, v_pro, 'confirmed', 'video',
    '2026-06-11 18:30:00+00', 'paid', 9000,
    'Cardiología', 'OSDE', '2221234',
    NOW(), NOW()
  ) ON CONFLICT DO NOTHING;

  -- 16:15 ART — Ana Belén Torres — CONFIRMED video
  INSERT INTO public.consultations (
    patient_id, professional_id, status, modality,
    scheduled_at, payment_status, price_at_booking,
    vertical, obra_social_name, affiliate_number,
    created_at, updated_at
  ) VALUES (
    p7, v_pro, 'confirmed', 'video',
    '2026-06-11 19:15:00+00', 'paid', 9000,
    'Cardiología', 'Swiss Medical', '1115678',
    NOW(), NOW()
  ) ON CONFLICT DO NOTHING;

  -- ────────────────────────────────────────────────────────────
  -- 4. HISTORICAL CONSULTATIONS — past 4 weeks (completed, paid)
  --    Week 1: May 12–16
  --    Week 2: May 19–23
  --    Week 3: May 26–30
  --    Week 4: June 2–6
  -- ────────────────────────────────────────────────────────────

  -- ── Week of June 2 ──
  INSERT INTO public.consultations (patient_id, professional_id, status, modality, scheduled_at, started_at, completed_at, duration_minutes, closing_notes, payment_status, price_at_booking, vertical, obra_social_name, created_at, updated_at) VALUES
    (p8,  v_pro, 'completed', 'presencial', '2026-06-02 12:00:00+00', '2026-06-02 12:02:00+00', '2026-06-02 12:48:00+00', 46, 'Holter de 24 hs solicitado.', 'paid', 10500, 'Cardiología', 'Galeno', NOW(), NOW()),
    (p9,  v_pro, 'completed', 'video',      '2026-06-02 15:30:00+00', '2026-06-02 15:31:00+00', '2026-06-02 16:10:00+00', 39, 'Ajuste de dosis antihipertensiva.', 'paid', 9000, 'Cardiología', 'OSDE', NOW(), NOW()),
    (p10, v_pro, 'completed', 'presencial', '2026-06-03 12:00:00+00', '2026-06-03 12:03:00+00', '2026-06-03 12:50:00+00', 47, 'Primer control post cirugía. Evolución favorable.', 'paid', 10500, 'Cardiología', NULL, NOW(), NOW()),
    (p1,  v_pro, 'completed', 'video',      '2026-06-03 15:00:00+00', '2026-06-03 15:01:00+00', '2026-06-03 15:42:00+00', 41, 'Seguimiento presión arterial. Bien controlada.', 'paid', 9000, 'Cardiología', 'OSDE', NOW(), NOW()),
    (p2,  v_pro, 'completed', 'presencial', '2026-06-04 12:00:00+00', '2026-06-04 12:01:00+00', '2026-06-04 12:46:00+00', 45, 'Stress test programado para la semana próxima.', 'paid', 10500, 'Cardiología', 'Swiss Medical', NOW(), NOW()),
    (p3,  v_pro, 'completed', 'presencial', '2026-06-05 12:45:00+00', '2026-06-05 12:47:00+00', '2026-06-05 13:32:00+00', 45, 'Buena evolución. Continúa tratamiento.', 'paid', 10500, 'Cardiología', 'Galeno', NOW(), NOW()),
    (p4,  v_pro, 'completed', 'video',      '2026-06-05 15:30:00+00', '2026-06-05 15:32:00+00', '2026-06-05 16:15:00+00', 43, 'Control mensual. Sin novedades.', 'paid', 9000, 'Cardiología', 'PAMI', NOW(), NOW()),
    (p5,  v_pro, 'completed', 'presencial', '2026-06-06 12:00:00+00', '2026-06-06 12:02:00+00', '2026-06-06 12:50:00+00', 48, 'Derivación a electrofisiología.', 'paid', 10500, 'Cardiología', NULL, NOW(), NOW())
  ON CONFLICT DO NOTHING;

  -- ── Week of May 26 ──
  INSERT INTO public.consultations (patient_id, professional_id, status, modality, scheduled_at, started_at, completed_at, duration_minutes, closing_notes, payment_status, price_at_booking, vertical, obra_social_name, created_at, updated_at) VALUES
    (p6,  v_pro, 'completed', 'video',      '2026-05-26 15:00:00+00', '2026-05-26 15:01:00+00', '2026-05-26 15:43:00+00', 42, 'Segunda opinión arritmia. Confirmo diagnóstico.', 'paid', 9000, 'Cardiología', 'OSDE', NOW(), NOW()),
    (p7,  v_pro, 'completed', 'presencial', '2026-05-27 12:00:00+00', '2026-05-27 12:04:00+00', '2026-05-27 12:52:00+00', 48, 'Eco Doppler solicitada.', 'paid', 10500, 'Cardiología', 'Swiss Medical', NOW(), NOW()),
    (p8,  v_pro, 'completed', 'presencial', '2026-05-27 12:45:00+00', '2026-05-27 12:46:00+00', '2026-05-27 13:31:00+00', 45, 'Resultados laboratorio normales.', 'paid', 10500, 'Cardiología', 'Galeno', NOW(), NOW()),
    (p9,  v_pro, 'completed', 'video',      '2026-05-28 15:30:00+00', '2026-05-28 15:32:00+00', '2026-05-28 16:08:00+00', 36, 'Control de rutina. Sin cambios.', 'paid', 9000, 'Cardiología', 'OSDE', NOW(), NOW()),
    (p10, v_pro, 'completed', 'presencial', '2026-05-29 12:00:00+00', '2026-05-29 12:02:00+00', '2026-05-29 12:47:00+00', 45, 'Paciente refiere mejoría. Ajuste menor en beta-bloqueante.', 'paid', 10500, 'Cardiología', NULL, NOW(), NOW()),
    (p1,  v_pro, 'completed', 'presencial', '2026-05-30 12:00:00+00', '2026-05-30 12:03:00+00', '2026-05-30 12:55:00+00', 52, 'Control trimestral. Solicito perfil lipídico.', 'paid', 10500, 'Cardiología', 'OSDE', NOW(), NOW()),
    (p2,  v_pro, 'completed', 'video',      '2026-05-30 15:00:00+00', '2026-05-30 15:01:00+00', '2026-05-30 15:40:00+00', 39, 'Revisión de resultados de Holter.', 'paid', 9000, 'Cardiología', 'Swiss Medical', NOW(), NOW())
  ON CONFLICT DO NOTHING;

  -- ── Week of May 19 ──
  INSERT INTO public.consultations (patient_id, professional_id, status, modality, scheduled_at, started_at, completed_at, duration_minutes, closing_notes, payment_status, price_at_booking, vertical, obra_social_name, created_at, updated_at) VALUES
    (p3,  v_pro, 'completed', 'presencial', '2026-05-19 12:00:00+00', '2026-05-19 12:01:00+00', '2026-05-19 12:46:00+00', 45, 'Primera consulta. Anamnesis completa. Solicito estudios.', 'paid', 10500, 'Cardiología', 'Galeno', NOW(), NOW()),
    (p4,  v_pro, 'completed', 'video',      '2026-05-20 15:00:00+00', '2026-05-20 15:02:00+00', '2026-05-20 15:44:00+00', 42, 'Dolor precordial investigado. ECG sin alteraciones.', 'paid', 9000, 'Cardiología', 'PAMI', NOW(), NOW()),
    (p5,  v_pro, 'completed', 'presencial', '2026-05-21 12:00:00+00', '2026-05-21 12:03:00+00', '2026-05-21 12:50:00+00', 47, 'Fibrilación auricular controlada. Sin eventos.', 'paid', 10500, 'Cardiología', 'Medifé', NOW(), NOW()),
    (p6,  v_pro, 'completed', 'presencial', '2026-05-21 12:45:00+00', '2026-05-21 12:47:00+00', '2026-05-21 13:37:00+00', 50, 'Seguimiento post ablación. Evolución excelente.', 'paid', 10500, 'Cardiología', 'OSDE', NOW(), NOW()),
    (p7,  v_pro, 'completed', 'video',      '2026-05-22 15:30:00+00', '2026-05-22 15:31:00+00', '2026-05-22 16:12:00+00', 41, 'Presión bien controlada. Continúa tratamiento actual.', 'paid', 9000, 'Cardiología', 'Swiss Medical', NOW(), NOW()),
    (p8,  v_pro, 'completed', 'presencial', '2026-05-23 12:00:00+00', '2026-05-23 12:02:00+00', '2026-05-23 12:48:00+00', 46, 'Revisión de resultados: ecocardiograma normal.', 'paid', 10500, 'Cardiología', 'Galeno', NOW(), NOW())
  ON CONFLICT DO NOTHING;

  -- ── Week of May 12 ──
  INSERT INTO public.consultations (patient_id, professional_id, status, modality, scheduled_at, started_at, completed_at, duration_minutes, closing_notes, payment_status, price_at_booking, vertical, obra_social_name, created_at, updated_at) VALUES
    (p9,  v_pro, 'completed', 'presencial', '2026-05-12 12:00:00+00', '2026-05-12 12:01:00+00', '2026-05-12 12:46:00+00', 45, 'Control mensual. Buen ritmo cardíaco.', 'paid', 10500, 'Cardiología', 'OSDE', NOW(), NOW()),
    (p10, v_pro, 'completed', 'video',      '2026-05-13 15:00:00+00', '2026-05-13 15:02:00+00', '2026-05-13 15:43:00+00', 41, 'Consulta de urgencia. Palpitaciones. Derivado a guardia.', 'paid', 9000, 'Cardiología', NULL, NOW(), NOW()),
    (p1,  v_pro, 'completed', 'presencial', '2026-05-14 12:00:00+00', '2026-05-14 12:03:00+00', '2026-05-14 12:51:00+00', 48, 'Alta definitiva de control. Paciente estabilizada.', 'paid', 10500, 'Cardiología', 'OSDE', NOW(), NOW()),
    (p2,  v_pro, 'completed', 'presencial', '2026-05-14 12:45:00+00', '2026-05-14 12:46:00+00', '2026-05-14 13:35:00+00', 49, 'Inicio de tratamiento con estatinas.', 'paid', 10500, 'Cardiología', 'Swiss Medical', NOW(), NOW()),
    (p3,  v_pro, 'completed', 'video',      '2026-05-15 15:30:00+00', '2026-05-15 15:32:00+00', '2026-05-15 16:10:00+00', 38, 'Segunda consulta. Tolerando bien la medicación.', 'paid', 9000, 'Cardiología', 'Galeno', NOW(), NOW()),
    (p4,  v_pro, 'completed', 'presencial', '2026-05-16 12:00:00+00', '2026-05-16 12:01:00+00', '2026-05-16 12:50:00+00', 49, 'Control bimestral PAMI. Sin novedades.', 'paid', 10500, 'Cardiología', 'PAMI', NOW(), NOW())
  ON CONFLICT DO NOTHING;

  -- ────────────────────────────────────────────────────────────
  -- 5. Update Valentina's professional_profile — ensure she looks
  --    active and properly configured
  -- ────────────────────────────────────────────────────────────
  UPDATE public.professional_profiles
  SET
    specialty        = COALESCE(NULLIF(specialty, ''), 'Cardiología'),
    sub_specialty    = COALESCE(NULLIF(sub_specialty, ''), 'Cardiología clínica y preventiva'),
    bio              = COALESCE(NULLIF(bio, ''), 'Cardióloga clínica con 11 años de experiencia en el seguimiento de enfermedades cardiovasculares, hipertensión arterial y arritmias. Egresada del Hospital Italiano de Buenos Aires.'),
    session_price    = COALESCE(session_price, 10500),
    price_presencial = COALESCE(price_presencial, 10500),
    price_video      = COALESCE(price_video, 9000),
    is_on_demand     = true,
    is_verified      = true,
    is_active        = true,
    average_rating   = 4.8,
    total_reviews    = 47,
    address          = COALESCE(address, 'Av. del Libertador 3280, Palermo, Buenos Aires'),
    latitude         = COALESCE(latitude, -34.5765),
    longitude        = COALESCE(longitude, -58.4124)
  WHERE user_id = v_pro;

END $$;
