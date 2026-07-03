-- RCTA (Receta Electrónica) fields for clinical_medications
-- Stores structured prescription data needed for Innovamed QBI2 API integration
-- rcta_prescription_id (TEXT) already exists as placeholder from migration 033

ALTER TABLE public.clinical_medications
  ADD COLUMN IF NOT EXISTS presentation    text,          -- forma farmacéutica: comprimido, jarabe, ampolla...
  ADD COLUMN IF NOT EXISTS concentration   text,          -- ej: "500mg", "250mg/5ml"
  ADD COLUMN IF NOT EXISTS route           text,          -- vía: oral, IV, IM, tópico...
  ADD COLUMN IF NOT EXISTS frequency       text,          -- ej: "cada 8hs", "1 vez/día"
  ADD COLUMN IF NOT EXISTS duration_days   integer,       -- duración en días
  ADD COLUMN IF NOT EXISTS quantity        text,          -- ej: "30 comprimidos", "1 frasco"
  ADD COLUMN IF NOT EXISTS cie10_code      text,          -- diagnóstico CIE-10 para la receta
  ADD COLUMN IF NOT EXISTS cie10_display   text,          -- descripción del diagnóstico
  ADD COLUMN IF NOT EXISTS is_chronic      boolean not null default false,
  ADD COLUMN IF NOT EXISTS rcta_pdf_url    text,          -- URL del PDF de receta emitida
  ADD COLUMN IF NOT EXISTS rcta_status     text           -- estado de emisión RCTA
                           check (rcta_status in ('pending', 'issued', 'error')),
  ADD COLUMN IF NOT EXISTS rcta_issued_at  timestamptz;   -- timestamp de emisión exitosa
