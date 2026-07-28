-- ============================================================
-- Migration 071 — el profesional habilita explícitamente al paciente
-- ============================================================
-- Hallazgo de la prueba del 2026-07-28: el paciente entraba a la sala y quedaba
-- esperando sin saber si podía pasar; del otro lado, el profesional no tenía
-- ninguna acción que significara "ya podés entrar". La habilitación era un
-- EFECTO SECUNDARIO de que el profesional abriera la página de videollamada
-- (daily-token pone la consulta en `in_progress`), así que hasta que no lo
-- hacía no pasaba nada — y el paciente no tenía forma de enterarse.
--
-- `patient_admitted_at` hace explícito ese momento. Es un dato aparte del
-- status a propósito: `in_progress` significa "la consulta arrancó", que no es
-- lo mismo que "el profesional habilitó al paciente a entrar", y mezclarlos es
-- lo que hacía que el orden de llegada importara.
--
-- La sala del paciente lo lee por Realtime (migración 065) y cambia el CTA sola,
-- sin refresh — que fue justamente lo que hubo que hacer a mano en la prueba.
-- ============================================================

ALTER TABLE public.consultations
  ADD COLUMN IF NOT EXISTS patient_admitted_at timestamptz;

COMMENT ON COLUMN public.consultations.patient_admitted_at IS
  'Momento en que el profesional habilitó al paciente a entrar a la videollamada. NULL = todavía esperando en la sala. Distinto de status=in_progress, que significa que la consulta arrancó.';

-- "¿A quién habilité y todavía no entró?" sobre las pocas filas que aplican.
CREATE INDEX IF NOT EXISTS consultations_admitted_idx
  ON public.consultations (professional_id, patient_admitted_at)
  WHERE patient_admitted_at IS NOT NULL;
