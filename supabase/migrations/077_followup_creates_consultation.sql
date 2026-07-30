-- ─────────────────────────────────────────────────────────────────────────────
-- El seguimiento deja de ser un papelito y agenda el turno.
--
-- `patient_followups` (migración 051) guardaba una fecha de control, una nota y
-- una recomendación… y nada más. Verificado antes de tocarlo:
--   • no creaba ninguna consulta,
--   • el paciente NO podía ni leerlo (la policy es `professional_id = auth.uid()`
--     para todas las operaciones),
--   • ningún cron ni Edge Function lo mira,
--   • sólo se renderizaba en la pantalla donde se escribió.
-- O sea: 0 filas en producción, y con razón.
--
-- Decisión de Mateo (2026-07-30): que siga el mismo mecanismo que "Agendar
-- próxima consulta" — que cree la consulta de verdad.
--
-- Esta columna guarda cuál fue el turno que salió de ese seguimiento. La nota y
-- la recomendación siguen viviendo en la fila; lo que se agrega es el vínculo,
-- para poder abrir el turno desde el seguimiento y no tener dos registros
-- paralelos que nadie sabe si hablan de lo mismo.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.patient_followups
  ADD COLUMN IF NOT EXISTS consultation_id uuid
    REFERENCES public.consultations(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.patient_followups.consultation_id IS
  'El turno que se agendó a partir de este seguimiento. NULL cuando el seguimiento es sólo una recomendación de otro profesional, sin fecha.';

CREATE INDEX IF NOT EXISTS patient_followups_consultation_idx
  ON public.patient_followups (consultation_id)
  WHERE consultation_id IS NOT NULL;
