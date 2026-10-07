-- ═══════════════════════════════════════════════════════════════════════════
-- 190 · Prender la consulta inmediata ES el primer latido (lo hace la base)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Por qué (2026-10-07): `licenciadacastilloayelen@gmail.com` (psicología, prod)
-- tenía `is_on_demand = true` con `on_demand_last_seen_at = NULL` desde antes
-- del 2026-09-03: "Estás disponible" en su panel e invisible para todo paciente,
-- con la vertical "mente" vacía. Ese estado lo dejaban los dos bugs que se
-- arreglaron el 3/9 en el front (el switch que escribía el flag sin el latido y
-- el panel que borraba la vigencia al montar).
--
-- Pero el front sigue escribiendo las dos mitades por separado
-- (`setOnDemand` = upsert del flag + RPC `professional_online_ping`, en la web y
-- en la app). Si la segunda falla —red, sesión vencida— la base queda igual que
-- ella. Y las versiones viejas de la app que no reciben OTA tienen el toggle
-- viejo. Arreglarlo una vez más en cada cliente es lo que ya falló tres veces.
--
-- La regla pasa a la base: cuando EL PROPIO profesional prende el switch, en la
-- misma escritura queda su primer latido (está frente a la pantalla: eso es
-- exactamente lo que dice el latido). Cuando lo apaga, la vigencia se borra.
-- Si lo prende otro (super admin), no se inventa presencia: queda sin latido,
-- que es la verdad, hasta que el profesional abra su panel.
--
-- Control: `supabase/tests/ondemand_190.sql` y `scripts/verificar-ondemand.mjs`
-- (que ya marca en rojo a quien tiene el switch prendido sin vigencia).

create or replace function public.consulta_inmediata_late_al_prender()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.is_on_demand
     and (tg_op = 'INSERT' or not coalesce(old.is_on_demand, false))
     and new.user_id = auth.uid() then
    new.on_demand_since        := coalesce(new.on_demand_since, now());
    new.on_demand_last_seen_at := now();
  elsif not coalesce(new.is_on_demand, false)
     and tg_op = 'UPDATE' and coalesce(old.is_on_demand, false) then
    new.on_demand_since        := null;
    new.on_demand_last_seen_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists professional_profiles_prender_es_latir on public.professional_profiles;
create trigger professional_profiles_prender_es_latir
  before insert or update of is_on_demand on public.professional_profiles
  for each row execute function public.consulta_inmediata_late_al_prender();

-- Los que ya quedaron en ese estado: se les APAGA el switch (no se les escribe
-- un latido falso, que podría mandarle un paciente real a alguien que no está).
-- Así su panel deja de decirles "Estás disponible" y, si lo prenden, ahora sí
-- entran al pool. En prod, al 2026-10-07, es una sola profesional.
update public.professional_profiles
   set is_on_demand = false, on_demand_since = null
 where is_on_demand and on_demand_last_seen_at is null;
