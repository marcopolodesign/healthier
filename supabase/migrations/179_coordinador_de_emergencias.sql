-- ============================================================
-- Migration 179 — El coordinador de emergencias (despacho desde la app)
-- ============================================================
--
-- Mateo, 2026-09-28: el super admin elige quién coordina las ambulancias. A
-- esa persona le llega un push por cada pedido nuevo y, desde la app, le
-- asigna ambulancia y médico. Recién ahí le llega el push al médico.
-- Decisiones suyas:
--   · El coordinador puede ser CUALQUIER usuario (paciente, médico, super
--     admin): no se le cambia el rol. Se modela como staff activo de la
--     entidad de emergencias (`emergency_provider_staff`, marcado con
--     `es_coordinador`), que es a quien ya le avisa `avisar_pedido_en_cola`
--     (migración 158).
--   · El médico se elige entre TODOS los profesionales verificados de una
--     especialidad médica, no sólo de la tripulación del móvil.
-- Como el coordinador puede no tener el rol de operador, todo lo que hace va
-- por funciones SECURITY DEFINER que chequean que sea coordinador, en vez de
-- ampliar las policies de `emergencies`.
-- ============================================================

-- ── ¿Soy coordinador? ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.soy_coordinador_emergencias()
 RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.emergency_provider_staff s
    join public.emergency_providers p on p.id = s.provider_id
    where s.profile_id = auth.uid() and s.active and p.active
  );
$function$;

-- Especialidades que NO son médicas (no van en una ambulancia).
CREATE OR REPLACE FUNCTION public.es_especialidad_medica(p text)
 RETURNS boolean
 LANGUAGE sql IMMUTABLE
AS $function$
  select coalesce(p, '') not in ('', 'psicologia', 'nutricion', 'entrenamiento', 'kinesiologia', 'veterinaria', 'otra');
$function$;

-- ── La cola ────────────────────────────────────────────────
-- Pedidos pagos y triados esperando móvil, ROJO primero y después por antigüedad.
CREATE OR REPLACE FUNCTION public.cola_de_despacho()
 RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.soy_coordinador_emergencias() then
    raise exception 'Sólo el coordinador de emergencias' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(x order by x->>'orden', x->>'created_at')
    from (
      select jsonb_build_object(
        'id', e.id,
        'triage_code', e.triage_code,
        'notes', e.notes,
        'created_at', e.created_at,
        'patient_latitude', e.patient_latitude,
        'patient_longitude', e.patient_longitude,
        'patient_name', p.full_name,
        'patient_phone', p.phone,
        'patient_birth_date', p.birth_date,
        'orden', case e.triage_code when 'ROJO' then '1' when 'AMARILLO' then '2' else '3' end
      ) x
      from public.emergencies e
      join public.profiles p on p.id = e.patient_id
      where e.status = 'awaiting_dispatch' and e.paid_at is not null
    ) t
  ), '[]'::jsonb);
end;
$function$;

-- ── Con qué se puede asignar ───────────────────────────────
CREATE OR REPLACE FUNCTION public.opciones_de_despacho()
 RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.soy_coordinador_emergencias() then
    raise exception 'Sólo el coordinador de emergencias' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'ambulancias', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'label', a.label, 'plate', a.plate, 'unit_type', a.unit_type,
        'status', a.status, 'provider', pr.name
      ) order by (a.status = 'disponible') desc, a.label)
      from public.ambulances a
      join public.emergency_providers pr on pr.id = a.provider_id and pr.active
      where a.active and a.status <> 'fuera_de_servicio'
    ), '[]'::jsonb),
    'medicos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'full_name', p.full_name, 'avatar_url', p.avatar_url,
        'specialty', pp.specialty, 'solo_pruebas', coalesce(pp.solo_pruebas, false)
      ) order by coalesce(pp.solo_pruebas, false), p.full_name)
      from public.professional_profiles pp
      join public.profiles p on p.id = pp.user_id
      where pp.is_verified and public.es_especialidad_medica(pp.specialty)
        and p.deleted_at is null
    ), '[]'::jsonb)
  );
end;
$function$;

-- ── Asignar ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.asignar_emergencia(p_emergency_id uuid, p_ambulance_id uuid, p_medico_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  e public.emergencies%rowtype;
  a public.ambulances%rowtype;
  codigo text;
begin
  if not public.soy_coordinador_emergencias() then
    raise exception 'Sólo el coordinador de emergencias' using errcode = '42501';
  end if;

  select * into e from public.emergencies where id = p_emergency_id for update;
  if not found then raise exception 'No existe la emergencia' using errcode = 'P0002'; end if;
  if e.status <> 'awaiting_dispatch' then
    raise exception 'Este pedido ya no está en la cola (%).', e.status using errcode = 'check_violation';
  end if;

  select * into a from public.ambulances where id = p_ambulance_id and active for update;
  if not found then raise exception 'No existe esa ambulancia' using errcode = 'P0002'; end if;
  if a.status = 'fuera_de_servicio' then
    raise exception 'Esa ambulancia está fuera de servicio' using errcode = 'check_violation';
  end if;

  if not exists (
    select 1 from public.professional_profiles pp
    where pp.user_id = p_medico_id and pp.is_verified and public.es_especialidad_medica(pp.specialty)
  ) then
    raise exception 'Ese profesional no es un médico verificado' using errcode = 'check_violation';
  end if;

  codigo := coalesce(e.dispatch_code, 'UTM-' || (1000 + floor(random() * 9000))::int::text);

  -- El trigger `emergencies_avisar_asignada` manda el push a la tripulación
  -- del móvil y al médico elegido.
  update public.emergencies set
    ambulance_id = a.id,
    provider_id = a.provider_id,
    professional_id = p_medico_id,
    operator_id = auth.uid(),
    status = 'dispatched',
    dispatched_at = now(),
    dispatch_code = codigo
  where id = e.id;

  update public.ambulances set status = 'en_servicio' where id = a.id;

  return jsonb_build_object('dispatch_code', codigo);
end;
$function$;

-- ── El push de "asignada" también le llega al médico elegido ─
-- (antes sólo a la tripulación cargada del móvil; ahora el médico puede no
-- estar en esa tripulación).
CREATE OR REPLACE FUNCTION public.avisar_emergencia_asignada()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_destinatario uuid;
  v_movil        text;
begin
  if new.ambulance_id is null then return new; end if;

  select label into v_movil from public.ambulances where id = new.ambulance_id;

  for v_destinatario in
    select profile_id from public.ambulance_crew
     where ambulance_id = new.ambulance_id and active
    union
    select new.professional_id where new.professional_id is not null
  loop
    perform public.enviar_push(
      v_destinatario,
      '🚨 Emergencia asignada',
      'Código ' || coalesce(new.triage_code, '') ||
        case when new.dispatch_code is not null then ' (' || new.dispatch_code || ')' else '' end ||
        case when v_movil is not null then ' · ' || v_movil else '' end ||
        '. Abrí la app para salir.',
      '/profesional/emergencias?id=' || new.id::text
    );
  end loop;

  return new;
end;
$function$;

-- ── El super admin elige al coordinador ────────────────────
-- Por ahora hay UNO, marcado con `es_coordinador`. No se desactiva a nadie:
-- los operadores del despacho web siguen siendo staff y también reciben el
-- aviso de la cola (y pueden usar la pantalla de la app).
ALTER TABLE public.emergency_provider_staff
  ADD COLUMN IF NOT EXISTS es_coordinador boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.definir_coordinador_emergencias(p_profile_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  prov uuid;
begin
  if public.get_my_role() is distinct from 'super_admin' then
    raise exception 'Sólo un super admin' using errcode = '42501';
  end if;
  select id into prov from public.emergency_providers where active order by created_at limit 1;
  if prov is null then
    raise exception 'No hay una empresa de ambulancias activa cargada' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.profiles where id = p_profile_id) then
    raise exception 'No existe ese usuario' using errcode = 'P0002';
  end if;

  update public.emergency_provider_staff set es_coordinador = false where es_coordinador;
  update public.emergency_provider_staff set active = true, es_coordinador = true
   where provider_id = prov and profile_id = p_profile_id;
  if not found then
    insert into public.emergency_provider_staff (provider_id, profile_id, active, es_coordinador)
    values (prov, p_profile_id, true, true);
  end if;
  return public.coordinador_emergencias();
end;
$function$;

CREATE OR REPLACE FUNCTION public.coordinador_emergencias()
 RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((
    select jsonb_build_object('profile_id', p.id, 'full_name', p.full_name, 'email', p.email, 'provider', pr.name)
    from public.emergency_provider_staff s
    join public.emergency_providers pr on pr.id = s.provider_id and pr.active
    join public.profiles p on p.id = s.profile_id
    where s.active and s.es_coordinador
    limit 1
  ), 'null'::jsonb);
$function$;

REVOKE ALL ON FUNCTION public.soy_coordinador_emergencias() FROM public, anon;
REVOKE ALL ON FUNCTION public.cola_de_despacho() FROM public, anon;
REVOKE ALL ON FUNCTION public.opciones_de_despacho() FROM public, anon;
REVOKE ALL ON FUNCTION public.asignar_emergencia(uuid, uuid, uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.definir_coordinador_emergencias(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.coordinador_emergencias() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.soy_coordinador_emergencias() TO authenticated;
GRANT EXECUTE ON FUNCTION public.cola_de_despacho() TO authenticated;
GRANT EXECUTE ON FUNCTION public.opciones_de_despacho() TO authenticated;
GRANT EXECUTE ON FUNCTION public.asignar_emergencia(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.definir_coordinador_emergencias(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.coordinador_emergencias() TO authenticated;
