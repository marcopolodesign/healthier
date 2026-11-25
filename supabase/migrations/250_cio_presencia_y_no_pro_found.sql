-- ═══════════════════════════════════════════════════════════════════════════
-- 250 · Presencia del profesional y "nadie tomó el pedido" como eventos de
--       Customer.io (Hyppo)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Por qué (2026-11-25, sala de Trini, OK de Mateo): Hyppo arma un tablero que
-- compara hora por hora los horarios declarados, cuándo los profesionales
-- estuvieron de verdad en línea para la consulta inmediata y cuándo hubo
-- pacientes que pidieron y no encontraron a nadie. La 237 ya registra la
-- presencia en la base, pero no llegaba como eventos al perfil del profesional,
-- ni había evento cuando el pedido del paciente se quedaba sin nadie.
--
-- Cómo llegan a Customer.io: igual que `professional_submitted` /
-- `professional_verified` — por el Data Warehouse Sync contra el esquema `cio`
-- (no hay clave de Customer.io del lado del servidor). El momento de cada
-- evento sale de la base (`occurred_at`), no de cuándo corre el sync.
--
--   1. `cio.ondemand_pro_eventos` — perfil del PROFESIONAL (person_id = su
--      profiles.id, el mismo de professional_submitted):
--        · ondemand_pro_online      se prendió, o volvió a latir con la
--                                   vigencia vencida
--        · ondemand_pro_offline     motivo: manual (lo apagó él) · timeout
--                                   (1 h sin latido; occurred_at = el último
--                                   latido, no la hora en que se detectó) ·
--                                   otro (lo apagó el sistema o un admin)
--        · ondemand_pro_busy        entró a una consulta estando en línea
--        · ondemand_pro_available   salió de la consulta y sigue en línea
--      "En consulta" es lo mismo que usa la chapa "Ocupado" (168): consulta en
--      `in_progress`. Busy/available sólo salen mientras está en línea.
--      Propiedades: vertical y especialidad (dato profesional, como los traits
--      de cioIdentifyProfessional), motivo en offline. Nada personal.
--      Sin duplicados: se emite sólo cuando el estado cambia (online ↔ offline),
--      así que un barrido repetido, o un apagado manual después de un
--      vencimiento, no generan un segundo offline.
--
--   2. `cio.ondemand_no_pro_found` — perfil del PACIENTE: pidió una consulta
--      inmediata (hay pedido en `ondemand_requests`) y nadie lo tomó. Sale
--      cuando el pedido venció (desenlace 'vencio') o cuando el paciente se fue
--      antes de que alguien aceptara (desenlace 'cancelo'). Propiedad:
--      segundos_espera. SIN vertical ni especialidad: en un evento de paciente
--      son dato de salud (la misma guarda que sanitizeEventProps en el front).
--      Diferencia con `ondemand_no_match` (evento del navegador): ese sale
--      cuando el paciente VE la pantalla de sin respuesta (cause nadie_acepto)
--      o cuando no había nadie al entrar (cause sin_profesionales, sin pedido
--      ni espera). Éste sale del servidor aunque haya cerrado la pestaña, y
--      sólo cuando hubo pedido y espera.
--
-- Cuentas de prueba: las vistas `cio` las dejan afuera (profiles.es_prueba o
-- professional_profiles.solo_pruebas). Las vistas `*_todos` de `public` tienen
-- todo, con la columna es_prueba, para probar en staging y para el super admin;
-- ni anon ni authenticated las leen.
--
-- No se toca ninguna vista cio existente ni ningún nombre de evento existente.
-- Control: `bash scripts/correr-test.sh cio_presencia_250 staging`.

-- ── 1. Motivo del apagado ────────────────────────────────────────────────────
alter table public.presencia_profesional_eventos
  add column if not exists motivo text
    check (motivo is null or motivo in ('manual', 'otro'));

comment on column public.presencia_profesional_eventos.motivo is
  'Sólo en desconecto: manual = lo apagó el propio profesional (auth.uid() = él); otro = sistema o admin. Null en las filas anteriores a la 250. Migración 250.';

create or replace function public.presencia_anotar_cambio()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.on_demand_since is null then
    -- Se apagó (switch o `professional_offline`). Sólo si antes estaba.
    if old.on_demand_since is not null then
      insert into presencia_profesional_eventos (professional_id, specialty, evento, momento, es_prueba, motivo)
      values (new.user_id, new.specialty, 'desconecto', now(), coalesce(new.solo_pruebas, false),
              case when auth.uid() = new.user_id then 'manual' else 'otro' end);
    end if;
  else
    -- Prendió por primera vez, o volvió a latir con la vigencia ya vencida.
    insert into presencia_profesional_eventos (professional_id, specialty, evento, momento, es_prueba)
    values (new.user_id, new.specialty, 'conecto', now(), coalesce(new.solo_pruebas, false));
  end if;
  return new;
end;
$$;

revoke all on function public.presencia_anotar_cambio() from public, anon, authenticated;

-- ── 2. Presencia como eventos, con todo (incluidas las cuentas de prueba) ────
create or replace view public.cio_ondemand_pro_eventos_todos with (security_invoker = false) as
with presencia as (
  select e.id, e.professional_id, e.specialty, e.evento, e.momento, e.motivo,
         (e.es_prueba or coalesce(pr.es_prueba, false)) as es_prueba,
         case when e.evento = 'conecto' then 'online' else 'offline' end as estado
    from public.presencia_profesional_eventos e
    left join public.profiles pr on pr.id = e.professional_id
),
cambios as (
  select p.*,
         lag(p.estado) over (partition by p.professional_id order by p.momento, p.id) as estado_previo
    from presencia p
),
transiciones as (
  -- Sólo cuando cambia el estado: nada de offline repetidos.
  select * from cambios where estado_previo is distinct from estado
),
consulta as (
  -- Entrar / salir de una consulta (lo mismo que la chapa "Ocupado", 168).
  select ce.id, c.professional_id, ce.created_at as momento,
         case when ce.detail ->> 'to' = 'in_progress' then 'busy' else 'available' end as tipo
    from public.consultation_events ce
    join public.consultations c on c.id = ce.consultation_id
   where ce.event = 'status_changed'
     and c.professional_id is not null
     -- Entra o sale de in_progress (exactamente uno de los dos lados).
     and (coalesce(ce.detail ->> 'to', '') = 'in_progress') <> (coalesce(ce.detail ->> 'from', '') = 'in_progress')
),
consulta_cambios as (
  -- Igual que la presencia: sólo cuando cambia (dos consultas que cierran a la
  -- vez dan un solo available, y no hay available sin un busy antes).
  select k.*,
         lag(k.tipo) over (partition by k.professional_id order by k.momento, k.id) as tipo_previo
    from consulta k
)
select 'presencia:' || t.id::text                          as ref_id,
       case when t.estado = 'online' then 'ondemand_pro_online' else 'ondemand_pro_offline' end
                                                           as event_name,
       t.professional_id                                   as person_id,
       -- Timeout: el último latido (la 237 guarda último latido + 1 h).
       case when t.evento = 'vencio' then t.momento - interval '1 hour' else t.momento end
                                                           as occurred_at,
       case when t.evento = 'vencio'     then 'timeout'
            when t.evento = 'desconecto' then coalesce(t.motivo, 'otro')
       end                                                 as motivo,
       esp.vertical_id                                     as vertical,
       t.specialty                                         as especialidad,
       t.es_prueba
  from transiciones t
  left join public.specialties esp on esp.slug = t.specialty
union all
select 'consulta:' || k.id::text,
       case when k.tipo = 'busy' then 'ondemand_pro_busy' else 'ondemand_pro_available' end,
       k.professional_id,
       k.momento,
       null,
       esp.vertical_id,
       pp.specialty,
       (coalesce(pp.solo_pruebas, false) or coalesce(pr.es_prueba, false))
  from consulta_cambios k
  -- En línea en ese momento: el último cambio de presencia antes es "online".
  join lateral (
    select t.estado from transiciones t
     where t.professional_id = k.professional_id and t.momento <= k.momento
     order by t.momento desc, t.id desc
     limit 1
  ) ahora on ahora.estado = 'online'
  left join public.professional_profiles pp on pp.user_id = k.professional_id
  left join public.profiles pr on pr.id = k.professional_id
  left join public.specialties esp on esp.slug = pp.specialty
 where k.tipo_previo is distinct from k.tipo
   and not (k.tipo = 'available' and k.tipo_previo is null);

comment on view public.cio_ondemand_pro_eventos_todos is
  'Eventos de presencia on-demand del profesional, CON cuentas de prueba (columna es_prueba). Base de cio.ondemand_pro_eventos. Migración 250.';

revoke all on public.cio_ondemand_pro_eventos_todos from public, anon, authenticated;

-- ── 3. Pedido sin nadie que lo tome, con todo ────────────────────────────────
create or replace view public.cio_ondemand_no_pro_found_todos with (security_invoker = false) as
select r.id                                                as ref_id,
       'ondemand_no_pro_found'::text                       as event_name,
       r.patient_id                                        as person_id,
       case when r.status = 'expired' then r.expires_at else r.cancelled_at end
                                                           as occurred_at,
       case when r.status = 'expired' then 'vencio' else 'cancelo' end
                                                           as desenlace,
       greatest(0, extract(epoch from
         (case when r.status = 'expired' then r.expires_at else r.cancelled_at end) - r.created_at
       ))::integer                                         as segundos_espera,
       coalesce(pr.es_prueba, false)                       as es_prueba
  from public.ondemand_requests r
  left join public.profiles pr on pr.id = r.patient_id
 where r.accepted_by is null
   and (r.status = 'expired'
        or (r.status = 'cancelled' and r.cancelled_at is not null));

comment on view public.cio_ondemand_no_pro_found_todos is
  'Pedidos de consulta inmediata que nadie tomó (venció o el paciente se fue), CON cuentas de prueba. Sin vertical ni especialidad. Base de cio.ondemand_no_pro_found. Migración 250.';

revoke all on public.cio_ondemand_no_pro_found_todos from public, anon, authenticated;

-- ── 4. Vistas para Customer.io: sin cuentas de prueba ────────────────────────
create or replace view cio.ondemand_pro_eventos with (security_invoker = false) as
select ref_id, event_name, person_id, occurred_at,
       extract(epoch from occurred_at)::bigint as occurred_timestamp,
       motivo, vertical, especialidad
  from public.cio_ondemand_pro_eventos_todos
 where not es_prueba;

comment on view cio.ondemand_pro_eventos is
  'ondemand_pro_online / _offline (motivo manual|timeout|otro) / _busy / _available en el perfil del profesional. Sin cuentas de prueba. Migración 250.';

create or replace view cio.ondemand_no_pro_found with (security_invoker = false) as
select ref_id, event_name, person_id, occurred_at,
       extract(epoch from occurred_at)::bigint as occurred_timestamp,
       desenlace, segundos_espera
  from public.cio_ondemand_no_pro_found_todos
 where not es_prueba;

comment on view cio.ondemand_no_pro_found is
  'El paciente pidió consulta inmediata y nadie la tomó (desenlace vencio|cancelo, segundos_espera). Sin vertical ni especialidad. Sin cuentas de prueba. Migración 250.';

revoke all on cio.ondemand_pro_eventos  from public, anon, authenticated;
revoke all on cio.ondemand_no_pro_found from public, anon, authenticated;
grant select on cio.ondemand_pro_eventos  to cio_reader;
grant select on cio.ondemand_no_pro_found to cio_reader;
