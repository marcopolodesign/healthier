-- Seed 5 demo professionals (one per patient vertical) so the patient prototype
-- always shows real data. These rows are idempotent — safe to re-run.

-- ── auth.users ────────────────────────────────────────────────────────────────
-- Demo accounts: patients cannot log in as these; they exist only to satisfy
-- the profiles.id → auth.users(id) FK.

INSERT INTO auth.users (
  instance_id, id, aud, role, email,
  encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) VALUES
  (
    '00000000-0000-0000-0000-000000000000',
    '00000001-0000-0000-0000-000000000001',
    'authenticated', 'authenticated',
    'demo.martin@healthier.app',
    crypt('DemoUser2026!', gen_salt('bf', 10)),
    NOW(),
    '{"provider":"email","providers":["email"]}', '{}',
    NOW(), NOW()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000002-0000-0000-0000-000000000002',
    'authenticated', 'authenticated',
    'demo.ana@healthier.app',
    crypt('DemoUser2026!', gen_salt('bf', 10)),
    NOW(),
    '{"provider":"email","providers":["email"]}', '{}',
    NOW(), NOW()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000003-0000-0000-0000-000000000003',
    'authenticated', 'authenticated',
    'demo.sofia@healthier.app',
    crypt('DemoUser2026!', gen_salt('bf', 10)),
    NOW(),
    '{"provider":"email","providers":["email"]}', '{}',
    NOW(), NOW()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000004-0000-0000-0000-000000000004',
    'authenticated', 'authenticated',
    'demo.matias@healthier.app',
    crypt('DemoUser2026!', gen_salt('bf', 10)),
    NOW(),
    '{"provider":"email","providers":["email"]}', '{}',
    NOW(), NOW()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000005-0000-0000-0000-000000000005',
    'authenticated', 'authenticated',
    'demo.pablo@healthier.app',
    crypt('DemoUser2026!', gen_salt('bf', 10)),
    NOW(),
    '{"provider":"email","providers":["email"]}', '{}',
    NOW(), NOW()
  )
ON CONFLICT (id) DO NOTHING;

-- ── profiles ──────────────────────────────────────────────────────────────────

INSERT INTO public.profiles (id, email, full_name, avatar_url, role) VALUES
  (
    '00000001-0000-0000-0000-000000000001',
    'demo.martin@healthier.app',
    'Dr. Martín López',
    'https://images.unsplash.com/photo-1612349317150-e413f6a5b16d?auto=format&fit=crop&w=200&q=80',
    'professional'
  ),
  (
    '00000002-0000-0000-0000-000000000002',
    'demo.ana@healthier.app',
    'Lic. Ana Gómez',
    'https://images.unsplash.com/photo-1594824432258-f6a26563b7e7?auto=format&fit=crop&w=200&q=80',
    'professional'
  ),
  (
    '00000003-0000-0000-0000-000000000003',
    'demo.sofia@healthier.app',
    'Lic. Sofía Ruiz',
    'https://images.unsplash.com/photo-1559839734-2b71ea197ec2?auto=format&fit=crop&w=200&q=80',
    'professional'
  ),
  (
    '00000004-0000-0000-0000-000000000004',
    'demo.matias@healthier.app',
    'Lic. Matías Fernández',
    'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=200&q=80',
    'professional'
  ),
  (
    '00000005-0000-0000-0000-000000000005',
    'demo.pablo@healthier.app',
    'Dr. Pablo Romero',
    'https://images.unsplash.com/photo-1537368910025-700350fe46c7?auto=format&fit=crop&w=200&q=80',
    'professional'
  )
ON CONFLICT (id) DO NOTHING;

-- ── professional_profiles ─────────────────────────────────────────────────────

INSERT INTO public.professional_profiles (
  user_id, specialty, sub_specialty, bio,
  session_price, is_on_demand, is_verified, is_active,
  average_rating, total_reviews, submitted_at
) VALUES
  (
    '00000001-0000-0000-0000-000000000001',
    'medicina_general',
    'Clínica médica',
    'Médico clínico con más de 10 años de experiencia en atención primaria. Especializado en diagnóstico integral y seguimiento de enfermedades crónicas. Atención personalizada y empática.',
    15.00, true, true, true, 4.9, 256, NOW()
  ),
  (
    '00000002-0000-0000-0000-000000000002',
    'nutricion',
    'Nutrición clínica',
    'Licenciada en Nutrición con enfoque en alimentación saludable y planes personalizados. Especialista en nutrición deportiva y pérdida de peso sostenible.',
    12.00, true, true, true, 4.8, 204, NOW()
  ),
  (
    '00000003-0000-0000-0000-000000000003',
    'psicologia',
    'Terapia cognitivo-conductual',
    'Psicóloga clínica con formación en TCC y mindfulness. Acompaño procesos de ansiedad, estrés y bienestar emocional en adultos y adolescentes.',
    18.00, true, true, true, 4.9, 178, NOW()
  ),
  (
    '00000004-0000-0000-0000-000000000004',
    'entrenamiento',
    'Kinesiología y rehabilitación',
    'Kinesiólogo deportivo con experiencia en rehabilitación post-quirúrgica y preparación física. Trabajo con deportistas amateur y de alto rendimiento.',
    14.00, true, true, true, 4.9, 312, NOW()
  ),
  (
    '00000005-0000-0000-0000-000000000005',
    'veterinaria',
    'Clínica general veterinaria',
    'Médico veterinario con 8 años de experiencia en pequeños animales. Consultas generales, vacunación y seguimiento preventivo para perros y gatos.',
    10.00, true, true, true, 4.7, 143, NOW()
  )
ON CONFLICT (user_id) DO NOTHING;
