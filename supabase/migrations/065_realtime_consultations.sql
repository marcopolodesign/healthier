-- ============================================================
-- Migration 065 — publicar `consultations` a Realtime
-- ============================================================
-- Hallazgo del 2026-07-27, verificando el reorden del flujo on-demand: el
-- paciente se quedaba en la sala de espera con el botón "Entrar a la consulta"
-- deshabilitado PARA SIEMPRE aunque el profesional ya hubiera entrado. Solo se
-- desbloqueaba recargando la página.
--
-- Causa: la única tabla en la publicación `supabase_realtime` era
-- `walk_in_queue`. Las cuatro suscripciones `postgres_changes` sobre
-- `consultations` que hay en el código nunca dispararon un solo evento:
--
--   src/pages/patient/WaitingRoom.jsx     — desbloquear "Entrar" al entrar el pro
--   src/hooks/useWaitingPresence.js       — badge "En sala · hace X min" del pro
--   src/pages/professional/Dashboard.jsx  — refresco de la lista de hoy
--   src/layouts/AppLayout.jsx             — avisos al profesional
--
-- Todas parecían funcionar porque el estado inicial se lee con un fetch al
-- montar; lo que no funcionaba era la actualización en vivo, que es justamente
-- lo que estas pantallas necesitan (los dos lados están mirando y esperando).
--
-- REPLICA IDENTITY FULL para que el payload traiga la fila vieja completa y no
-- solo la PK: sin eso, un filtro por columna en el cliente no puede comparar
-- contra el valor anterior. `consultations` es chica (~130 filas), así que el
-- costo de escritura extra es irrelevante.
--
-- RLS sigue mandando: Realtime evalúa las policies de `consultations` por
-- suscriptor, así que publicar la tabla no expone filas ajenas.
-- ============================================================

ALTER TABLE public.consultations REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'consultations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.consultations;
  END IF;
END $$;
