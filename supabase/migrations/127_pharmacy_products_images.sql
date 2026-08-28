-- Migration 127: Add sample product images for Farmacia professional view
-- Using simple placeholder images from a reliable CDN.
-- Recovered from production's supabase_migrations.schema_migrations on
-- 2026-08-28 — applied directly to prod, no local file existed (found by
-- scripts/check-migraciones-huerfanas.sh while pushing migration 129).

UPDATE public.pharmacy_products SET image_url = 'https://images.unsplash.com/photo-1587854692152-cbe660dbde0b?w=400&h=400&fit=crop' WHERE name = 'Ibuprofeno 600mg x 30';
UPDATE public.pharmacy_products SET image_url = 'https://images.unsplash.com/photo-1587854692152-cbe660dbde0b?w=400&h=400&fit=crop' WHERE name = 'Paracetamol 500mg x 20';
UPDATE public.pharmacy_products SET image_url = 'https://images.unsplash.com/photo-1587854692152-cbe660dbde0b?w=400&h=400&fit=crop' WHERE name = 'Amoxicilina 500mg x 21';
UPDATE public.pharmacy_products SET image_url = 'https://images.unsplash.com/photo-1587854692152-cbe660dbde0b?w=400&h=400&fit=crop' WHERE name = 'Loratadina 10mg x 10';
UPDATE public.pharmacy_products SET image_url = 'https://images.unsplash.com/photo-1587854692152-cbe660dbde0b?w=400&h=400&fit=crop' WHERE name = 'Omeprazol 20mg x 14';
UPDATE public.pharmacy_products SET image_url = 'https://images.unsplash.com/photo-1587854692152-cbe660dbde0b?w=400&h=400&fit=crop' WHERE name = 'Ibuprofeno pediátrico jarabe';
UPDATE public.pharmacy_products SET image_url = 'https://images.unsplash.com/photo-1587854692152-cbe660dbde0b?w=400&h=400&fit=crop' WHERE name = 'Paracetamol gotas infantiles';
UPDATE public.pharmacy_products SET image_url = 'https://images.unsplash.com/photo-1600788325-4e8ee8c5c5d0?w=400&h=400&fit=crop' WHERE name = 'Suero fisiológico nasal';
UPDATE public.pharmacy_products SET image_url = 'https://images.unsplash.com/photo-1576091160550-112173f7f869?w=400&h=400&fit=crop' WHERE name = 'Multivitamínico adultos x 30';
UPDATE public.pharmacy_products SET image_url = 'https://images.unsplash.com/photo-1576091160550-112173f7f869?w=400&h=400&fit=crop' WHERE name = 'Proteína en polvo 500g';
UPDATE public.pharmacy_products SET image_url = 'https://images.unsplash.com/photo-1576091160550-112173f7f869?w=400&h=400&fit=crop' WHERE name = 'Omega 3 x 60 cápsulas';
UPDATE public.pharmacy_products SET image_url = 'https://images.unsplash.com/photo-1576091160579-112173f7f877?w=400&h=400&fit=crop' WHERE name = 'Termómetro digital';
UPDATE public.pharmacy_products SET image_url = 'https://images.unsplash.com/photo-1600439773192-a2f1b5f4d6f5?w=400&h=400&fit=crop' WHERE name = 'Protector solar FPS 50+';
UPDATE public.pharmacy_products SET image_url = 'https://images.unsplash.com/photo-1587854692152-cbe660dbde0b?w=400&h=400&fit=crop' WHERE name = 'Alcohol en gel 500ml';
