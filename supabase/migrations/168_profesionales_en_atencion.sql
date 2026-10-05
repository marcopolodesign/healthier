-- ═══════════════════════════════════════════════════════════════════════════
-- 168 · Quién está atendiendo ahora ("Buscar por nombre — disponibles ahora")
-- ═══════════════════════════════════════════════════════════════════════════
-- El diseño aprobado (2026-09-23) muestra apagado, con "Ocupado", al
-- profesional que está en una consulta. El paciente no puede averiguarlo solo:
-- la RLS de `consultations` le deja leer únicamente las suyas. Esta función
-- devuelve SÓLO los ids de los profesionales ocupados — ni paciente, ni
-- consulta, ni horario —, que es lo mínimo para pintar la chapa.
--
-- "En atención" = consulta en `in_progress` que el profesional no cerró. El
-- corte de 3 horas evita que una consulta que quedó colgada (nadie la cerró)
-- lo marque ocupado para siempre.

create or replace function public.profesionales_en_atencion()
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select distinct c.professional_id
    from public.consultations c
   where c.status = 'in_progress'
     and c.professional_ended_at is null
     and c.professional_id is not null
     and coalesce(c.started_at, c.scheduled_at, c.created_at) > now() - interval '3 hours';
$$;

revoke all on function public.profesionales_en_atencion() from public;
grant execute on function public.profesionales_en_atencion() to authenticated;
