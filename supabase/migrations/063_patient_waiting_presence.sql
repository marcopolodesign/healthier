-- ============================================================
-- Migration 063 — Presencia del paciente en la sala de espera
-- ============================================================
-- Gap encontrado el 2026-07-27: el paciente entra a /paciente/sala-espera/:id
-- (desde OnDemand, WalkInQueue, HealthSnapshot y el redirect de
-- consultationsService) pero WaitingRoom.jsx no escribe absolutamente nada —
-- solo lee la consulta y espera a que el profesional pase el status a
-- 'in_progress'. Del otro lado, Agenda.jsx y Dashboard.jsx calculan el botón
-- "Entrar" únicamente con status ∈ (confirmed, in_progress, pending), así que
-- el profesional ve exactamente lo mismo haya alguien esperándolo o no.
--
-- Modelo (no Realtime Presence puro): la presencia va a la DB para que el
-- profesional que abre el panel de cero vea quién está esperando — presence
-- se pierde en un reload. El heartbeat cubre la pestaña cerrada sin salir.
--
--   patient_waiting_since  — cuándo entró a la sala (para mostrar "hace 6 min").
--                            NULL = no está esperando.
--   patient_last_seen_at   — heartbeat cada 30s mientras la sala está abierta.
--                            Se considera presente si es más reciente que 90s.
-- ============================================================

ALTER TABLE public.consultations
  ADD COLUMN IF NOT EXISTS patient_waiting_since timestamptz,
  ADD COLUMN IF NOT EXISTS patient_last_seen_at  timestamptz;

COMMENT ON COLUMN public.consultations.patient_waiting_since IS
  'Momento en que el paciente entró a la sala de espera. NULL = no está esperando. Lo escribe el cliente (web + mobile) vía consultationsService.markPatientWaiting.';

COMMENT ON COLUMN public.consultations.patient_last_seen_at IS
  'Heartbeat del paciente en la sala de espera (cada 30s). Presencia vigente si > now() - 90s; más viejo se considera abandono sin salida explícita.';

-- Lookup del profesional: "¿quién me está esperando ahora?" sobre las filas
-- que efectivamente tienen a alguien en la sala (la enorme mayoría es NULL).
CREATE INDEX IF NOT EXISTS consultations_patient_waiting_idx
  ON public.consultations (professional_id, patient_waiting_since)
  WHERE patient_waiting_since IS NOT NULL;
