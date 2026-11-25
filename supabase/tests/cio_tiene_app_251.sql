-- Control de la 251. Sólo lectura. Cada fila ok = true.
select 'cio.people tiene las 7 columnas al final' as chequeo,
       (select array_agg(column_name::text order by ordinal_position) from information_schema.columns
         where table_schema = 'cio' and table_name = 'people'
           and column_name in ('tiene_app','app_plataforma','app_push_activo','app_ultimo_uso_at',
                               'referido_por_profesional_id','referido_por_profesional_nombre','link_referido'))
       = array['tiene_app','app_plataforma','app_push_activo','app_ultimo_uso_at',
               'referido_por_profesional_id','referido_por_profesional_nombre','link_referido'] as ok
union all
select 'el arreglo de signup de la 234 sigue', position('aceptar el consentimiento' in pg_get_viewdef('cio.people'::regclass)) > 0
union all
select 'cio_reader lee cio.people y puede ejecutar app_instalada',
       has_table_privilege('cio_reader', 'cio.people', 'select')
   and has_function_privilege('cio_reader', 'cio.app_instalada(uuid)', 'execute')
union all
select 'quien tiene token de push figura con la app',
       not exists (select 1 from cio.people c join public.expo_push_tokens t on t.user_id = c.id where not c.tiene_app)
union all
select 'sin cuentas de prueba', not exists (select 1 from cio.people c join public.profiles p on p.id = c.id where p.es_prueba);
