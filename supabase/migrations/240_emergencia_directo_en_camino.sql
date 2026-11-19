-- ============================================================
-- Migración 240 — Emergencias: la asignación sale directo "En camino"
-- ============================================================
-- Reunión del 18/11 con Maca (Medizin):
--
-- 1. Cuando el despacho asigna un móvil, el estado pasa directo a `in_transit`
--    (paciente y tripulación). Se saca el paso intermedio "Aceptar emergencia"
--    de la tripulación: el móvil ya salió, no hay nada que aceptar. `dispatched`
--    queda como valor válido (filas viejas, scripts de control), pero ningún
--    camino de la app lo escribe más.
-- 2. Al marcar "Llegué" y al cerrar la emergencia le llega un aviso también al
--    DESPACHO (staff de la entidad). Al paciente ya le llegaba el de "llegó".
--
-- No se renombra ninguna tabla ni columna.
-- ============================================================

-- ── 1 · asignar_emergencia (RPC del coordinador, app) ────────────────────
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

  -- Directo `in_transit` (migración 240): el trigger `emergencies_avisar_asignada`
  -- avisa a la tripulación y `emergencies_avisar_estado` al paciente ("va en camino").
  update public.emergencies set
    ambulance_id = a.id,
    provider_id = a.provider_id,
    professional_id = p_medico_id,
    operator_id = auth.uid(),
    status = 'in_transit',
    dispatched_at = now(),
    dispatch_code = codigo
  where id = e.id;

  update public.ambulances set status = 'en_servicio' where id = a.id;

  return jsonb_build_object('dispatch_code', codigo);
end;
$function$;

-- ── 2 · Avisos de estado: paciente (en camino / llegó) y despacho (llegó / cerró) ──
CREATE OR REPLACE FUNCTION public.avisar_emergencia_estado()
 RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_staff uuid;
  v_movil text;
  v_prov  uuid;
begin
  -- Al paciente: el médico salió, y el médico llegó. (No hay push de cierre:
  -- su pantalla pasa sola a "Atención finalizada".)
  if new.patient_id is not null then
    if new.status = 'in_transit' then
      perform public.enviar_push(
        new.patient_id,
        'El médico va en camino',
        'Ya salió hacia tu ubicación. Podés seguirlo en el mapa.',
        '/paciente/sos'
      );
    elsif new.status = 'arrived' then
      perform public.enviar_push(
        new.patient_id,
        'El médico llegó',
        'Está en tu ubicación.',
        '/paciente/sos'
      );
    end if;
  end if;

  -- Al despacho (staff activo de la entidad): llegó el móvil / se cerró.
  if new.status in ('arrived', 'completed') then
    select label into v_movil from public.ambulances where id = new.ambulance_id;
    v_prov := new.provider_id;
    for v_staff in
      select s.profile_id
        from public.emergency_provider_staff s
        join public.emergency_providers p on p.id = s.provider_id
       where s.active and p.active
         and (v_prov is null or s.provider_id = v_prov)
    loop
      perform public.enviar_push(
        v_staff,
        case when new.status = 'arrived' then 'El móvil llegó al paciente' else 'Emergencia cerrada' end,
        coalesce(v_movil, 'El móvil') ||
          case when new.dispatch_code is not null then ' · ' || new.dispatch_code else '' end ||
          case when new.status = 'arrived' then ' llegó al lugar.' else ': la tripulación cerró la emergencia.' end,
        '/despacho'
      );
    end loop;
  end if;

  return new;
end;
$function$;

DROP TRIGGER IF EXISTS emergencies_avisar_estado ON public.emergencies;
CREATE TRIGGER emergencies_avisar_estado
  AFTER UPDATE OF status ON public.emergencies
  FOR EACH ROW
  WHEN (new.status IS DISTINCT FROM old.status AND new.status IN ('in_transit', 'arrived', 'completed'))
  EXECUTE FUNCTION public.avisar_emergencia_estado();

-- ── 3 · Dónde está el móvil, para dibujarle la línea al paciente en el acto ──
-- Apenas se asigna, el paciente ve "En camino" pero `emergency_tracking` está
-- vacío hasta que el teléfono de la tripulación publica su primera posición, y
-- la línea esperaba además a que el paciente pidiera la ruta. Con la última
-- posición conocida del móvil (la de guardia, `ambulance_locations`) se dibuja
-- una línea ya, y se reemplaza por la ruta real cuando llega. Sólo el paciente
-- de ESA emergencia y mientras está activa.
CREATE OR REPLACE FUNCTION public.ubicacion_movil_de_mi_emergencia(p_emergency_id uuid)
 RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
           'latitude', l.latitude, 'longitude', l.longitude, 'updated_at', l.updated_at)
    from public.emergencies e
    join public.ambulance_locations l on l.ambulance_id = e.ambulance_id
   where e.id = p_emergency_id
     and e.patient_id = auth.uid()
     and e.status in ('dispatched', 'in_transit', 'arrived')
   order by l.updated_at desc
   limit 1;
$function$;

REVOKE ALL ON FUNCTION public.ubicacion_movil_de_mi_emergencia(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ubicacion_movil_de_mi_emergencia(uuid) TO authenticated;

-- ── 4 · Textos visibles: la foto del traslado se llama "recepción" (no "orden") ──
-- Sólo cambia el mensaje de error de dos funciones; tablas y columnas no se renombran.

CREATE OR REPLACE FUNCTION public.sellar_orden_traslado()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if coalesce(auth.role(), '') in ('authenticated', 'anon') then
    new.subida_por := auth.uid();
    new.subida_at := now();
  end if;
  new.institucion := nullif(trim(new.institucion), '');
  -- La foto tiene que estar en la carpeta de ESA emergencia (y existir).
  if public.emergencia_de_la_carpeta(new.foto_path) is distinct from new.emergency_id then
    raise exception 'La foto no corresponde a esta emergencia.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from storage.objects o
     where o.bucket_id = 'ordenes-traslado' and o.name = new.foto_path
  ) then
    raise exception 'La foto de la recepción no se subió.' using errcode = 'check_violation';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cerrar_emergencia_con_registro()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  estado_consulta text;
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    -- Vía de escape de siempre: service_role y super admin.
    if auth.uid() is not null and public.get_my_role() is distinct from 'super_admin' then
      select status into estado_consulta from public.consultations where emergency_id = new.id;
      if estado_consulta is distinct from 'completed' and nullif(trim(new.cierre_sin_atencion), '') is null then
        raise exception using
          errcode = 'check_violation',
          message = case when estado_consulta is null
            then 'Antes de cerrar la emergencia cargá la atención, o indicá por qué se cierra sin atención.'
            else 'Antes de cerrar la emergencia cerrá la consulta.' end;
      end if;
      -- Si cierra el despacho, dice cómo terminó (migración 213, Mateo).
      if new.desenlace is null
         and public.get_my_role() in ('emergency_admin', 'emergency_operator') then
        raise exception using
          errcode = 'check_violation',
          message = 'Elegí cómo terminó: en el lugar o trasladado.';
      end if;
      -- Recepción del traslado (migración 213; el texto visible pasó de "orden" a "recepción" en la 240).
      if new.desenlace = 'traslado' and not exists (
        select 1 from public.emergency_transfer_orders o
         where o.emergency_id = new.id and o.tipo = 'orden_traslado'
      ) then
        raise exception using
          errcode = 'check_violation',
          message = 'Para cerrar un traslado subí la foto de la recepción del traslado firmada y sellada.';
      end if;
    end if;
  end if;

  -- Al terminar (cerrada o cancelada) el móvil vuelve a estar disponible.
  -- Antes se quedaba "en servicio" para siempre y no se le podía asignar otra.
  if new.status in ('completed', 'cancelled') and old.status is distinct from new.status
     and new.ambulance_id is not null then
    update public.ambulances set status = 'disponible'
    where id = new.ambulance_id and status = 'en_servicio';
  end if;

  return new;
end;
$function$;
