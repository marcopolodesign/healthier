-- Pharmacy section — search + featured offers + suggested products, plus the
-- RCTA prescription → stock match used by rcta-issue to notify the patient.
-- Requested by Nacho Arteaga (2026-07-08).
CREATE TABLE IF NOT EXISTS public.pharmacy_products (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  description      text,
  category         text NOT NULL CHECK (category IN ('clinica', 'pediatria', 'nutricion', 'bienestar')),
  price            numeric(10,2) NOT NULL,
  image_url        text,
  in_stock         boolean NOT NULL DEFAULT true,
  featured         boolean NOT NULL DEFAULT false,
  -- Loose match against clinical_medications.medication_name for the RCTA
  -- prescription -> stock webhook (rcta-issue). Comma-separated keywords,
  -- matched case-insensitively.
  medication_match  text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.pharmacy_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pharmacy_products_public_read" ON public.pharmacy_products
  FOR SELECT USING (true);

INSERT INTO public.pharmacy_products (name, description, category, price, medication_match, featured, image_url) VALUES
  ('Ibuprofeno 600mg x 30',        'Antiinflamatorio y analgésico',                 'clinica',   4200,  'ibuprofeno',                     true,  null),
  ('Paracetamol 500mg x 20',       'Analgésico y antifebril',                       'clinica',   2100,  'paracetamol',                    true,  null),
  ('Amoxicilina 500mg x 21',       'Antibiótico de amplio espectro',                'clinica',   6800,  'amoxicilina',                    false, null),
  ('Loratadina 10mg x 10',         'Antihistamínico, alivia alergias',              'clinica',   3100,  'loratadina',                     false, null),
  ('Omeprazol 20mg x 14',          'Protector gástrico',                            'clinica',   3900,  'omeprazol',                      false, null),
  ('Ibuprofeno pediátrico jarabe', 'Suspensión oral 100mg/5ml, sabor frutilla',     'pediatria', 3400,  'ibuprofeno,ibuprofeno pediatrico', true,  null),
  ('Paracetamol gotas infantiles', 'Analgésico y antifebril pediátrico',            'pediatria', 2800,  'paracetamol,paracetamol gotas',  true,  null),
  ('Suero fisiológico nasal',      'Limpieza nasal para bebés y niños',             'pediatria', 1900,  'suero fisiologico',              false, null),
  ('Multivitamínico adultos x 30', 'Complejo vitamínico diario',                    'nutricion', 5200,  null,                             true,  null),
  ('Proteína en polvo 500g',       'Suplemento proteico neutro',                    'nutricion', 8900,  null,                             false, null),
  ('Omega 3 x 60 cápsulas',        'Suplemento de ácidos grasos esenciales',        'nutricion', 6400,  null,                             false, null),
  ('Termómetro digital',           'Medición rápida y precisa',                     'bienestar', 4500,  null,                             true,  null),
  ('Protector solar FPS 50+',      'Amplio espectro, resistente al agua',           'bienestar', 5900,  null,                             false, null),
  ('Alcohol en gel 500ml',         'Higiene de manos',                              'bienestar', 1500,  null,                             false, null)
ON CONFLICT DO NOTHING;

COMMENT ON TABLE public.pharmacy_products IS 'MVP demo catalog for the patient Farmacia section — real stock/pricing pending a pharmacy partner integration (e.g. Walgreens).';
