-- Seed Dr. Ignacio Arteaga (ID 00000010) as a verified professional
-- Referenced by the mobile map mock data in nearbyProfessionals.ts

INSERT INTO auth.users (
  instance_id, id, aud, role, email,
  encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  '00000010-0000-0000-0000-000000000010',
  'authenticated', 'authenticated',
  'ignacio.arteaga@healthier.app',
  extensions.crypt('DemoUser2026!', extensions.gen_salt('bf')),
  NOW(),
  '{"provider":"email","providers":["email"]}', '{}',
  NOW(), NOW()
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, email, full_name, avatar_url, role) VALUES (
  '00000010-0000-0000-0000-000000000010',
  'ignacio.arteaga@healthier.app',
  'Dr. Ignacio Arteaga',
  'https://images.unsplash.com/photo-1622253692010-333f2da6031d?auto=format&fit=crop&w=200&q=80',
  'professional'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.professional_profiles (
  user_id, specialty, sub_specialty, bio,
  session_price, is_on_demand, is_verified, is_active,
  average_rating, total_reviews, submitted_at
) VALUES (
  '00000010-0000-0000-0000-000000000010',
  'Clínica médica',
  'Medicina interna',
  'Médico clínico con 12 años de experiencia. Especialista en diagnóstico y seguimiento de enfermedades crónicas.',
  8500,
  true,
  true,
  true,
  4.9,
  38,
  NOW()
) ON CONFLICT (user_id) DO NOTHING;
