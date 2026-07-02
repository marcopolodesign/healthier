-- SISA (Sistema Integrado de Información Sanitaria Argentina) verification fields
-- Adds DNI to profiles (needed for SISA lookup) and verification tracking to professional_profiles

-- DNI on profiles — used by SISA API lookup (nrodoc param)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS dni text;

-- SISA verification tracking on professional_profiles
ALTER TABLE public.professional_profiles
  ADD COLUMN IF NOT EXISTS sisa_status        text CHECK (sisa_status IN ('habilitada', 'suspendida', 'not_found', 'error')),
  ADD COLUMN IF NOT EXISTS sisa_matricula     text,           -- matrícula devuelta por SISA (MN/MP + número)
  ADD COLUMN IF NOT EXISTS sisa_raw           jsonb,          -- respuesta completa de SISA para auditoría
  ADD COLUMN IF NOT EXISTS sisa_verified_at   timestamptz,    -- timestamp de última consulta SISA exitosa
  ADD COLUMN IF NOT EXISTS verification_source text CHECK (verification_source IN ('sisa', 'manual')),
  ADD COLUMN IF NOT EXISTS verified_at        timestamptz,    -- timestamp en que is_verified pasó a true
  ADD COLUMN IF NOT EXISTS verified_by        uuid REFERENCES public.profiles(id);  -- admin que verificó (manual)
