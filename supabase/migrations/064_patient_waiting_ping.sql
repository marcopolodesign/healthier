-- ============================================================
-- Migration 064 — patient_waiting_ping(): presencia idempotente y auto-reparable
-- ============================================================
-- 063 dejaba la marca de llegada y el heartbeat como dos updates distintos
-- desde el cliente. Verificando en browser apareció la falla: en el montaje
-- doble de React StrictMode el orden real fue mark → clear → mark, y como los
-- tres son asíncronos el clear aterrizó último y dejó patient_waiting_since en
-- NULL con el paciente todavía sentado en la sala. El heartbeat no podía
-- recuperarlo porque solo escribía patient_last_seen_at, así que la presencia
-- quedaba apagada para siempre.
--
-- StrictMode solo lo hace evidente: cualquier remount rápido (volver atrás,
-- reconexión, doble navegación) puede cruzar un clear con un mark en curso.
--
-- La solución es que llegada y heartbeat sean la MISMA operación idempotente:
-- COALESCE preserva el instante de llegada original, y cualquier ping
-- posterior a un clear espurio vuelve a encender la presencia dentro de los
-- 30s del siguiente latido.
--
-- Devuelve true solo cuando el ping es una llegada nueva — el cliente lo usa
-- para notificar al profesional una sola vez y no en cada latido.
-- ============================================================

CREATE OR REPLACE FUNCTION public.patient_waiting_ping(p_consultation_id uuid)
RETURNS boolean
LANGUAGE plpgsql
-- SECURITY INVOKER (default): la policy consultations_access sigue mandando,
-- así que un paciente solo puede marcar presencia en su propia consulta.
SECURITY INVOKER
AS $$
DECLARE
  v_fresh boolean;
BEGIN
  UPDATE public.consultations
     SET patient_waiting_since = COALESCE(patient_waiting_since, now()),
         patient_last_seen_at  = now()
   WHERE id = p_consultation_id
  -- now() es el timestamp de la transacción: si la fila no tenía llegada,
  -- ambas columnas quedan idénticas → es una llegada nueva.
  RETURNING (patient_waiting_since = patient_last_seen_at) INTO v_fresh;

  RETURN COALESCE(v_fresh, false);
END;
$$;

COMMENT ON FUNCTION public.patient_waiting_ping(uuid) IS
  'Marca/renueva la presencia del paciente en la sala de espera. Idempotente: conserva la hora de llegada y revive la presencia si un clear la apagó por error. Devuelve true solo en la llegada nueva.';

GRANT EXECUTE ON FUNCTION public.patient_waiting_ping(uuid) TO authenticated;
