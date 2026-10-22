-- ============================================================
-- Migration 213 — Orden de traslado, cierre con desenlace, historial del
-- despacho y la consulta de la emergencia anclada a emergencias
-- ============================================================
-- Reunión de Mateo con Nacho (2026-10-22):
--   1. "Revisar por qué no aparece la orden de traslado. Debe incluir foto con
--      sello del profesional y de la institución receptora, con día y hora
--      (exime responsabilidad ante fallecimiento)." No existía: se arma acá.
--   2. "Que no se genere desde el front la consulta presencial porque confunde.
--      Que quede anclada a emergencias." La consulta de la atención (177) sólo
--      nace de `iniciar_atencion_emergencia`; nadie le pone ni le cambia el
--      `emergency_id` desde una sesión.
--   3. "Operador tiene que ver despachos previos en otro tab." `completed_at`
--      para la duración del historial; la lectura ya la da la RLS de 156.
--
-- Decisiones (default, ver la pregunta a Mateo en el catchup):
--   · `desenlace`: 'en_el_lugar' | 'traslado'. Lo declara quien cierra.
--   · Con 'traslado' la emergencia NO se cierra sin una orden subida (la base
--     lo exige, no sólo la pantalla). Con 'en_el_lugar' la orden es opcional.
--   · La orden es inmutable: no hay UPDATE ni DELETE para ninguna sesión, y la
--     hora y el autor los pone la base (no el teléfono).
-- ============================================================

-- ── 1. Columnas de la emergencia ───────────────────────────
ALTER TABLE public.emergencies
  ADD COLUMN IF NOT EXISTS desenlace text NULL,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz NULL;

DO $$ BEGIN
  ALTER TABLE public.emergencies
    ADD CONSTRAINT emergencies_desenlace_check CHECK (desenlace IN ('en_el_lugar', 'traslado'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.emergencies.desenlace IS
  'Cómo terminó: en_el_lugar | traslado (a una institución). Con traslado, la orden es obligatoria para cerrar.';
COMMENT ON COLUMN public.emergencies.completed_at IS
  'Hora de la base en la que la emergencia pasó a completed (la pone el trigger de cierre).';

-- ── 2. Quién carga y quién ve una orden ────────────────────
-- Carga: el médico del traslado o la tripulación del móvil, mientras está en
-- curso. Ve: ellos, el despacho de la entidad y el super admin.
CREATE OR REPLACE FUNCTION public.puede_cargar_orden_traslado(p_emergency_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.emergencies e
     WHERE e.id = p_emergency_id
       AND e.status IN ('dispatched', 'in_transit', 'arrived')
       AND (e.professional_id = auth.uid()
            OR (e.ambulance_id IS NOT NULL AND public.soy_tripulacion(e.ambulance_id)))
  );
$function$;

CREATE OR REPLACE FUNCTION public.puede_ver_orden_traslado(p_emergency_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.get_my_role() = 'super_admin' OR EXISTS (
    SELECT 1 FROM public.emergencies e
     WHERE e.id = p_emergency_id
       AND (e.professional_id = auth.uid()
            OR (e.ambulance_id IS NOT NULL AND public.soy_tripulacion(e.ambulance_id))
            OR (public.get_my_role() IN ('emergency_admin', 'emergency_operator')
                AND e.provider_id IS NOT NULL
                AND e.provider_id = public.mi_entidad_de_emergencias()))
  );
$function$;

-- Para las policies de storage: la carpeta es el id de la emergencia. Un
-- nombre que no es un uuid no habilita nada (en vez de tirar un error).
CREATE OR REPLACE FUNCTION public.emergencia_de_la_carpeta(p_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
begin
  return (storage.foldername(p_name))[1]::uuid;
exception when others then
  return null;
end;
$function$;

REVOKE ALL ON FUNCTION public.puede_cargar_orden_traslado(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.puede_ver_orden_traslado(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.puede_cargar_orden_traslado(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.puede_ver_orden_traslado(uuid) TO authenticated;

-- ── 3. La tabla de órdenes ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.emergency_transfer_orders (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- RESTRICT: borrar la emergencia no se lleva puesta la orden (ni deja la foto huérfana).
  emergency_id  uuid NOT NULL REFERENCES public.emergencies(id) ON DELETE RESTRICT,
  institucion   text NOT NULL CHECK (char_length(trim(institucion)) BETWEEN 2 AND 200),
  foto_path     text NOT NULL UNIQUE,
  subida_por    uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id),
  subida_at     timestamptz NOT NULL DEFAULT now()
);
-- Por si la tabla ya existía con otra regla de borrado.
ALTER TABLE public.emergency_transfer_orders
  DROP CONSTRAINT IF EXISTS emergency_transfer_orders_emergency_id_fkey,
  ADD CONSTRAINT emergency_transfer_orders_emergency_id_fkey
    FOREIGN KEY (emergency_id) REFERENCES public.emergencies(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS emergency_transfer_orders_emergency_idx
  ON public.emergency_transfer_orders (emergency_id, subida_at DESC);
COMMENT ON TABLE public.emergency_transfer_orders IS
  'Orden de traslado (foto con sello del médico y de la institución receptora). Inmutable: hora y autor los pone la base.';

ALTER TABLE public.emergency_transfer_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS emergency_transfer_orders_select ON public.emergency_transfer_orders;
CREATE POLICY emergency_transfer_orders_select ON public.emergency_transfer_orders
  FOR SELECT TO authenticated
  USING (public.puede_ver_orden_traslado(emergency_id));

DROP POLICY IF EXISTS emergency_transfer_orders_insert ON public.emergency_transfer_orders;
CREATE POLICY emergency_transfer_orders_insert ON public.emergency_transfer_orders
  FOR INSERT TO authenticated
  WITH CHECK (public.puede_cargar_orden_traslado(emergency_id));
-- Sin UPDATE ni DELETE: un registro que exime de responsabilidad no se toca.

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
  new.institucion := trim(new.institucion);
  -- La foto tiene que estar en la carpeta de ESA emergencia (y existir).
  if public.emergencia_de_la_carpeta(new.foto_path) is distinct from new.emergency_id then
    raise exception 'La foto no corresponde a esta emergencia.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from storage.objects o
     where o.bucket_id = 'ordenes-traslado' and o.name = new.foto_path
  ) then
    raise exception 'La foto de la orden no se subió.' using errcode = 'check_violation';
  end if;
  return new;
end;
$function$;

DROP TRIGGER IF EXISTS emergency_transfer_orders_sellar ON public.emergency_transfer_orders;
CREATE TRIGGER emergency_transfer_orders_sellar BEFORE INSERT ON public.emergency_transfer_orders
  FOR EACH ROW EXECUTE FUNCTION public.sellar_orden_traslado();

GRANT SELECT, INSERT ON public.emergency_transfer_orders TO authenticated;

-- ── 4. El bucket (privado) ─────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('ordenes-traslado', 'ordenes-traslado', false, 10485760,
        ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "ordenes_traslado_subir" ON storage.objects;
CREATE POLICY "ordenes_traslado_subir" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'ordenes-traslado'
    AND public.puede_cargar_orden_traslado(public.emergencia_de_la_carpeta(name))
  );

DROP POLICY IF EXISTS "ordenes_traslado_ver" ON storage.objects;
CREATE POLICY "ordenes_traslado_ver" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'ordenes-traslado'
    AND public.puede_ver_orden_traslado(public.emergencia_de_la_carpeta(name))
  );
-- Sin UPDATE ni DELETE (cada foto usa un nombre nuevo, sin upsert).

-- ── 5. Desenlace y hora de cierre: sólo quien atiende ──────
CREATE OR REPLACE FUNCTION public.proteger_desenlace_emergencia()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if coalesce(auth.role(), '') not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.desenlace is not null or new.completed_at is not null then
      raise exception 'Un pedido nuevo no puede venir cerrado.' using errcode = '42501';
    end if;
    return new;
  end if;

  -- La hora de cierre la pone el trigger de cierre: ninguna sesión la escribe.
  new.completed_at := old.completed_at;

  if new.desenlace is distinct from old.desenlace then
    if old.status not in ('dispatched', 'in_transit', 'arrived') then
      raise exception 'El desenlace se declara mientras la emergencia está en curso.' using errcode = '42501';
    end if;
    if not (public.get_my_role() in ('super_admin', 'emergency_admin', 'emergency_operator')
            or old.professional_id is not distinct from auth.uid()
            or (old.ambulance_id is not null and public.soy_tripulacion(old.ambulance_id))) then
      raise exception 'No autorizado para declarar cómo terminó la emergencia.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$function$;

DROP TRIGGER IF EXISTS emergencies_proteger_desenlace ON public.emergencies;
CREATE TRIGGER emergencies_proteger_desenlace BEFORE INSERT OR UPDATE ON public.emergencies
  FOR EACH ROW EXECUTE FUNCTION public.proteger_desenlace_emergencia();

-- ── 6. El cierre: con traslado, sin orden no se cierra ─────
-- Se mantiene todo lo de 177 y se suma la orden si el desenlace es traslado.
-- `completed_at` lo pone `sellar_cierre_emergencia`, más abajo.
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
      -- Orden de traslado (migración 213).
      if new.desenlace = 'traslado' and not exists (
        select 1 from public.emergency_transfer_orders o where o.emergency_id = new.id
      ) then
        raise exception using
          errcode = 'check_violation',
          message = 'Para cerrar un traslado subí la foto de la orden de traslado firmada y sellada.';
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

-- La hora de cierre va en un trigger aparte que corre ÚLTIMO (la "z" lo pone
-- al final del orden alfabético): así ningún otro BEFORE la pisa.
CREATE OR REPLACE FUNCTION public.sellar_cierre_emergencia()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    new.completed_at := now();
  end if;
  return new;
end;
$function$;

DROP TRIGGER IF EXISTS emergencies_zz_sellar_cierre ON public.emergencies;
CREATE TRIGGER emergencies_zz_sellar_cierre BEFORE UPDATE ON public.emergencies
  FOR EACH ROW EXECUTE FUNCTION public.sellar_cierre_emergencia();

-- ── 7. La consulta de la emergencia nace sólo del módulo ───
-- `iniciar_atencion_emergencia` (SECURITY DEFINER) marca la transacción; sin
-- esa marca, ninguna sesión pone ni cambia `emergency_id` (ni el paciente ni
-- el profesional, que por `consultations_access` pueden escribir sus filas).
CREATE OR REPLACE FUNCTION public.iniciar_atencion_emergencia(p_emergency_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  e public.emergencies%rowtype;
  cid uuid;
begin
  select * into e from public.emergencies where id = p_emergency_id for update;
  if not found then
    raise exception 'No existe la emergencia' using errcode = 'P0002';
  end if;
  if e.professional_id is distinct from auth.uid() then
    raise exception 'Sólo el médico del móvil puede cargar la atención' using errcode = '42501';
  end if;
  if e.status not in ('dispatched', 'in_transit', 'arrived') then
    raise exception 'La emergencia no está en curso (%).', e.status using errcode = 'check_violation';
  end if;

  select id into cid from public.consultations where emergency_id = e.id;
  if cid is not null then
    return cid;
  end if;

  perform set_config('healthier.atencion_emergencia', 'on', true);
  insert into public.consultations (
    patient_id, professional_id, status, modality, payment_status, price_at_booking,
    scheduled_at, started_at, emergency_id
  ) values (
    e.patient_id, e.professional_id, 'in_progress', 'presencial', 'exempt', 0,
    now(), now(), e.id
  ) returning id into cid;
  perform set_config('healthier.atencion_emergencia', 'off', true);

  return cid;
end;
$function$;

REVOKE ALL ON FUNCTION public.iniciar_atencion_emergencia(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.iniciar_atencion_emergencia(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.consulta_de_emergencia_solo_del_modulo()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if coalesce(auth.role(), '') not in ('authenticated', 'anon') then
    return new;
  end if;
  if coalesce(current_setting('healthier.atencion_emergencia', true), '') = 'on' then
    return new;
  end if;
  if (tg_op = 'INSERT' and new.emergency_id is not null)
     or (tg_op = 'UPDATE' and new.emergency_id is distinct from old.emergency_id) then
    -- Única excepción: el super admin borra una emergencia y el
    -- ON DELETE SET NULL de `consultations.emergency_id` (177) corre como su
    -- sesión. Sólo desanclar; anclar o mover sigue cerrado para todos.
    if tg_op = 'UPDATE' and new.emergency_id is null
       and public.get_my_role() = 'super_admin' then
      return new;
    end if;
    raise exception 'La atención de una emergencia se abre desde la emergencia.'
      using errcode = '42501';
  end if;
  return new;
end;
$function$;

DROP TRIGGER IF EXISTS consultations_emergencia_solo_del_modulo ON public.consultations;
CREATE TRIGGER consultations_emergencia_solo_del_modulo BEFORE INSERT OR UPDATE ON public.consultations
  FOR EACH ROW EXECUTE FUNCTION public.consulta_de_emergencia_solo_del_modulo();

-- ── 8. El nombre del paciente para el historial ────────────
-- El despacho lee la ficha del paciente sólo mientras el pedido está activo
-- (`despacho_lee_paciente_de_emergencia`): es la ficha entera (teléfono, DNI,
-- datos de salud) y no tiene por qué seguir abierta. Para el historial alcanza
-- con el nombre, así que se guarda una copia en la emergencia. Se copia recién
-- cuando el pedido queda asignado a una entidad: un pedido sin entidad lo ven
-- los despachos de todas (156) y no tiene por qué llevar el nombre.
ALTER TABLE public.emergencies
  ADD COLUMN IF NOT EXISTS paciente_nombre text NULL;
COMMENT ON COLUMN public.emergencies.paciente_nombre IS
  'Copia del nombre del paciente al asignarse a una entidad (historial del despacho). No se actualiza si cambia el perfil.';

CREATE OR REPLACE FUNCTION public.copiar_nombre_paciente_emergencia()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.provider_id is null then
    new.paciente_nombre := null;
  elsif tg_op = 'INSERT' or old.provider_id is null or new.patient_id is distinct from old.patient_id then
    select full_name into new.paciente_nombre from public.profiles where id = new.patient_id;
  elsif coalesce(auth.role(), '') in ('authenticated', 'anon') then
    new.paciente_nombre := old.paciente_nombre;  -- ninguna sesión la pisa
  end if;
  return new;
end;
$function$;

DROP TRIGGER IF EXISTS emergencies_copiar_nombre_paciente ON public.emergencies;
CREATE TRIGGER emergencies_copiar_nombre_paciente BEFORE INSERT OR UPDATE ON public.emergencies
  FOR EACH ROW EXECUTE FUNCTION public.copiar_nombre_paciente_emergencia();

-- ── 9. Datos de las que ya existen (pocas filas), una sola vez ──
-- Sin tocar `updated_at`: el trigger de `set_updated_at` se apaga mientras
-- tanto (si no, todas quedaban "actualizadas" ahora y el historial mostraba
-- duraciones de semanas). La hora de cierre de las viejas es su último cambio.
ALTER TABLE public.emergencies DISABLE TRIGGER emergencies_updated_at;
UPDATE public.emergencies SET completed_at = updated_at
 WHERE status = 'completed' AND completed_at IS NULL;
UPDATE public.emergencies e SET paciente_nombre = p.full_name
  FROM public.profiles p
 WHERE p.id = e.patient_id AND e.provider_id IS NOT NULL
   AND e.paciente_nombre IS DISTINCT FROM p.full_name;
UPDATE public.emergencies SET paciente_nombre = NULL
 WHERE provider_id IS NULL AND paciente_nombre IS NOT NULL;
ALTER TABLE public.emergencies ENABLE TRIGGER emergencies_updated_at;
