-- ============================================================
-- Migration 072 — códigos de catálogo de Innovamed para poder emitir recetas
-- ============================================================
-- La API de RCTA rechaza texto libre donde espera un código de SU catálogo.
-- Healthier guardaba texto libre en los dos lugares que importan, así que hoy
-- no se puede emitir ninguna receta — ni de prueba ni real:
--
--   · Medicamento → `medicamentos[].regNo` debe salir de GetMedicamento.
--     Error si no: QBI105 "CODIGO INFORMADO INEXISTENTE".
--     Bloquea las 4 pruebas de certificación, incluida la particular.
--
--   · Cobertura → `paciente.cobertura.idFinanciador` debe salir de
--     GetFinanciadores. Bloquea 3 de las 4.
--
-- La regla que se desprende y conviene no olvidar: **guardar el código, mostrar
-- el nombre**. El nombre legible es un acompañante para la UI; el código es el
-- dato. Guardar solo el nombre obliga a adivinar el código después, y adivinar
-- es exactamente lo que produce QBI105.
-- ============================================================

-- ── Medicamento ─────────────────────────────────────────────────────────────
ALTER TABLE public.clinical_medications
  ADD COLUMN IF NOT EXISTS reg_no          text,
  ADD COLUMN IF NOT EXISTS presentacion    text,
  ADD COLUMN IF NOT EXISTS nombre_droga    text;

COMMENT ON COLUMN public.clinical_medications.reg_no IS
  'Código de producto del catálogo de Innovamed (GetMedicamento). Obligatorio para emitir por RCTA — sin esto la API responde QBI105. NULL = medicación cargada a mano, no emitible.';
COMMENT ON COLUMN public.clinical_medications.presentacion IS
  'Presentación exacta del catálogo ("500 mg comp.x 21"). Se guarda junto al código porque el mismo producto tiene varias.';
COMMENT ON COLUMN public.clinical_medications.nombre_droga IS
  'Monodroga según Innovamed. Se guarda para poder mostrar el genérico sin volver a consultar el catálogo.';

-- ── Cobertura ───────────────────────────────────────────────────────────────
-- `coverage_type` distingue tres estados que hoy son indistinguibles y que
-- significan cosas muy distintas al emitir:
--   NULL          → todavía no se preguntó
--   'financiador' → tiene obra social/prepaga (va `cobertura` en el payload)
--   'particular'  → explícitamente sin cobertura (se OMITE `cobertura`)
-- Confundir "no sabemos" con "es particular" haría emitir recetas particulares
-- a pacientes que sí tienen obra social.
ALTER TABLE public.consultations
  ADD COLUMN IF NOT EXISTS coverage_type   text
    CHECK (coverage_type IS NULL OR coverage_type IN ('financiador', 'particular')),
  ADD COLUMN IF NOT EXISTS financiador_id  integer;

COMMENT ON COLUMN public.consultations.coverage_type IS
  'NULL = sin preguntar · financiador = tiene cobertura · particular = explícitamente sin cobertura. Los tres estados son distintos al emitir una receta.';
COMMENT ON COLUMN public.consultations.financiador_id IS
  'idFinanciador del catálogo de Innovamed (GetFinanciadores). obra_social_name queda como nombre legible; ESTE es el dato que viaja a la API.';

-- Coherencia: si es particular no puede haber financiador ni afiliado.
ALTER TABLE public.consultations
  DROP CONSTRAINT IF EXISTS consultations_coverage_coherente;
ALTER TABLE public.consultations
  ADD CONSTRAINT consultations_coverage_coherente CHECK (
    coverage_type IS DISTINCT FROM 'particular'
    OR (financiador_id IS NULL AND affiliate_number IS NULL)
  );

-- Backfill conservador: las consultas que ya tienen una obra social escrita a
-- mano quedan como 'financiador' SIN id — que es la verdad: sabemos que tienen
-- cobertura pero no cuál en términos de Innovamed. Marcarlas como listas sería
-- mentir y romperían recién al emitir.
UPDATE public.consultations
   SET coverage_type = 'financiador'
 WHERE coverage_type IS NULL
   AND obra_social_name IS NOT NULL
   AND btrim(obra_social_name) <> '';
