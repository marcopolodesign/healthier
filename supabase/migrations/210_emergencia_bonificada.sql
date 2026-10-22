-- ============================================================
-- Migration 210 — S.O.S. bonificado y cierre sin pago
-- ============================================================
-- Mateo, 2026-10-22:
--   · "Necesito que se bonifique a mi cuenta lo de emergencias también": mismo
--     interruptor "Bonificar" que Teleclínica. Lo decide `mp-payment` con
--     `emergenciaBonificadaEnServidor` (_shared/bonificar.ts); la emergencia
--     queda paga (`paid_at`) sin Mercado Pago y marcada `bonificada`.
--   · "Si no tiene pago porque está bonificada, la emergencia también tiene
--     que poder cerrarse: que aparezca un cartel, se deja un mensaje y listo."
--     Vale para cualquier emergencia sin pago autorizado. Quién la cerró así y
--     el mensaje quedan acá, a la vista del super admin. Lo escribe sólo
--     `mp-capture` (action `cerrar-sin-pago`), que antes verifica que no haya
--     una reserva para cobrar.
--
-- No se usa una fila de `payments` con un estado nuevo: una emergencia
-- bonificada no tiene cobro, y una fila en `payments` sumaría en los reportes
-- de plata algo que nunca entró. Mismo criterio que `consultations.payment_status
-- = 'exempt'`.
-- ============================================================

ALTER TABLE public.emergencies
  ADD COLUMN IF NOT EXISTS bonificada          boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cierre_sin_pago     text        NULL,
  ADD COLUMN IF NOT EXISTS cierre_sin_pago_por uuid        NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cierre_sin_pago_at  timestamptz NULL;

COMMENT ON COLUMN public.emergencies.bonificada IS
  'true = el S.O.S. se bonificó (interruptor de la allowlist, decidido en mp-payment). No hay cobro ni reserva en Mercado Pago.';
COMMENT ON COLUMN public.emergencies.cierre_sin_pago IS
  'Mensaje que dejó quien la cerró sin pago para cobrar (bonificada o sin reserva). NULL = no se cerró por esa vía.';
COMMENT ON COLUMN public.emergencies.cierre_sin_pago_por IS 'Quién la cerró sin pago.';
COMMENT ON COLUMN public.emergencies.cierre_sin_pago_at  IS 'Cuándo se registró el cierre sin pago.';

-- ── Las marcas de cobro sólo las escribe el servidor ─────────
-- Hasta acá `paid_at` y `preauth_id` se podían escribir desde el cliente:
-- `emergency_patient_insert` sólo exige `patient_id = auth.uid()`, así que un
-- paciente podía crear la emergencia ya "pagada" y entrar a la cola sin
-- reservar nada. Con `bonificada` y el cierre sin pago eso sería además un
-- S.O.S. gratis que se cierra sin error. Se cierra igual que el estado de pago
-- de consultas y pedidos (migraciones 136/137): con sesión de usuario no se
-- tocan; las Edge Functions (service_role), el super admin y las conexiones
-- directas (migraciones, SQL) sí.
CREATE OR REPLACE FUNCTION public.proteger_cobro_emergencia()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if coalesce(auth.role(), '') not in ('authenticated', 'anon') then
    return new;
  end if;
  if public.get_my_role() = 'super_admin' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.paid_at is not null or new.preauth_id is not null or new.bonificada
       or new.cierre_sin_pago is not null or new.cierre_sin_pago_por is not null
       or new.cierre_sin_pago_at is not null then
      raise exception 'No autorizado para marcar el cobro de esta emergencia.'
        using errcode = '42501';
    end if;
  elsif new.paid_at is distinct from old.paid_at
     or new.preauth_id is distinct from old.preauth_id
     or new.bonificada is distinct from old.bonificada
     or new.cierre_sin_pago is distinct from old.cierre_sin_pago
     or new.cierre_sin_pago_por is distinct from old.cierre_sin_pago_por
     or new.cierre_sin_pago_at is distinct from old.cierre_sin_pago_at then
    raise exception 'No autorizado para modificar el cobro de esta emergencia.'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

DROP TRIGGER IF EXISTS emergencies_proteger_cobro ON public.emergencies;
CREATE TRIGGER emergencies_proteger_cobro BEFORE INSERT OR UPDATE ON public.emergencies
  FOR EACH ROW EXECUTE FUNCTION public.proteger_cobro_emergencia();
