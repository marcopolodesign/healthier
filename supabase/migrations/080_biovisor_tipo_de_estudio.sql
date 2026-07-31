-- ─────────────────────────────────────────────────────────────────────────────
-- BioVisor: qué estudio es, y guardar el PDF que hoy se tira.
--
-- Pedido de Mateo (2026-07-31), después de la reunión con Nacho: habilitar el
-- BioVisor para subir PDFs y poder decir qué tipo de análisis es.
--
-- Dos cosas que sorprenden al mirar el código actual:
--   1. `document_url` **ya existía** desde la migración 035 y nunca se escribió.
--      El BioVisor sube el archivo, le pasa OCR con Gemini, se queda con los
--      parámetros y **tira el PDF**. O sea que el paciente no puede volver a ver
--      su propio análisis, ni el profesional contrastar lo extraído contra el
--      original — que es exactamente lo que hace falta cuando un valor no cierra.
--   2. No había forma de decir QUÉ estudio es. Dos hemogramas y una tiroidea se
--      veían igual en la lista.
--
-- `study_type` es texto libre a propósito, con `practice_code` al lado: el
-- catálogo de prácticas de Innovamed (`GET /apirecipe/GetPracticas`) cubre lo
-- frecuente, pero un paciente que sube un estudio raro no puede quedar bloqueado
-- porque no está en el catálogo. Mismo criterio que se usó al revés en recetas,
-- donde el código SÍ es obligatorio: allá la API lo rechaza sin código, acá no
-- hay ninguna API del otro lado.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.diagnostic_reports
  -- Nombre legible del estudio: "Hemograma completo", "Perfil tiroideo".
  add column if not exists study_type text,
  -- Código del catálogo de prácticas de Innovamed, cuando se eligió de la lista.
  -- NULL = lo escribió a mano, que es válido.
  add column if not exists practice_code text;

comment on column public.diagnostic_reports.study_type is
  'Qué estudio es, legible. Sale del catálogo de prácticas de Innovamed o lo escribe el paciente.';
comment on column public.diagnostic_reports.practice_code is
  'Código de la práctica en el catálogo de Innovamed. NULL cuando el tipo se escribió a mano.';
