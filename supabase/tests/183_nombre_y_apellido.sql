-- Control de la migración 183 (nombre y apellido). Corre dentro de una
-- transacción que se revierte: no deja nada escrito. Todas las filas tienen que
-- dar ok = true. Se corre contra STAGING (usa paciente@healthier.app y un
-- profesional verificado cualquiera), por ejemplo con el endpoint
-- /v1/projects/<ref>/database/query de la Management API.
begin;
create temp table r(caso text, ok boolean, detalle text) on commit drop;

insert into r select 'normalizado orden/mayus/titulo',
  nombre_normalizado('DRA. SEMINARIO AGUIRRE, CINTIA') = nombre_normalizado('Cintia Seminario Agüirre'),
  nombre_normalizado('DRA. SEMINARIO AGUIRRE, CINTIA');
insert into r select 'normalizado distinto si cambia palabra',
  nombre_normalizado('Cintia Seminario') <> nombre_normalizado('Cintia Seminario Aguirre'), null;

-- Perfil de prueba existente (paciente demo) — se toca dentro de la transacción y se revierte.
do $$
declare v uuid; r1 record;
begin
  select id into v from profiles where email='paciente@healthier.app' and titular_id is null;
  update profiles set first_name='Ana María', last_name='  Pérez   Gómez ' where id=v;
  select * into r1 from profiles where id=v;
  insert into r values ('first+last arma full_name', r1.full_name='Ana María Pérez Gómez' and r1.last_name='Pérez Gómez', r1.full_name);
  update profiles set full_name='Otra Persona' where id=v;
  select * into r1 from profiles where id=v;
  insert into r values ('solo full_name (cliente viejo) vacía el split', r1.first_name is null and r1.last_name is null and r1.full_name='Otra Persona', r1.full_name);
  update profiles set first_name='Juan', last_name='Paz', full_name='lo que sea' where id=v;
  select * into r1 from profiles where id=v;
  insert into r values ('cliente nuevo manda las tres: gana el split', r1.full_name='Juan Paz', r1.full_name);
  update profiles set phone=phone where id=v;
  select * into r1 from profiles where id=v;
  insert into r values ('update ajeno no toca nada', r1.full_name='Juan Paz' and r1.last_name='Paz', r1.full_name);
  update profiles set full_name='Juan Paz' where id=v;
  select * into r1 from profiles where id=v;
  insert into r values ('full_name igual al armado no vacía', r1.last_name='Paz', r1.last_name);
end $$;

-- Re-verificación: profesional verificado. Se simula sesión del propio profesional.
do $$
declare v uuid; nombre text; pv boolean; pend boolean;
begin
  select pp.user_id, p.full_name into v, nombre from professional_profiles pp join profiles p on p.id=pp.user_id
   where pp.is_verified and p.full_name ~ ' ' limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v, 'role','authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  -- mismas palabras, otro orden + mayúsculas
  update profiles set first_name = upper(split_part(nombre,' ',2)) , last_name = split_part(nombre,' ',1) || coalesce(nullif(' ' || array_to_string((string_to_array(nombre,' '))[3:], ' '), ' '), '')
   where id=v;
  perform set_config('role', 'postgres', true);
  select is_verified, reverification_pending into pv, pend from professional_profiles where user_id=v;
  insert into r values ('reordenar nombre NO baja verificación', pv and not coalesce(pend,false), (select full_name from profiles where id=v) || ' <- ' || nombre);
  perform set_config('role', 'authenticated', true);
  update profiles set last_name = 'Distinto' where id=v;
  perform set_config('role', 'postgres', true);
  select is_verified, reverification_pending into pv, pend from professional_profiles where user_id=v;
  insert into r values ('cambiar una palabra SÍ baja verificación', (not pv) and pend, null);
end $$;

select * from r;
rollback;
