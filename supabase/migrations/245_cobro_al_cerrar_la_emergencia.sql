-- ============================================================
-- Migración 245 — El cobro de la emergencia no depende de quién la cierra
-- ============================================================
-- Hallazgo (revisión previa al pase a prod, 2026-11-20): sólo el despacho
-- (Cola → "Terminar") cobra la reserva de Mercado Pago ANTES de cerrar. Si
-- cierran el operador (web o app), el médico de /profesional/emergencias o la
-- app de la tripulación, la emergencia pasa a `completed`, sale de la Cola y
-- NADIE captura la reserva: queda "authorized" hasta que la tarjeta la suelta
-- (≈7 días) y la plata no entra. El barrido `mp-capture sweep` sólo miraba
-- consultas, así que tampoco la veía.
--
-- Arreglo del lado del servidor (no depende del front):
--   1. Al pasar a `completed`, si hay una reserva autorizada, un trigger llama
--      a `mp-capture` (acción interna `cobrar-emergencia-terminada`), que
--      captura con el MISMO token con el que se creó la reserva (prestador o
--      plataforma). Idempotente: si el despacho ya la cobró, no hace nada.
--   2. El barrido de `mp-capture` ahora también mira las emergencias
--      terminadas con la reserva sin resolver (reintenta si el trigger falló) y
--      libera las canceladas sin cobro. En staging faltaba el cron del barrido.
--   3. Sin plata para cobrar (S.O.S. bonificado o nunca preautorizada), al
--      cerrar queda asentado solo el "cierre sin pago" (quién y cuándo, con un
--      mensaje automático si nadie lo escribió): lo que antes sólo hacía el
--      front que pedía el mensaje.
--   4. El diagnóstico del cierre del operador tenía por único lugar
--      `cierre_sin_atencion` ("cerrada SIN atención"): una emergencia atendida
--      aparecía como no atendida en la HC del paciente y en el historial del
--      despacho. Tiene su columna: `diagnostico_cierre`.
-- ============================================================

-- ── 1 · Diagnóstico del cierre (operador) ──────────────────────────────────
ALTER TABLE public.emergencies
  ADD COLUMN IF NOT EXISTS diagnostico_cierre text,
  ADD COLUMN IF NOT EXISTS nota_cierre text;
COMMENT ON COLUMN public.emergencies.nota_cierre IS
  'Nota para el despacho que deja quien cierra (el operador). Nunca hace de motivo de cierre sin atención.';
COMMENT ON COLUMN public.emergencies.diagnostico_cierre IS
  'Diagnóstico cargado al cerrar por quien atendió sin consulta clínica (el operador). Cuenta como atención registrada; cierre_sin_atencion queda sólo para los cierres SIN atención.';

-- El cierre exige la atención cerrada, un motivo de cierre sin atención o, ahora,
-- el diagnóstico del operador. (Mismo cuerpo que la 240 + la rama del diagnóstico.)
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
      if estado_consulta is distinct from 'completed'
         and nullif(trim(new.cierre_sin_atencion), '') is null
         and nullif(trim(new.diagnostico_cierre), '') is null then
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
  if new.status in ('completed', 'cancelled') and old.status is distinct from new.status
     and new.ambulance_id is not null then
    update public.ambulances set status = 'disponible'
    where id = new.ambulance_id and status = 'en_servicio';
  end if;

  return new;
end;
$function$;

-- ── 2 · Sin plata para cobrar: el cierre sin pago queda asentado ───────────
-- BEFORE, y con nombre que corre después de `emergencies_proteger_cobro`: ese
-- trigger frena que una sesión de usuario escriba las marcas de cobro, pero
-- esto las escribe el servidor y no lo re-chequea.
CREATE OR REPLACE FUNCTION public.asentar_cierre_sin_pago()
 RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed'
     AND NEW.cierre_sin_pago_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.payments p
                      WHERE p.emergency_id = NEW.id AND p.status IN ('authorized', 'approved')) THEN
    NEW.cierre_sin_pago := coalesce(
      nullif(btrim(NEW.cierre_sin_pago), ''),
      CASE WHEN NEW.bonificada
           THEN 'Cerrada sin cobro: S.O.S. bonificado (registrado automáticamente al cerrar).'
           ELSE 'Cerrada sin cobro: no había reserva de pago (registrado automáticamente al cerrar).' END);
    NEW.cierre_sin_pago_por := coalesce(NEW.cierre_sin_pago_por, auth.uid());
    NEW.cierre_sin_pago_at := now();
  END IF;
  RETURN NEW;
end;
$function$;
DROP TRIGGER IF EXISTS emergencies_zzz_cierre_sin_pago ON public.emergencies;
CREATE TRIGGER emergencies_zzz_cierre_sin_pago
  BEFORE UPDATE OF status ON public.emergencies
  FOR EACH ROW EXECUTE FUNCTION public.asentar_cierre_sin_pago();

-- ── 3 · Con reserva autorizada: la captura sale del servidor ───────────────
CREATE OR REPLACE FUNCTION public.cobrar_emergencia_al_cerrar()
 RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  IF EXISTS (SELECT 1 FROM public.payments p WHERE p.emergency_id = NEW.id AND p.status = 'authorized') THEN
    PERFORM public.llamar_edge_function('mp-capture',
      jsonb_build_object('action', 'cobrar-emergencia-terminada', 'emergencyId', NEW.id));
  END IF;
  RETURN NEW;
end;
$function$;
DROP TRIGGER IF EXISTS emergencies_cobrar_al_cerrar ON public.emergencies;
CREATE TRIGGER emergencies_cobrar_al_cerrar
  AFTER UPDATE OF status ON public.emergencies
  FOR EACH ROW
  WHEN (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed')
  EXECUTE FUNCTION public.cobrar_emergencia_al_cerrar();

-- ── 4 · El barrido de mp-capture (en staging no estaba programado) ─────────
-- Producción ya lo tiene (`mp-capture-sweep-5min`, con net.http_post): no se
-- duplica. Si no hay ningún job que llame a mp-capture, se crea.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE command ILIKE '%mp-capture%') THEN
    PERFORM cron.schedule('mp-capture-barrido', '*/5 * * * *',
      $cron$ select public.llamar_edge_function('mp-capture', '{"action":"sweep"}'::jsonb) $cron$);
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.asentar_cierre_sin_pago() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.cobrar_emergencia_al_cerrar() FROM public, anon, authenticated;
