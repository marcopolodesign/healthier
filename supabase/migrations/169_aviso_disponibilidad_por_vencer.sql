-- 169 — Aviso al profesional 10 minutos antes de que venza su disponibilidad on-demand.
--
-- ── Por qué ──────────────────────────────────────────────────────────────────
-- La disponibilidad on-demand vence sola una hora después del último latido
-- (`on_demand_last_seen_at`, `ON_DEMAND_PRESENCE_TTL_MS`), pero el panel del
-- profesional seguía diciendo "Estás disponible: te pueden llegar consultas
-- ahora" aunque ya hubiera vencido — le pasó a una profesional real, con el
-- switch prendido y cero pacientes pudiendo verla. El panel ya se corrigió
-- (ver el cambio de `OnDemandSwitch.jsx` en esta misma rama); esta migración
-- es el aviso preventivo, para que no llegue a vencer en primer lugar.
--
-- ── Cómo ─────────────────────────────────────────────────────────────────────
-- Un cron cada 5 minutos busca profesionales cuyo último latido cayó entre
-- 50 y 60 minutos atrás (o sea: a 10-0 minutos de vencer) y les manda un push
-- por el catálogo (`_shared/push/textos.ts`, tipo `pro-disponibilidad-por-vencer`).
-- `on_demand_aviso_at` evita mandarlo dos veces por el mismo latido: se avisa
-- sólo si está en null o quedó desactualizado (más viejo que el latido actual).

alter table public.professional_profiles
  add column if not exists on_demand_aviso_at timestamptz;

comment on column public.professional_profiles.on_demand_aviso_at is
  'Cuándo se le mandó el último aviso de "estás por dejar de estar disponible". Se compara contra on_demand_last_seen_at para no repetir el aviso por el mismo latido.';

create or replace function public.avisar_disponibilidad_por_vencer()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_fila record;
begin
  for v_fila in
    select user_id
      from public.professional_profiles
     where is_on_demand = true
       and on_demand_last_seen_at between now() - interval '60 minutes' and now() - interval '50 minutes'
       and (on_demand_aviso_at is null or on_demand_aviso_at < on_demand_last_seen_at)
  loop
    perform public.enviar_push_tipo(v_fila.user_id, 'pro-disponibilidad-por-vencer', '{}'::jsonb);

    update public.professional_profiles
       set on_demand_aviso_at = now()
     where user_id = v_fila.user_id;
  end loop;
end;
$$;

comment on function public.avisar_disponibilidad_por_vencer is
  'Cron cada 5 min: avisa al profesional on-demand cuando su latido tiene entre 50 y 60 minutos, antes de que venza el TTL de una hora.';

revoke all on function public.avisar_disponibilidad_por_vencer() from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- El job — mismo patrón que `cerrar-consultas-colgadas` (migración 089).
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('avisar-disponibilidad-por-vencer')
      where exists (select 1 from cron.job where jobname = 'avisar-disponibilidad-por-vencer');
    perform cron.schedule(
      'avisar-disponibilidad-por-vencer',
      '*/5 * * * *',
      $cron$select public.avisar_disponibilidad_por_vencer()$cron$
    );
  end if;
end;
$$;
