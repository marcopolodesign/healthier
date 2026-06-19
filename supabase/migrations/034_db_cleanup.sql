-- Fix 1: Seed data — Dr. Martín López demo price ($15 ARS is unrealistic)
-- Columns are price_presencial and price_video (split in migration 023)
UPDATE professional_profiles
SET price_presencial = 8000,
    price_video = 8000
WHERE id = (SELECT id FROM profiles WHERE id::text LIKE '%00000001%' LIMIT 1);

-- Fix 2: Clear daily_room_url for presencial (in-person) consultations
-- A presencial consultation should never have a video room URL
UPDATE consultations
SET daily_room_url = NULL
WHERE modality = 'presencial' AND daily_room_url IS NOT NULL;
