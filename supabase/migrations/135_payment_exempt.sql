-- ============================================================
-- Migration 135 — Payment exemption per patient
-- ============================================================
-- Mateo, 2026-09-01: necesita probar el circuito de videollamada con su
-- propia cuenta sin pasar por el paygate de Mercado Pago. Primera pieza de
-- lo que a futuro va a ser un sistema de códigos de descuento — hoy es sólo
-- un flag por perfil que se setea a mano desde la base.
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS payment_exempt boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.payment_exempt IS
  'El paciente no pasa por el paygate de MP: la reserva/videollamada se marca payment_status=exempt sin cobrar. Se setea a mano por ahora — base para un futuro sistema de códigos de descuento.';

ALTER TABLE public.consultations
  DROP CONSTRAINT IF EXISTS consultations_payment_status_check;

ALTER TABLE public.consultations
  ADD CONSTRAINT consultations_payment_status_check
  CHECK (payment_status IN ('pending_payment', 'in_process', 'paid', 'rejected', 'refunded', 'exempt'));
