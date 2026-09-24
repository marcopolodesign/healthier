-- ============================================================
-- Migration 174 — Documentos del paciente: especialidad, título y mascota
-- ============================================================
-- Comentarios de Nacho (tester, 2026-09-24), aprobados por Mateo:
--
--   1. "Análisis" (estudios por imágenes: radiografías, ecografías, fotos
--      clínicas) se carga eligiendo la especialidad a la que corresponde, y
--      el paciente le pone un nombre. El profesional los filtra por
--      especialidad. Los análisis de SANGRE siguen yendo al BioVisor
--      (`diagnostic_reports`) — esto es otra cosa.
--   2. Los estudios de cada mascota ("Amigo peludo") se guardan atados a la
--      mascota: `category = 'veterinaria'` + `pet_id`.
--
-- Mismo contrato para la web y la app: los nombres de columna y los valores
-- del check son los que ya usa la app.
--
-- RLS. Hasta ahora había UNA policy (`docs_owner`, ALL, patient_id = uid) y
-- ninguna para el profesional: un estudio cargado desde la app no lo veía
-- nadie más que el paciente. Se parte en cuatro para el dueño (el INSERT y el
-- UPDATE además exigen que la mascota, si viene, sea suya) y se agrega la de
-- lectura del profesional con consulta compartida — misma función SECURITY
-- DEFINER que `pets` (migración 172), nunca una policy que lea `profiles`.
--
-- Storage. El profesional ya podía leer `<paciente>/biovisor/*`. Se suma
-- `<paciente>/documentos/*`, que es donde suben desde ahora web y app.
-- ============================================================

ALTER TABLE public.medical_documents
  ADD COLUMN IF NOT EXISTS especialidad text NULL,
  ADD COLUMN IF NOT EXISTS titulo       text NULL,
  ADD COLUMN IF NOT EXISTS pet_id       uuid NULL REFERENCES public.pets(id) ON DELETE SET NULL;

ALTER TABLE public.medical_documents
  DROP CONSTRAINT IF EXISTS medical_documents_especialidad_check;
ALTER TABLE public.medical_documents
  ADD CONSTRAINT medical_documents_especialidad_check
  CHECK (especialidad IS NULL OR especialidad IN ('odontologia','medicina','kinesiologia','pediatria','otra'));

COMMENT ON COLUMN public.medical_documents.especialidad IS
  'A qué especialidad corresponde el estudio (odontologia|medicina|kinesiologia|pediatria|otra). NULL = cargado antes de la 174: se muestra como "Sin especialidad".';
COMMENT ON COLUMN public.medical_documents.titulo IS
  'Nombre que le pone el paciente. NULL = usar file_name.';
COMMENT ON COLUMN public.medical_documents.pet_id IS
  'Mascota a la que pertenece el estudio (category = veterinaria). NULL = es del propio paciente.';

CREATE INDEX IF NOT EXISTS medical_documents_pet_idx
  ON public.medical_documents (pet_id, created_at DESC)
  WHERE pet_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS medical_documents_patient_category_idx
  ON public.medical_documents (patient_id, category, created_at DESC);

-- ── RLS ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "docs_owner" ON public.medical_documents;
DROP POLICY IF EXISTS "docs_owner_select" ON public.medical_documents;
DROP POLICY IF EXISTS "docs_owner_insert" ON public.medical_documents;
DROP POLICY IF EXISTS "docs_owner_update" ON public.medical_documents;
DROP POLICY IF EXISTS "docs_owner_delete" ON public.medical_documents;
DROP POLICY IF EXISTS "docs_professional_select" ON public.medical_documents;

CREATE POLICY "docs_owner_select" ON public.medical_documents
  FOR SELECT USING (patient_id = auth.uid());

-- La mascota, si viene, tiene que ser del mismo paciente. La subconsulta corre
-- con el RLS de `pets`, que ya deja al dueño ver las suyas.
CREATE POLICY "docs_owner_insert" ON public.medical_documents
  FOR INSERT WITH CHECK (
    patient_id = auth.uid()
    AND (pet_id IS NULL OR EXISTS (
      SELECT 1 FROM public.pets p WHERE p.id = medical_documents.pet_id AND p.owner_id = auth.uid()
    ))
  );

CREATE POLICY "docs_owner_update" ON public.medical_documents
  FOR UPDATE USING (patient_id = auth.uid())
  WITH CHECK (
    patient_id = auth.uid()
    AND (pet_id IS NULL OR EXISTS (
      SELECT 1 FROM public.pets p WHERE p.id = medical_documents.pet_id AND p.owner_id = auth.uid()
    ))
  );

CREATE POLICY "docs_owner_delete" ON public.medical_documents
  FOR DELETE USING (patient_id = auth.uid());

-- El profesional que atiende (o atendió) al paciente ve sus documentos —
-- incluidos los de sus mascotas, porque la consulta veterinaria es con el
-- dueño. Sólo lectura.
CREATE POLICY "docs_professional_select" ON public.medical_documents
  FOR SELECT USING (public.has_shared_consultation(patient_id));

-- ── Storage ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "patient_docs_documentos_shared_professional" ON storage.objects;
CREATE POLICY "patient_docs_documentos_shared_professional" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'patient-docs'
    AND (storage.foldername(name))[2] = 'documentos'
    AND (storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    AND public.has_shared_consultation(((storage.foldername(name))[1])::uuid)
  );
