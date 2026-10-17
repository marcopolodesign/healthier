-- ─────────────────────────────────────────────────────────────────────────────
-- Una derivación a una especialidad sigue siendo reservable aunque esa
-- especialidad cambie de vertical (revisión pre-prod, 2026-10-17).
--
-- `validar_consulta_derivada` (195) exigía que la vertical del profesional que
-- toma el turno fuera la `vertical_destino` guardada en la derivación. Desde
-- la 199/200 las especialidades se mueven de vertical desde el super admin
-- (Psiquiatría salió de Clínica, Entrenamiento pasó a Preparación física, y el
-- propio `crear_vertical` sugiere hacerlo): una derivación abierta a
-- "Clínica · Psiquiatría" quedaba imposible de reservar con un psiquiatra.
--
-- Ahora, cuando la derivación tiene `especialidad_destino`, se valida SÓLO la
-- especialidad (que es lo que eligió el profesional que derivó); la vertical
-- se mira únicamente en las derivaciones a una vertical sin especialidad.
-- Además se alinea la `vertical_destino` guardada de las abiertas, para que el
-- texto ("Derivación a Psiquiatría") diga la vertical actual.
--
-- El resto de la función es idéntico al de la 195 tal como está hoy en staging
-- y en producción (comparado con pg_get_functiondef el 2026-10-17).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.validar_consulta_derivada()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  d      public.derivaciones%rowtype;
  v_esp  text;
  v_vert text;
begin
  if new.derivacion_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.derivacion_id is not distinct from old.derivacion_id then return new; end if;

  select * into d from public.derivaciones where id = new.derivacion_id;
  if not found or d.patient_id is distinct from new.patient_id then
    raise exception 'La derivación no corresponde a este paciente.' using errcode = '22023';
  end if;
  -- Una reserva que quedó sin pagar (el pago falló o se abandonó) no bloquea:
  -- el turno nace `pending_payment` antes del cobro, y sin esto un reintento
  -- de pago o una reserva nueva chocaba contra la derivación ya "reservada".
  if d.vence_at < now() or not (
       d.estado in ('pendiente', 'rechazada')
       or (d.estado = 'reservada' and exists (
             select 1 from public.consultations c
              where c.id = d.consulta_reservada_id
                and c.status = 'pending' and c.payment_status = 'pending_payment'))
     ) then
    raise exception 'La derivación ya no está vigente.' using errcode = '22023';
  end if;
  if d.profesional_destino_id is not null and d.rechazada_at is null then
    if new.professional_id is distinct from d.profesional_destino_id then
      raise exception 'La derivación es para otro profesional.' using errcode = '22023';
    end if;
  elsif d.profesional_destino_id is not null then
    -- Rechazada: cualquier otro profesional de la misma especialidad que el
    -- que la rechazó (él no).
    if new.professional_id = d.profesional_destino_id then
      raise exception 'Este profesional no puede tomar la derivación.' using errcode = '22023';
    end if;
    if not exists (
      select 1
        from public.professional_profiles a, public.professional_profiles b
       where a.user_id = new.professional_id and b.user_id = d.profesional_destino_id
         and a.specialty = b.specialty
    ) then
      raise exception 'Ese profesional no es de la especialidad de la derivación.' using errcode = '22023';
    end if;
  else
    select pp.specialty, s.vertical_id into v_esp, v_vert
      from public.professional_profiles pp
      left join public.specialties s on s.slug = pp.specialty
     where pp.user_id = new.professional_id;
    if d.especialidad_destino is not null then
      -- Por especialidad: la vertical en la que esté hoy no importa.
      if v_esp is distinct from d.especialidad_destino then
        raise exception 'Ese profesional no es de la especialidad de la derivación.' using errcode = '22023';
      end if;
    elsif v_vert is distinct from d.vertical_destino then
      raise exception 'Ese profesional no es de la especialidad de la derivación.' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$function$;

-- Texto al día: la vertical guardada de las derivaciones abiertas (incluida
-- una reservada con el turno todavía sin pagar) pasa a la vertical actual de
-- su especialidad. Idempotente. En prod el 2026-10-16 había 0 filas.
update public.derivaciones d
   set vertical_destino = s.vertical_id
  from public.specialties s
 where s.slug = d.especialidad_destino
   and s.vertical_id is not null
   and d.vertical_destino is distinct from s.vertical_id
   and (
     d.estado in ('pendiente', 'rechazada')
     or (d.estado = 'reservada' and exists (
           select 1 from public.consultations c
            where c.id = d.consulta_reservada_id
              and c.status = 'pending' and c.payment_status = 'pending_payment'))
   );
