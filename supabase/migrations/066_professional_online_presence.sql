-- ============================================================
-- Migration 066 — presencia real del profesional para on-demand
-- ============================================================
-- Hallazgo del 2026-07-27: el match de consultas on-demand filtraba por
-- `professional_profiles.is_on_demand`, que es un FLAG ESTÁTICO del perfil. Un
-- médico que lo tildó hace tres meses y está durmiendo se matcheaba igual: el
-- paciente autorizaba el pago, se le retenía la plata en la tarjeta, esperaba
-- los 10 minutos de la ventana y se caía. Todo el producto se llama "hablá con
-- un médico ahora" y no tenía forma de saber si había alguien del otro lado.
--
-- Modelo: mismo patrón que la presencia del paciente en la sala (migraciones
-- 063/064), pero al revés — acá el que late es el profesional mientras tiene su
-- panel abierto y el switch de on-demand activo.
--
--   on_demand_since        — cuándo se puso disponible. NULL = no está.
--   on_demand_last_seen_at — latido cada 30s mientras el panel está abierto.
--                            Se considera vivo si es más reciente que 90s.
--
-- `is_on_demand` NO se elimina: sigue siendo la intención declarada ("acepto
-- consultas inmediatas"). La presencia es la otra mitad — hay que tener las dos.
-- ============================================================

ALTER TABLE public.professional_profiles
  ADD COLUMN IF NOT EXISTS on_demand_since        timestamptz,
  ADD COLUMN IF NOT EXISTS on_demand_last_seen_at timestamptz;

COMMENT ON COLUMN public.professional_profiles.on_demand_since IS
  'Momento en que el profesional se puso disponible para on-demand. NULL = no está disponible. Lo escribe el cliente vía professional_online_ping.';

COMMENT ON COLUMN public.professional_profiles.on_demand_last_seen_at IS
  'Latido del profesional disponible (cada 30s). Vivo si > now() - 90s; más viejo se considera que cerró el panel o perdió conexión.';

CREATE INDEX IF NOT EXISTS professional_profiles_on_demand_live_idx
  ON public.professional_profiles (specialty, on_demand_last_seen_at)
  WHERE is_on_demand = true AND on_demand_last_seen_at IS NOT NULL;

-- ── Latido idempotente ──────────────────────────────────────────────────────
-- Misma forma que patient_waiting_ping (064): llegada y latido son la MISMA
-- operación, con COALESCE preservando el instante en que se puso disponible.
-- Esto evita el bug que apareció en la presencia del paciente, donde un clear
-- espurio cruzado con un mark dejaba la presencia apagada para siempre.
CREATE OR REPLACE FUNCTION public.professional_online_ping()
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_fresh boolean;
BEGIN
  UPDATE public.professional_profiles
     SET on_demand_since        = COALESCE(on_demand_since, now()),
         on_demand_last_seen_at = now()
   WHERE user_id = auth.uid()
  RETURNING (on_demand_since = on_demand_last_seen_at) INTO v_fresh;

  RETURN COALESCE(v_fresh, false);
END;
$$;

COMMENT ON FUNCTION public.professional_online_ping() IS
  'Marca/renueva la disponibilidad on-demand del profesional autenticado. Idempotente. Devuelve true solo cuando se acaba de poner disponible.';

CREATE OR REPLACE FUNCTION public.professional_offline()
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  UPDATE public.professional_profiles
     SET on_demand_since = NULL, on_demand_last_seen_at = NULL
   WHERE user_id = auth.uid();
END;
$$;

COMMENT ON FUNCTION public.professional_offline() IS
  'El profesional cerró el panel o apagó on-demand. Apaga la presencia explícitamente en vez de esperar a que venza el TTL.';

GRANT EXECUTE ON FUNCTION public.professional_online_ping() TO authenticated;
GRANT EXECUTE ON FUNCTION public.professional_offline()   TO authenticated;
