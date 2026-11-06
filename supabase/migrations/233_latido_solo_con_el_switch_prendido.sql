-- ═══════════════════════════════════════════════════════════════════════════
-- 233 · El latido sólo se escribe si el switch está prendido
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `professional_online_ping()` escribía `on_demand_since` / `on_demand_last_seen_at`
-- aunque `is_on_demand` fuera false. Una pestaña vieja del panel (que seguía
-- latiendo después de que el profesional apagó el switch en otra) dejaba una
-- vigencia viva sobre un switch apagado: el estado inverso al de la 190, y el
-- mismo desfasaje entre "intención" y "vigencia".
--
-- Ahora el ping sólo actúa con el switch prendido. No cambia nada para el resto:
--   · prender → el trigger de la 190 escribe el primer latido en la misma escritura;
--   · panel abierto con el switch prendido → cada ping renueva (y cura un NULL);
--   · apagar → el trigger y `professional_offline` borran la vigencia.
-- El front y la app escriben el flag ANTES de latir (`setOnDemand`), así que un
-- ping que llega primero (switch optimista) simplemente no hace nada.
--
-- Control: `supabase/tests/ondemand_233.sql` y `scripts/probar-latido-front.mjs` (S3).

create or replace function public.professional_online_ping()
returns boolean
language plpgsql
security invoker
as $$
declare
  v_fresh boolean;
begin
  update public.professional_profiles
     set on_demand_since        = coalesce(on_demand_since, now()),
         on_demand_last_seen_at = now()
   where user_id = auth.uid()
     and is_on_demand
  returning (on_demand_since = on_demand_last_seen_at) into v_fresh;

  return coalesce(v_fresh, false);
end;
$$;

comment on function public.professional_online_ping() is
  'Marca/renueva la vigencia on-demand del profesional autenticado, SÓLO si tiene el switch (is_on_demand) prendido. Idempotente. Devuelve true solo cuando se acaba de poner disponible.';
