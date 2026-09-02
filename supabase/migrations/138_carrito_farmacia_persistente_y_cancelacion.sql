-- ============================================================
-- 138 — El carrito de farmacia vive en la base, y la farmacia puede cancelar
-- ============================================================
-- Dos cosas que faltaban para cerrar el circuito de farmacia (pedido de Mateo,
-- 2026-09-02):
--
-- 1. El carrito era `useState` en el catálogo, tanto en el website como en la
--    app. Se perdía al salir de Farmacia, no cruzaba de dispositivo, y el
--    borrador real (`medication_orders` en `no_pagado`) recién nacía al entrar
--    al checkout. O sea: el paciente que agregaba tres cosas y se iba a mirar
--    otra pantalla volvía con el carrito vacío y sin ningún rastro.
--
--    `agregar_item_pedido_medicamentos` hace que agregar al carrito sea ya la
--    escritura del borrador: crea el pedido si no existe, suma o resta el
--    medicamento y recalcula el total, todo en una transacción. Es la
--    contraparte de `actualizar_item_pedido_medicamentos` (137): aquella se
--    direcciona por item, ésta por producto del catálogo, que es como piensa
--    un carrito.
--
--    🔴 El precio, el nombre y la presentación NO vienen del cliente: se leen
--    del catálogo acá adentro. Antes el front armaba los items con el precio
--    que tenía en pantalla, así que un PATCH hecho a mano podía inventarse el
--    importe. (`mp-payment` igual revalúa contra el catálogo antes de cobrar —
--    esto cierra también lo que el paciente *ve*.)
--
-- 2. El panel de la farmacia sólo sabía avanzar de a un estado
--    (pendiente → en preparación → enviado → entregado). No había forma de
--    cancelar un pedido, y `cancelado` existe en el CHECK desde la 106.
--    Se agrega el motivo, porque un pedido que aparece cancelado en el
--    seguimiento del paciente sin decir por qué es peor que no mostrarlo.
-- ============================================================

-- ── 1. Motivo de cancelación ──────────────────────────────────────────────
alter table public.medication_orders
  add column if not exists cancellation_reason text;

comment on column public.medication_orders.cancellation_reason is
  'Motivo que escribe la farmacia al cancelar. Lo ve el paciente en el seguimiento del pedido.';

-- ── 2. Agregar/quitar del carrito ─────────────────────────────────────────
create or replace function public.agregar_item_pedido_medicamentos(
  p_product_id uuid,
  p_delta      integer default 1   -- negativo resta; si llega a 0 saca el medicamento
)
returns uuid                       -- id del pedido, o NULL si quedó vacío y se borró
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_patient_id uuid := auth.uid();
  v_product    public.pharmacy_products%rowtype;
  v_order_id   uuid;
  v_item_id    uuid;
  v_qty        integer;
  v_restantes  integer;
begin
  if v_patient_id is null then
    raise exception 'Sesión no válida.' using errcode = '42501';
  end if;

  -- La función es SECURITY DEFINER, así que el bloqueo de "primero atendete"
  -- (migración 129/130, que vive en la policy de INSERT) hay que repetirlo acá
  -- a mano: si no, esta función sería justamente la forma de saltearlo.
  if not public.patient_has_completed_consultation() then
    raise exception 'Para comprar en la farmacia primero tenés que atenderte con un profesional.'
      using errcode = '42501';
  end if;

  select * into v_product from public.pharmacy_products where id = p_product_id;
  if not found then
    raise exception 'El producto ya no está en el catálogo.' using errcode = 'P0002';
  end if;

  -- Borrador abierto del paciente. Si hay más de uno (no debería), se usa el
  -- último, que es el mismo criterio que `getPendingDraft` en el front.
  select mo.id into v_order_id
    from public.medication_orders mo
   where mo.patient_id = v_patient_id
     and mo.payment_status = 'no_pagado'
     and mo.status = 'pendiente'
   order by mo.created_at desc
   limit 1;

  if v_order_id is null then
    -- Restar sobre un carrito que no existe no crea uno vacío.
    if p_delta <= 0 then
      return null;
    end if;
    insert into public.medication_orders (patient_id, pharmacy_id, delivery_address, subtotal, total)
    select v_patient_id,
           coalesce(v_product.pharmacy_id, '10000000-0000-0000-0000-000000000001'::uuid),
           pr.address,
           0, 0
      from public.profiles pr
     where pr.id = v_patient_id
    returning id into v_order_id;
  end if;

  select it.id, it.quantity into v_item_id, v_qty
    from public.medication_order_items it
   where it.order_id = v_order_id
     and it.pharmacy_product_id = p_product_id
   limit 1;

  v_qty := coalesce(v_qty, 0) + p_delta;

  if v_qty <= 0 then
    if v_item_id is not null then
      delete from public.medication_order_items where id = v_item_id;
    end if;
  elsif v_item_id is null then
    insert into public.medication_order_items (
      order_id, pharmacy_product_id, medication_name, presentation,
      quantity, unit_price, requires_prescription
    ) values (
      v_order_id, p_product_id, v_product.name, v_product.presentation,
      -- `pharmacy_products.requires_prescription` ya no existe: la 130 la
      -- borró a propósito cuando `prescription_type` la reemplazó (la 104 la
      -- había declarado y la 129 todavía la daba por sentada). La fuente de
      -- verdad es `prescription_type`, y de ahí se deriva.
      v_qty, v_product.price, v_product.prescription_type is distinct from 'venta_libre'
    );
  else
    -- El precio se refresca al tocar la cantidad: si el catálogo cambió entre
    -- que armó el carrito y que vuelve, el total que ve es el que se le va a
    -- cobrar, no el de la semana pasada.
    update public.medication_order_items
       set quantity = v_qty,
           unit_price = v_product.price
     where id = v_item_id;
  end if;

  select count(*) into v_restantes
    from public.medication_order_items where order_id = v_order_id;

  -- Mismo criterio que la 137: un borrador sin medicamentos no es un pedido.
  if v_restantes = 0 then
    delete from public.medication_orders where id = v_order_id;
    return null;
  end if;

  update public.medication_orders mo
     set subtotal = s.importe,
         total    = s.importe
    from (
      select coalesce(sum(unit_price * quantity), 0) as importe
        from public.medication_order_items
       where order_id = v_order_id
    ) s
   where mo.id = v_order_id;

  return v_order_id;
end;
$$;

comment on function public.agregar_item_pedido_medicamentos(uuid, integer) is
  'Suma o resta un producto del catálogo en el carrito del paciente (el borrador de medication_orders), creándolo si no existe, y recalcula subtotal/total en la misma transacción. Nombre, presentación y precio se leen del catálogo, nunca del cliente. Devuelve el id del pedido, o NULL si quedó vacío y se borró.';

revoke all on function public.agregar_item_pedido_medicamentos(uuid, integer) from public;
grant execute on function public.agregar_item_pedido_medicamentos(uuid, integer) to authenticated;
