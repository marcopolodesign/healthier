-- ============================================================
-- Seed: Dra. Valentina Ortega — 7-day forward agenda
-- 2026-06-12 (Thu) → 2026-06-18 (Wed), skipping Sunday 06-15
--
-- profesional@healthier.app → a0fb6e60-a920-4290-b9fe-d926c5d2f7c3
-- Schedule: Mon–Fri 09:00–13:00 & 15:00–19:00 | Sat 09:00–13:00
-- All times in UTC (ART = UTC-3)
-- ============================================================

DO $$
DECLARE
  v_pro uuid := 'a0fb6e60-a920-4290-b9fe-d926c5d2f7c3';

  -- Existing demo patients
  p1  uuid := '00000030-0000-0000-0000-000000000030';  -- Lucía Fernández
  p2  uuid := '00000031-0000-0000-0000-000000000031';  -- Matías Rodríguez
  p3  uuid := '00000032-0000-0000-0000-000000000032';  -- Camila Herrera
  p4  uuid := '00000033-0000-0000-0000-000000000033';  -- Diego Suárez
  p5  uuid := '00000034-0000-0000-0000-000000000034';  -- Sofía Méndez
  p6  uuid := '00000035-0000-0000-0000-000000000035';  -- Valentín Castro
  p7  uuid := '00000036-0000-0000-0000-000000000036';  -- Ana Belén Torres
  p8  uuid := '00000037-0000-0000-0000-000000000037';  -- Ramiro Acosta
  p9  uuid := '00000038-0000-0000-0000-000000000038';  -- Florencia Leal
  p10 uuid := '00000039-0000-0000-0000-000000000039';  -- Nicolás Vera

BEGIN

  -- ────────────────────────────────────────────────────────────
  -- THURSDAY 2026-06-12
  -- ────────────────────────────────────────────────────────────

  -- 09:00 ART — Ramiro Acosta — presencial
  INSERT INTO public.consultations (patient_id, professional_id, status, modality, scheduled_at, payment_status, price_at_booking, vertical, obra_social_name, affiliate_number, created_at, updated_at)
  VALUES (p8, v_pro, 'confirmed', 'presencial', '2026-06-12 12:00:00+00', 'pending_payment', 10500, 'Cardiología', 'Galeno', '9990123', NOW(), NOW())
  ON CONFLICT DO NOTHING;

  -- 09:45 ART — Florencia Leal — presencial
  INSERT INTO public.consultations (patient_id, professional_id, status, modality, scheduled_at, payment_status, price_at_booking, vertical, obra_social_name, affiliate_number, created_at, updated_at)
  VALUES (p9, v_pro, 'confirmed', 'presencial', '2026-06-12 12:45:00+00', 'pending_payment', 10500, 'Cardiología', 'OSDE', '8880123', NOW(), NOW())
  ON CONFLICT DO NOTHING;

  -- 10:30 ART — Lucía Fernández — presencial
  INSERT INTO public.consultations (patient_id, professional_id, status, modality, scheduled_at, payment_status, price_at_booking, vertical, obra_social_name, affiliate_number, created_at, updated_at)
  VALUES (p1, v_pro, 'confirmed', 'presencial', '2026-06-12 13:30:00+00', 'pending_payment', 10500, 'Cardiología', 'OSDE', '1234567', NOW(), NOW())
  ON CONFLICT DO NOTHING;

  -- 11:15 ART — Nicolás Vera — presencial
  INSERT INTO public.consultations (patient_id, professional_id, status, modality, scheduled_at, payment_status, price_at_booking, vertical, obra_social_name, affiliate_number, created_at, updated_at)
  VALUES (p10, v_pro, 'confirmed', 'presencial', '2026-06-12 14:15:00+00', 'pending_payment', 10500, 'Cardiología', 'Medifé', '7770123', NOW(), NOW())
  ON CONFLICT DO NOTHING;

  -- 12:00 ART — Matías Rodríguez — presencial
  INSERT INTO public.consultations (patient_id, professional_id, status, modality, scheduled_at, payment_status, price_at_booking, vertical, obra_social_name, affiliate_number, created_at, updated_at)
  VALUES (p2, v_pro, 'confirmed', 'presencial', '2026-06-12 15:00:00+00', 'pending_payment', 10500, 'Cardiología', 'Swiss Medical', '9876543', NOW(), NOW())
  ON CONFLICT DO NOTHING;

  -- 15:30 ART — Camila Herrera — video
  INSERT INTO public.consultations (patient_id, professional_id, status, modality, scheduled_at, payment_status, price_at_booking, vertical, obra_social_name, affiliate_number, created_at, updated_at)
  VALUES (p3, v_pro, 'confirmed', 'video', '2026-06-12 18:30:00+00', 'paid', 9000, 'Cardiología', 'Galeno', '5551234', NOW(), NOW())
  ON CONFLICT DO NOTHING;

  -- 16:15 ART — Diego Suárez — video
  INSERT INTO public.consultations (patient_id, professional_id, status, modality, scheduled_at, payment_status, price_at_booking, vertical, obra_social_name, affiliate_number, created_at, updated_at)
  VALUES (p4, v_pro, 'confirmed', 'video', '2026-06-12 19:15:00+00', 'paid', 9000, 'Cardiología', 'PAMI', '4445678', NOW(), NOW())
  ON CONFLICT DO NOTHING;

  -- ────────────────────────────────────────────────────────────
  -- FRIDAY 2026-06-13
  -- ────────────────────────────────────────────────────────────

  -- 09:00 ART — Sofía Méndez — presencial
  INSERT INTO public.consultations (patient_id, professional_id, status, modality, scheduled_at, payment_status, price_at_booking, vertical, obra_social_name, created_at, updated_at)
  VALUES (p5, v_pro, 'confirmed', 'presencial', '2026-06-13 12:00:00+00', 'pending_payment', 10500, 'Cardiología', 'Medifé', NOW(), NOW())
  ON CONFLICT DO NOTHING;

  -- 09:45 ART — Valentín Castro — presencial
  INSERT INTO public.consultations (patient_id, professional_id, status, modality, scheduled_at, payment_status, price_at_booking, vertical, obra_social_name, affiliate_number, created_at, updated_at)
  VALUES (p6, v_pro, 'confirmed', 'presencial', '2026-06-13 12:45:00+00', 'pending_payment', 10500, 'Cardiología', 'OSDE', '2221234', NOW(), NOW())
  ON CONFLICT DO NOTHING;

  -- 10:30 ART — Ana Belén Torres — presencial
  INSERT INTO public.consultations (patient_id, professional_id, status, modality, scheduled_at, payment_status, price_at_booking, vertical, obra_social_name, affiliate_number, created_at, updated_at)
  VALUES (p7, v_pro, 'confirmed', 'presencial', '2026-06-13 13:30:00+00', 'pending_payment', 10500, 'Cardiología', 'Swiss Medical', '1115678', NOW(), NOW())
  ON CONFLICT DO NOTHING;

  -- 11:15 ART — Ramiro Acosta — presencial
  INSERT INTO public.consultations (patient_id, professional_id, status, modality, scheduled_at, payment_status, price_at_booking, vertical, obra_social_name, affiliate_number, created_at, updated_at)
  VALUES (p8, v_pro, 'confirmed', 'presencial', '2026-06-13 14:15:00+00', 'pending_payment', 10500, 'Cardiología', 'Galeno', '9990123', NOW(), NOW())
  ON CONFLICT DO NOTHING;

  -- 15:00 ART — Florencia Leal — video
  INSERT INTO public.consultations (patient_id, professional_id, status, modality, scheduled_at, payment_status, price_at_booking, vertical, obra_social_name, affiliate_number, created_at, updated_at)
  VALUES (p9, v_pro, 'confirmed', 'video', '2026-06-13 18:00:00+00', 'paid', 9000, 'Cardiología', 'OSDE', '8880123', NOW(), NOW())
  ON CONFLICT DO NOTHING;

  -- 16:00 ART — Nicolás Vera — video
  INSERT INTO public.consultations (patient_id, professional_id, status, modality, scheduled_at, payment_status, price_at_booking, vertical, obra_social_name, affiliate_number, created_at, updated_at)
  VALUES (p10, v_pro, 'confirmed', 'video', '2026-06-13 19:00:00+00', 'paid', 9000, 'Cardiología', 'Medifé', '7770123', NOW(), NOW())
  ON CONFLICT DO NOTHING;

  -- ────────────────────────────────────────────────────────────
  -- SATURDAY 2026-06-14 (morning only — 09:00–13:00)
  -- ────────────────────────────────────────────────────────────

  -- 09:00 ART — Lucía Fernández — presencial
  INSERT INTO public.consultations (patient_id, professional_id, status, modality, scheduled_at, payment_status, price_at_booking, vertical, obra_social_name, affiliate_number, created_at, updated_at)
  VALUES (p1, v_pro, 'confirmed', 'presencial', '2026-06-14 12:00:00+00', 'pending_payment', 10500, 'Cardiología', 'OSDE', '1234567', NOW(), NOW())
  ON CONFLICT DO NOTHING;

  -- 09:45 ART — Matías Rodríguez — presencial
  INSERT INTO public.consultations (patient_id, professional_id, status, modality, scheduled_at, payment_status, price_at_booking, vertical, obra_social_name, affiliate_number, created_at, updated_at)
  VALUES (p2, v_pro, 'confirmed', 'presencial', '2026-06-14 12:45:00+00', 'pending_payment', 10500, 'Cardiología', 'Swiss Medical', '9876543', NOW(), NOW())
  ON CONFLICT DO NOTHING;

  -- 10:30 ART — Camila Herrera — presencial
  INSERT INTO public.consultations (patient_id, professional_id, status, modality, scheduled_at, payment_status, price_at_booking, vertical, obra_social_name, affiliate_number, created_at, updated_at)
  VALUES (p3, v_pro, 'confirmed', 'presencial', '2026-06-14 13:30:00+00', 'pending_payment', 10500, 'Cardiología', 'Galeno', '5551234', NOW(), NOW())
  ON CONFLICT DO NOTHING;

  -- ────────────────────────────────────────────────────────────
  -- SUNDAY 2026-06-15 — no work
  -- ────────────────────────────────────────────────────────────

  -- ────────────────────────────────────────────────────────────
  -- MONDAY 2026-06-16
  -- ────────────────────────────────────────────────────────────

  -- 09:00 ART — Diego Suárez — presencial
  INSERT INTO public.consultations (patient_id, professional_id, status, modality, scheduled_at, payment_status, price_at_booking, vertical, obra_social_name, affiliate_number, created_at, updated_at)
  VALUES (p4, v_pro, 'confirmed', 'presencial', '2026-06-16 12:00:00+00', 'pending_payment', 10500, 'Cardiología', 'PAMI', '4445678', NOW(), NOW())
  ON CONFLICT DO NOTHING;

  -- 09:45 ART — Sofía Méndez — presencial
  INSERT INTO public.consultations (patient_id, professional_id, status, modality, scheduled_at, payment_status, price_at_booking, vertical, obra_social_name, created_at, updated_at)
  VALUES (p5, v_pro, 'confirmed', 'presencial', '2026-06-16 12:45:00+00', 'pending_payment', 10500, 'Cardiología', 'Medifé', NOW(), NOW())
  ON CONFLICT DO NOTHING;

  -- 10:30 ART — Valentín Castro — presencial
  INSERT INTO public.consultations (patient_id, professional_id, status, modality, scheduled_at, payment_status, price_at_booking, vertical, obra_social_name, affiliate_number, created_at, updated_at)
  VALUES (p6, v_pro, 'confirmed', 'presencial', '2026-06-16 13:30:00+00', 'pending_payment', 10500, 'Cardiología', 'OSDE', '2221234', NOW(), NOW())
  ON CONFLICT DO NOTHING;

  -- 11:15 ART — Ana Belén Torres — presencial
  INSERT INTO public.consultations (patient_id, professional_id, status, modality, scheduled_at, payment_status, price_at_booking, vertical, obra_social_name, affiliate_number, created_at, updated_at)
  VALUES (p7, v_pro, 'confirmed', 'presencial', '2026-06-16 14:15:00+00', 'pending_payment', 10500, 'Cardiología', 'Swiss Medical', '1115678', NOW(), NOW())
  ON CONFLICT DO NOTHING;

  -- 12:00 ART — Ramiro Acosta — presencial
  INSERT INTO public.consultations (patient_id, professional_id, status, modality, scheduled_at, payment_status, price_at_booking, vertical, obra_social_name, affiliate_number, created_at, updated_at)
  VALUES (p8, v_pro, 'confirmed', 'presencial', '2026-06-16 15:00:00+00', 'pending_payment', 10500, 'Cardiología', 'Galeno', '9990123', NOW(), NOW())
  ON CONFLICT DO NOTHING;

  -- 15:30 ART — Florencia Leal — video
  INSERT INTO public.consultations (patient_id, professional_id, status, modality, scheduled_at, payment_status, price_at_booking, vertical, obra_social_name, affiliate_number, created_at, updated_at)
  VALUES (p9, v_pro, 'confirmed', 'video', '2026-06-16 18:30:00+00', 'paid', 9000, 'Cardiología', 'OSDE', '8880123', NOW(), NOW())
  ON CONFLICT DO NOTHING;

  -- 16:15 ART — Nicolás Vera — video
  INSERT INTO public.consultations (patient_id, professional_id, status, modality, scheduled_at, payment_status, price_at_booking, vertical, obra_social_name, affiliate_number, created_at, updated_at)
  VALUES (p10, v_pro, 'confirmed', 'video', '2026-06-16 19:15:00+00', 'paid', 9000, 'Cardiología', 'Medifé', '7770123', NOW(), NOW())
  ON CONFLICT DO NOTHING;

  -- ────────────────────────────────────────────────────────────
  -- TUESDAY 2026-06-17
  -- ────────────────────────────────────────────────────────────

  -- 09:00 ART — Lucía Fernández — presencial
  INSERT INTO public.consultations (patient_id, professional_id, status, modality, scheduled_at, payment_status, price_at_booking, vertical, obra_social_name, affiliate_number, created_at, updated_at)
  VALUES (p1, v_pro, 'confirmed', 'presencial', '2026-06-17 12:00:00+00', 'pending_payment', 10500, 'Cardiología', 'OSDE', '1234567', NOW(), NOW())
  ON CONFLICT DO NOTHING;

  -- 09:45 ART — Matías Rodríguez — presencial
  INSERT INTO public.consultations (patient_id, professional_id, status, modality, scheduled_at, payment_status, price_at_booking, vertical, obra_social_name, affiliate_number, created_at, updated_at)
  VALUES (p2, v_pro, 'confirmed', 'presencial', '2026-06-17 12:45:00+00', 'pending_payment', 10500, 'Cardiología', 'Swiss Medical', '9876543', NOW(), NOW())
  ON CONFLICT DO NOTHING;

  -- 10:30 ART — Diego Suárez — presencial
  INSERT INTO public.consultations (patient_id, professional_id, status, modality, scheduled_at, payment_status, price_at_booking, vertical, obra_social_name, affiliate_number, created_at, updated_at)
  VALUES (p4, v_pro, 'confirmed', 'presencial', '2026-06-17 13:30:00+00', 'pending_payment', 10500, 'Cardiología', 'PAMI', '4445678', NOW(), NOW())
  ON CONFLICT DO NOTHING;

  -- 11:15 ART — Camila Herrera — presencial
  INSERT INTO public.consultations (patient_id, professional_id, status, modality, scheduled_at, payment_status, price_at_booking, vertical, obra_social_name, affiliate_number, created_at, updated_at)
  VALUES (p3, v_pro, 'confirmed', 'presencial', '2026-06-17 14:15:00+00', 'pending_payment', 10500, 'Cardiología', 'Galeno', '5551234', NOW(), NOW())
  ON CONFLICT DO NOTHING;

  -- 15:30 ART — Sofía Méndez — video
  INSERT INTO public.consultations (patient_id, professional_id, status, modality, scheduled_at, payment_status, price_at_booking, vertical, obra_social_name, created_at, updated_at)
  VALUES (p5, v_pro, 'confirmed', 'video', '2026-06-17 18:30:00+00', 'paid', 9000, 'Cardiología', 'Medifé', NOW(), NOW())
  ON CONFLICT DO NOTHING;

  -- 16:15 ART — Valentín Castro — video
  INSERT INTO public.consultations (patient_id, professional_id, status, modality, scheduled_at, payment_status, price_at_booking, vertical, obra_social_name, affiliate_number, created_at, updated_at)
  VALUES (p6, v_pro, 'confirmed', 'video', '2026-06-17 19:15:00+00', 'paid', 9000, 'Cardiología', 'OSDE', '2221234', NOW(), NOW())
  ON CONFLICT DO NOTHING;

  -- ────────────────────────────────────────────────────────────
  -- WEDNESDAY 2026-06-18
  -- ────────────────────────────────────────────────────────────

  -- 09:00 ART — Ana Belén Torres — presencial
  INSERT INTO public.consultations (patient_id, professional_id, status, modality, scheduled_at, payment_status, price_at_booking, vertical, obra_social_name, affiliate_number, created_at, updated_at)
  VALUES (p7, v_pro, 'confirmed', 'presencial', '2026-06-18 12:00:00+00', 'pending_payment', 10500, 'Cardiología', 'Swiss Medical', '1115678', NOW(), NOW())
  ON CONFLICT DO NOTHING;

  -- 09:45 ART — Ramiro Acosta — presencial
  INSERT INTO public.consultations (patient_id, professional_id, status, modality, scheduled_at, payment_status, price_at_booking, vertical, obra_social_name, affiliate_number, created_at, updated_at)
  VALUES (p8, v_pro, 'confirmed', 'presencial', '2026-06-18 12:45:00+00', 'pending_payment', 10500, 'Cardiología', 'Galeno', '9990123', NOW(), NOW())
  ON CONFLICT DO NOTHING;

  -- 10:30 ART — Florencia Leal — presencial
  INSERT INTO public.consultations (patient_id, professional_id, status, modality, scheduled_at, payment_status, price_at_booking, vertical, obra_social_name, affiliate_number, created_at, updated_at)
  VALUES (p9, v_pro, 'confirmed', 'presencial', '2026-06-18 13:30:00+00', 'pending_payment', 10500, 'Cardiología', 'OSDE', '8880123', NOW(), NOW())
  ON CONFLICT DO NOTHING;

  -- 11:15 ART — Nicolás Vera — presencial
  INSERT INTO public.consultations (patient_id, professional_id, status, modality, scheduled_at, payment_status, price_at_booking, vertical, obra_social_name, affiliate_number, created_at, updated_at)
  VALUES (p10, v_pro, 'confirmed', 'presencial', '2026-06-18 14:15:00+00', 'pending_payment', 10500, 'Cardiología', 'Medifé', '7770123', NOW(), NOW())
  ON CONFLICT DO NOTHING;

  -- 15:30 ART — Lucía Fernández — video
  INSERT INTO public.consultations (patient_id, professional_id, status, modality, scheduled_at, payment_status, price_at_booking, vertical, obra_social_name, affiliate_number, created_at, updated_at)
  VALUES (p1, v_pro, 'confirmed', 'video', '2026-06-18 18:30:00+00', 'paid', 9000, 'Cardiología', 'OSDE', '1234567', NOW(), NOW())
  ON CONFLICT DO NOTHING;

  -- 16:15 ART — Matías Rodríguez — video
  INSERT INTO public.consultations (patient_id, professional_id, status, modality, scheduled_at, payment_status, price_at_booking, vertical, obra_social_name, affiliate_number, created_at, updated_at)
  VALUES (p2, v_pro, 'confirmed', 'video', '2026-06-18 19:15:00+00', 'paid', 9000, 'Cardiología', 'Swiss Medical', '9876543', NOW(), NOW())
  ON CONFLICT DO NOTHING;

END $$;
