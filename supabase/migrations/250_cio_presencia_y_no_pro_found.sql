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
-- (no hay clave de Customer.io del lado del servidor). `occurred_at` es la hora
-- del hecho; `visible_desde` es desde cuándo la fila existe en la vista y es la
-- columna que tiene que usar el sync como cursor incremental (un timeout se
-- fecha en el último latido pero recién aparece cuando el barrido lo detecta,
-- más de una hora después: un cursor sobre occurred_at se lo saltearía). El
-- sync relee los últimos 10 min en cada pasada; `ref_id` deduplica.
--
--   1. `cio.ondemand_pro_eventos` — perfil del PROFESIONAL (person_id = su
--      profiles.id, el mismo de professional_submitted):
--        · ondemand_pro_online      se prendió, o volvió a latir con la
--                                   vigencia vencida
--        · ondemand_pro_offline     motivo: manual (lo apagó él) · timeout
--                                   (1 h sin latido; occurred_at = el último
--                                   latido, no la hora en que se detectó) ·
--                                   otro (lo apagó el sistema o un admin) ·
--                                   sin_dato (apagados de antes de esta
--                                   migración, cuando no se guardaba quién)
--        · ondemand_pro_busy        pasó de 0 a 1+ consultas en curso estando
--                                   en línea
--        · ondemand_pro_available   volvió a 0 consultas en curso y sigue en
--                                   línea
--      Cerrar sesión no apaga la disponibilidad (es así a propósito desde el
--      2026-07-31): quien cierra sesión sin apagar el switch termina en timeout.
--      Por eso no hay motivo 'logout'.
--      "En consulta" = consulta en `in_progress`, hasta que sale de ese estado
--      o el profesional la cierra (`professional_ended_at`), lo que pase
--      primero, con un tope de 3 h (como la chapa "Ocupado", 168). Se cuentan
--      las consultas abiertas a la vez: dos superpuestas dan un solo busy y un
--      solo available. Busy/available sólo salen mientras está en línea: cada
--      conexión arranca libre (o busy, si se conecta con una consulta ya en
--      curso) y un offline cierra cualquier busy sin mandar available aparte.
--      Propiedades: vertical y especialidad (dato profesional, como los traits
--      de cioIdentifyProfessional), motivo en offline. Nada personal.
--      Sin duplicados: online/offline salen sólo cuando el estado cambia, así
--      que un barrido repetido o un apagado manual después de un vencimiento no
--      generan un segundo offline.
--
--   2. `cio.ondemand_no_pro_found` — perfil del PACIENTE: pidió una consulta
--      inmediata (hay pedido en `ondemand_requests`) y nadie lo tomó.
--        · desenlace 'vencio': venció sin que nadie aceptara. Sale recién
--          cuando ya no se puede revivir ("Seguir buscando" puede revivir un
--          pedido vencido hasta 20 min después de pedido), con occurred_at = su
--          último vencimiento. También cuenta el que se canceló al querer seguir
--          buscando sin tarjeta guardada: nadie lo tomó a tiempo.
--        · desenlace 'cancelo': el paciente se fue mientras esperaba. Las
--          cancelaciones de los primeros 5 segundos no cuentan: no hubo espera
--          (ahí cae también cuando el sistema cancela porque no pudo guardar el
--          pago, que pasa en el mismo segundo del pedido).
--      Propiedad: segundos_espera. SIN vertical ni especialidad: en un evento de
--      paciente son dato de salud (la misma guarda que sanitizeEventProps en el
--      front). Diferencia con `ondemand_no_match` (evento del navegador): ese
--      sale cuando el paciente VE la pantalla de sin respuesta (cause
--      nadie_acepto) o cuando no había nadie al entrar (cause
--      sin_profesionales, sin pedido ni espera). Éste sale del servidor aunque
--      haya cerrado la pestaña, y sólo cuando hubo pedido y espera.
--
-- Cuentas de prueba: las vistas `cio` las dejan afuera (profiles.es_prueba o
-- professional_profiles.solo_pruebas). Las vistas `*_todos` de `public` tienen
-- todo, con la columna es_prueba, para probar en staging; ni anon ni
-- authenticated las leen (sólo service role / SQL).
--
-- No se toca ninguna vista cio existente ni ningún nombre de evento existente.
-- Control: `bash scripts/correr-test.sh cio_presencia_250 staging`.

-- ── 1. Motivo del apagado y hora de registro ─────────────────────────────────
alter table public.presencia_profesional_eventos
  add column if not exists motivo text
    check (motivo is null or motivo in ('manual', 'otro'));

comment on column public.presencia_profesional_eventos.motivo is
  'Sólo en desconecto: manual = lo apagó el propio profesional (auth.uid() = él); otro = sistema o admin. Null en las filas anteriores a la 250. Migración 250.';

-- Cuándo se escribió la fila (≠ momento en los vencimientos). Las filas de
-- antes toman su momento: ya están todas a la vista del primer sync.
alter table public.presencia_profesional_eventos
  add column if not exists registrado_at timestamptz;
update public.presencia_profesional_eventos set registrado_at = momento where registrado_at is null;
alter table public.presencia_profesional_eventos
  alter column registrado_at set default now(),
  alter column registrado_at set not null;

comment on column public.presencia_profesional_eventos.registrado_at is
  'Cuándo se escribió la fila. Cursor del sync de Customer.io (un vencio se fecha en el pasado). Migración 250.';

-- ── 2. Trigger: motivo del apagado + el vencimiento que el barrido no vio ────
-- Si el latido vuelve, o el profesional apaga, entre "último latido + 1 h" y la
-- siguiente pasada del barrido (cada 5 min), el barrido nunca anotaba el vencio:
-- quedaba "en línea" de más y el offline salía como manual en vez de timeout.
create or replace function public.presencia_anotar_cambio()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- La vigencia ya había vencido y el barrido todavía no lo anotó (corre cada
  -- 5 min): se anota acá, con el mismo momento que usaría el barrido. Vale al
  -- revivir y al apagar; el índice único evita duplicarlo.
  if old.on_demand_since is not null
     and old.on_demand_last_seen_at is not null
     and old.on_demand_last_seen_at + interval '1 hour' <= now() then
    insert into presencia_profesional_eventos (professional_id, specialty, evento, momento, es_prueba)
    values (new.user_id, old.specialty, 'vencio', old.on_demand_last_seen_at + interval '1 hour', coalesce(old.solo_pruebas, false))
    on conflict (professional_id, momento) where evento = 'vencio' do nothing;
  end if;

  if new.on_demand_since is null then
    -- Se apagó (switch o `professional_offline`). Sólo si antes estaba.
    -- Si ya había vencido, este desconecto no genera un segundo offline.
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

-- ── 3. Presencia como eventos, con todo (incluidas las cuentas de prueba) ────
-- Vistas nuevas de esta migración: se recrean enteras (re-aplicarla no choca
-- con un orden de columnas viejo).
drop view if exists cio.ondemand_pro_eventos;
drop view if exists cio.ondemand_no_pro_found;
drop view if exists public.cio_ondemand_pro_eventos_todos;
drop view if exists public.cio_ondemand_no_pro_found_todos;

create or replace view public.cio_ondemand_pro_eventos_todos with (security_invoker = false) as
with presencia as (
  -- `efectivo`: cuándo pasó de verdad. El vencio de la 237 guarda último
  -- latido + 1 h; el offline por timeout se fecha en el último latido, y todo
  -- se ordena y se cruza con esa misma hora.
  select e.id, e.professional_id, e.specialty, e.evento, e.motivo, e.registrado_at,
         case when e.evento = 'vencio' then e.momento - interval '1 hour' else e.momento end as efectivo,
         (e.es_prueba or coalesce(pr.es_prueba, false)) as es_prueba,
         case when e.evento = 'conecto' then 'online' else 'offline' end as estado
    from public.presencia_profesional_eventos e
    left join public.profiles pr on pr.id = e.professional_id
),
transiciones as (
  -- Sólo cuando cambia el estado: nada de offline repetidos.
  select * from (
    select p.*,
           lag(p.estado) over (partition by p.professional_id order by p.efectivo, p.id) as estado_previo
      from presencia p
  ) x
   where x.estado_previo is distinct from x.estado
),
consultas as (
  -- Cada tramo en curso: desde que entra a in_progress hasta que sale, o hasta
  -- que el profesional la cierra, lo que pase primero; nunca más de 3 h (el
  -- mismo corte que la chapa "Ocupado", 168: una consulta colgada no deja a
  -- nadie ocupado para siempre). Los participantes pueden escribir filas en
  -- consultation_events, pero también pueden pasar la consulta a in_progress
  -- de verdad: el tope de 3 h acota cualquiera de los dos casos.
  select c.professional_id, ini.created_at as desde,
         least(fin.created_at,
               case when c.professional_ended_at >= ini.created_at then c.professional_ended_at end,
               ini.created_at + interval '3 hours') as hasta
    from public.consultation_events ini
    join public.consultations c on c.id = ini.consultation_id
    left join lateral (
      select f.created_at from public.consultation_events f
       where f.consultation_id = ini.consultation_id
         and f.event = 'status_changed'
         and f.detail ->> 'from' = 'in_progress'
         and f.created_at >= ini.created_at
       order by f.created_at
       limit 1
    ) fin on true
   where ini.event = 'status_changed'
     and ini.detail ->> 'to' = 'in_progress'
     and coalesce(ini.detail ->> 'from', '') <> 'in_progress'
     and c.professional_id is not null
  union all
  -- Las que nacen ya en curso (emergencias, la fila de espera presencial): el
  -- trigger de la 070 sólo anota cambios, así que no tienen fila de entrada.
  -- Arrancan al crearse.
  select c.professional_id, c.created_at,
         least(fin.created_at,
               case when c.professional_ended_at >= c.created_at then c.professional_ended_at end,
               c.created_at + interval '3 hours')
    from public.consultations c
    left join lateral (
      select f.created_at from public.consultation_events f
       where f.consultation_id = c.id
         and f.event = 'status_changed'
         and f.detail ->> 'from' = 'in_progress'
       order by f.created_at
       limit 1
    ) fin on true
   where c.professional_id is not null
     and (c.status = 'in_progress' or fin.created_at is not null)
     and not exists (
       select 1 from public.consultation_events e
        where e.consultation_id = c.id
          and e.event = 'status_changed'
          and e.detail ->> 'to' = 'in_progress'
          and e.created_at <= coalesce(fin.created_at, 'infinity'))
),
pasos as (
  select professional_id, desde as t, 1 as delta from consultas
  union all
  select professional_id, hasta, -1 from consultas where hasta <= now()
),
abiertas as (
  -- Cuántas consultas en curso tiene después de cada instante (los pasos de un
  -- mismo instante se suman juntos: cerrar una y abrir otra a la vez no da un
  -- available + busy de 0 segundos).
  select professional_id, t,
         sum(sum(delta)) over (partition by professional_id order by t rows unbounded preceding) as n
    from pasos
   group by professional_id, t
),
candidatos as (
  -- Cambios de ocupación, y además: al conectarse con una consulta ya en curso
  -- arranca ocupado.
  select a.professional_id, a.t, case when a.n > 0 then 'busy' else 'available' end as tipo
    from abiertas a
  union all
  select t.professional_id, t.efectivo, 'busy'
    from transiciones t
   where t.estado = 'online'
     and (select a.n from abiertas a
           where a.professional_id = t.professional_id and a.t <= t.efectivo
           order by a.t desc limit 1) > 0
),
en_linea as (
  -- Sólo lo que pasa mientras está en línea. `tramo` = el online que lo abre:
  -- cada conexión arranca libre, y un offline cierra cualquier busy.
  select c.*, ahora.id as tramo, ahora.es_prueba, ahora.specialty
    from candidatos c
    join lateral (
      select t.estado, t.id, t.es_prueba, t.specialty from transiciones t
       where t.professional_id = c.professional_id and t.efectivo <= c.t
       order by t.efectivo desc, t.id desc
       limit 1
    ) ahora on ahora.estado = 'online'
),
ocupacion as (
  select e.*,
         lag(e.tipo) over (partition by e.professional_id, e.tramo order by e.t, e.tipo desc) as tipo_previo
    from en_linea e
)
select 'presencia:' || t.id::text                          as ref_id,
       case when t.estado = 'online' then 'ondemand_pro_online' else 'ondemand_pro_offline' end
                                                           as event_name,
       t.professional_id                                   as person_id,
       t.efectivo                                          as occurred_at,
       t.registrado_at                                     as visible_desde,
       case when t.evento = 'vencio'     then 'timeout'
            when t.evento = 'desconecto' then coalesce(t.motivo, 'sin_dato')
       end                                                 as motivo,
       esp.vertical_id                                     as vertical,
       t.specialty                                         as especialidad,
       t.es_prueba
  from transiciones t
  left join public.specialties esp on esp.slug = t.specialty
union all
select 'ocupacion:' || o.professional_id::text || ':' || o.tipo || ':' || extract(epoch from o.t)::text,
       case when o.tipo = 'busy' then 'ondemand_pro_busy' else 'ondemand_pro_available' end,
       o.professional_id,
       o.t,
       o.t,
       null,
       esp.vertical_id,
       o.specialty,
       o.es_prueba
  from ocupacion o
  left join public.specialties esp on esp.slug = o.specialty
 where o.tipo is distinct from coalesce(o.tipo_previo, 'available');

-- Límites conocidos (aceptados para este estadio):
--  · Un vencio se fecha en el último latido y aparece más tarde: un busy de esa
--    hora que ya se sincronizó puede dejar de figurar en la vista. Customer.io
--    se queda con el que tiene, después de un offline.
--  · visible_desde es la hora de la transacción, no la de su commit: el sync
--    tiene que releer con un margen (los últimos 10 min; ref_id deduplica).
--  · Recalcula toda la historia en cada lectura. Con el volumen de hoy son
--    milisegundos; si crece, pasar a una tabla mantenida por el barrido.

comment on view public.cio_ondemand_pro_eventos_todos is
  'Eventos de presencia on-demand del profesional, CON cuentas de prueba (columna es_prueba). Base de cio.ondemand_pro_eventos. Migración 250.';

revoke all on public.cio_ondemand_pro_eventos_todos from public, anon, authenticated;

-- ── 4. Pedido sin nadie que lo tome, con todo ────────────────────────────────
create or replace view public.cio_ondemand_no_pro_found_todos with (security_invoker = false) as
with cerrados as (
  select r.id, r.patient_id, r.created_at,
         case
           -- Venció y ya no se puede revivir (techo de 20 min de ondemand-despacho).
           when r.status = 'expired' then 'vencio'
           -- Quiso seguir buscando sin tarjeta guardada: ya había vencido.
           when r.status = 'cancelled' and r.cancelled_at > r.expires_at then 'vencio'
           when r.status = 'cancelled' then 'cancelo'
         end as desenlace,
         case when r.status = 'expired' or r.cancelled_at > r.expires_at then r.expires_at
              else r.cancelled_at end as fin,
         -- + 2 min: el cron que marca 'expired' corre cada minuto; la fila nunca
         -- aparece después de su visible_desde.
         case when r.status = 'expired' then greatest(r.created_at + interval '20 minutes', r.expires_at) + interval '2 minutes'
              else r.cancelled_at end as visible_desde
    from public.ondemand_requests r
   where r.accepted_by is null
     and ((r.status = 'expired' and greatest(r.created_at + interval '20 minutes', r.expires_at) + interval '2 minutes' <= now())
          or (r.status = 'cancelled' and r.cancelled_at is not null))
)
select c.id                                                as ref_id,
       'ondemand_no_pro_found'::text                       as event_name,
       c.patient_id                                        as person_id,
       c.fin                                               as occurred_at,
       c.visible_desde,
       c.desenlace,
       greatest(0, extract(epoch from c.fin - c.created_at))::integer as segundos_espera,
       coalesce(pr.es_prueba, false)                       as es_prueba
  from cerrados c
  left join public.profiles pr on pr.id = c.patient_id
 where not (c.desenlace = 'cancelo' and c.fin < c.created_at + interval '5 seconds');

comment on view public.cio_ondemand_no_pro_found_todos is
  'Pedidos de consulta inmediata que nadie tomó (venció sin revivir, o el paciente se fue después de 5 s), CON cuentas de prueba. Sin vertical ni especialidad. Base de cio.ondemand_no_pro_found. Migración 250.';

revoke all on public.cio_ondemand_no_pro_found_todos from public, anon, authenticated;

-- ── 5. Vistas para Customer.io: sin cuentas de prueba ────────────────────────
create or replace view cio.ondemand_pro_eventos with (security_invoker = false) as
select ref_id, event_name, person_id, occurred_at,
       extract(epoch from occurred_at)::bigint as occurred_timestamp,
       visible_desde,
       motivo, vertical, especialidad
  from public.cio_ondemand_pro_eventos_todos
 where not es_prueba;

comment on view cio.ondemand_pro_eventos is
  'ondemand_pro_online / _offline (motivo manual|timeout|otro|sin_dato) / _busy / _available en el perfil del profesional. Cursor del sync: visible_desde. Sin cuentas de prueba. Migración 250.';

create or replace view cio.ondemand_no_pro_found with (security_invoker = false) as
select ref_id, event_name, person_id, occurred_at,
       extract(epoch from occurred_at)::bigint as occurred_timestamp,
       visible_desde,
       desenlace, segundos_espera
  from public.cio_ondemand_no_pro_found_todos
 where not es_prueba;

comment on view cio.ondemand_no_pro_found is
  'El paciente pidió consulta inmediata y nadie la tomó (desenlace vencio|cancelo, segundos_espera). Cursor del sync: visible_desde. Sin vertical ni especialidad. Sin cuentas de prueba. Migración 250.';

revoke all on cio.ondemand_pro_eventos  from public, anon, authenticated;
revoke all on cio.ondemand_no_pro_found from public, anon, authenticated;
grant select on cio.ondemand_pro_eventos  to cio_reader;
grant select on cio.ondemand_no_pro_found to cio_reader;
