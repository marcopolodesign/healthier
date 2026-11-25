-- Control de la migración 250 (eventos de presencia y no_pro_found para Customer.io).
-- Sólo lectura. `bash scripts/correr-test.sh cio_presencia_250 staging|prod`.
-- Cada fila debe dar ok = true.
select 'sin offline ni online repetidos seguidos' as chequeo,
       not exists (
         select 1 from (
           select person_id, event_name,
                  -- Desempate por el id numérico: un online y su timeout pueden
                  -- caer en el mismo instante (se conectó y no volvió a latir).
                  lag(event_name) over (partition by person_id
                                        order by occurred_at, split_part(ref_id, ':', 2)::bigint) as previo
             from public.cio_ondemand_pro_eventos_todos
            where event_name in ('ondemand_pro_online', 'ondemand_pro_offline')
         ) x where x.event_name = x.previo
       ) as ok
union all
select 'busy y available se alternan dentro de cada conexión',
       not exists (
         select 1 from (
           select person_id, event_name, occurred_at,
                  lag(event_name)  over w as previo,
                  lag(occurred_at) over w as previo_at
             from public.cio_ondemand_pro_eventos_todos
            where event_name in ('ondemand_pro_busy', 'ondemand_pro_available')
           window w as (partition by person_id order by occurred_at, event_name desc)
         ) x
          where x.event_name = x.previo
            -- Dos iguales seguidos sólo si en el medio hubo un offline.
            and not exists (select 1 from public.cio_ondemand_pro_eventos_todos o
                             where o.person_id = x.person_id and o.event_name = 'ondemand_pro_offline'
                               and o.occurred_at between x.previo_at and x.occurred_at)
       )
union all
select 'todas las filas ya visibles (visible_desde <= ahora)',
       not exists (select 1 from public.cio_ondemand_pro_eventos_todos where visible_desde > now())
   and not exists (select 1 from public.cio_ondemand_no_pro_found_todos where visible_desde > now())
union all
select 'cancelaciones de menos de 5 s no cuentan',
       not exists (select 1 from public.cio_ondemand_no_pro_found_todos
                    where desenlace = 'cancelo' and segundos_espera < 5)
union all
select 'vencidos sólo cuando ya no se pueden revivir (20 min)',
       not exists (select 1 from public.cio_ondemand_no_pro_found_todos v
                     join public.ondemand_requests r on r.id = v.ref_id
                    where r.status = 'expired' and r.created_at + interval '20 minutes' > now())
union all
select 'visible_desde nunca antes que occurred_at',
       not exists (select 1 from public.cio_ondemand_pro_eventos_todos where visible_desde < occurred_at)
   and not exists (select 1 from public.cio_ondemand_no_pro_found_todos where visible_desde < occurred_at)
union all
select 'timeout = último latido (antes que el vencimiento guardado)',
       not exists (
         select 1 from public.cio_ondemand_pro_eventos_todos v
           join public.presencia_profesional_eventos e on 'presencia:' || e.id = v.ref_id
          where e.evento = 'vencio' and v.occurred_at <> e.momento - interval '1 hour')
union all
select 'offline siempre con motivo',
       not exists (select 1 from public.cio_ondemand_pro_eventos_todos
                    where event_name = 'ondemand_pro_offline' and motivo is null)
union all
select 'ref_id único (Customer.io no duplica)',
       (select count(*) = count(distinct ref_id) from public.cio_ondemand_pro_eventos_todos)
   and (select count(*) = count(distinct ref_id) from public.cio_ondemand_no_pro_found_todos)
union all
select 'cio sin cuentas de prueba (profesional)',
       not exists (select 1 from cio.ondemand_pro_eventos c
                     join public.cio_ondemand_pro_eventos_todos t using (ref_id) where t.es_prueba)
union all
select 'cio sin cuentas de prueba (paciente)',
       not exists (select 1 from cio.ondemand_no_pro_found c
                     join public.cio_ondemand_no_pro_found_todos t using (ref_id) where t.es_prueba)
union all
select 'no_pro_found sin vertical ni especialidad',
       not exists (select 1 from information_schema.columns
                    where table_schema = 'cio' and table_name = 'ondemand_no_pro_found'
                      and column_name ~* 'vertical|specialty|especialidad')
union all
select 'no_pro_found sólo pedidos que nadie tomó',
       not exists (select 1 from public.cio_ondemand_no_pro_found_todos v
                     join public.ondemand_requests r on r.id = v.ref_id where r.accepted_by is not null)
union all
select 'anon y authenticated no leen las vistas _todos',
       not has_table_privilege('anon', 'public.cio_ondemand_pro_eventos_todos', 'select')
   and not has_table_privilege('authenticated', 'public.cio_ondemand_pro_eventos_todos', 'select')
   and not has_table_privilege('anon', 'public.cio_ondemand_no_pro_found_todos', 'select')
   and not has_table_privilege('authenticated', 'public.cio_ondemand_no_pro_found_todos', 'select')
union all
select 'cio_reader lee las dos vistas',
       has_table_privilege('cio_reader', 'cio.ondemand_pro_eventos', 'select')
   and has_table_privilege('cio_reader', 'cio.ondemand_no_pro_found', 'select');
