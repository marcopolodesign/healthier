-- La exención de pago no llegaba a la farmacia.
--
-- `profiles.payment_exempt` (migración 135) existe para que ciertas cuentas
-- puedan recorrer la plataforma sin cobrar nada. Las consultas la respetan
-- —`OnDemand.jsx` y `PaymentPage.jsx` crean la consulta con
-- `payment_status: 'exempt'` y ni tocan Mercado Pago—, pero la farmacia no:
-- su pantalla de pago pedía tarjeta siempre. Encontrado el 2026-09-17, con la
-- cuenta que se armó justamente para que un tercero probara sin tarjeta.
--
-- Se agrega 'exento' como tercer estado de pago, en vez de escribir 'pagado':
-- un pedido bonificado NO se cobró, y que la farmacia lo vea como cobrado
-- sería mentirle a quien después concilia la plata. Mismo criterio que
-- `exempt` en consultations.

ALTER TABLE public.medication_orders
  DROP CONSTRAINT IF EXISTS medication_orders_payment_status_check;

ALTER TABLE public.medication_orders
  ADD CONSTRAINT medication_orders_payment_status_check
  CHECK (payment_status IN ('no_pagado', 'pagado', 'exento'));

COMMENT ON COLUMN public.medication_orders.payment_status IS
  'no_pagado = todavía es un carrito · pagado = cobrado por Mercado Pago · '
  'exento = bonificado, sólo para cuentas con profiles.payment_exempt';

-- El trigger de la 137 impide que el paciente se marque su propio pedido como
-- pagado (si no, un PATCH a PostgREST se llevaba los medicamentos gratis). Esa
-- defensa se mantiene intacta: lo único que se agrega es que una cuenta
-- marcada como exenta pueda dejarlo en 'exento' — nunca en 'pagado'.
CREATE OR REPLACE FUNCTION public.proteger_payment_status_pedidos_medicamentos()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
begin
  if auth.role() = 'service_role' or public.get_my_role() in ('admin', 'super_admin') then
    return new;
  end if;

  -- Bonificado: sólo el propio paciente, sólo si su perfil está exento, y sólo
  -- hacia 'exento'. Nunca abre el camino a 'pagado'.
  if new.payment_status = 'exento'
     and new.patient_id = auth.uid()
     and exists (
       select 1 from public.profiles
        where id = auth.uid() and payment_exempt = true
     ) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.payment_status = 'no_pagado' then
      return new;
    end if;
  elsif new.payment_status is not distinct from old.payment_status then
    return new;
  end if;

  raise exception 'No autorizado para modificar el estado de pago de este pedido.'
    using errcode = '42501';
end;
$$;
