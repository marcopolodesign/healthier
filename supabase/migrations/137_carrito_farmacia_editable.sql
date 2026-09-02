-- ============================================================
-- 137 — El paciente puede editar su carrito de farmacia antes de pagar
-- ============================================================
-- Hoy no puede: `medication_order_items` (migración 106) tiene policies de
-- SELECT e INSERT para el paciente y NINGUNA de UPDATE ni DELETE. O sea que
-- una vez que el carrito se convierte en borrador al entrar al checkout, sacar
-- un medicamento es literalmente imposible — y un DELETE sin policy no da
-- error, devuelve 0 filas, así que un botón de "eliminar" en el front habría
-- fallado en silencio. Encontrado el 2026-09-02: el paciente no tenía cómo
-- sacar un producto de su pedido ni en website ni en la app.
--
-- Se resuelve con una función en vez de con policies sueltas porque cambiar un
-- item obliga a recalcular `subtotal`/`total` del pedido en la misma
-- operación: dos escrituras del cliente que pueden quedar a mitad de camino
-- (ítem borrado, total viejo) se vuelven una sola, atómica y del lado del
-- servidor.
--
-- Nota: el importe que se cobra NO sale de estas columnas — `mp-payment`
-- vuelve a valorizar el pedido contra el catálogo vivo antes de crear la
-- preferencia. `subtotal`/`total` son lo que el paciente ve.
-- ============================================================

create or replace function public.actualizar_item_pedido_medicamentos(
  p_item_id  uuid,
  p_quantity integer default 0   -- 0 (o menos) = sacar el medicamento del pedido
)
returns uuid                     -- id del pedido, o NULL si quedó vacío y se borró
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_order_id   uuid;
  v_restantes  integer;
begin
  -- La pertenencia y el "todavía no se pagó" se chequean acá, no en una
  -- policy, porque la función es SECURITY DEFINER.
  select mo.id into v_order_id
    from public.medication_order_items it
    join public.medication_orders mo on mo.id = it.order_id
   where it.id = p_item_id
     and mo.patient_id = auth.uid()
     and mo.payment_status = 'no_pagado'
     and mo.status = 'pendiente';

  if v_order_id is null then
    raise exception 'No se puede modificar este pedido.' using errcode = '42501';
  end if;

  if p_quantity <= 0 then
    delete from public.medication_order_items where id = p_item_id;
  else
    update public.medication_order_items set quantity = p_quantity where id = p_item_id;
  end if;

  select count(*) into v_restantes
    from public.medication_order_items where order_id = v_order_id;

  -- Un borrador sin medicamentos no es un pedido. Si se borra el último, se
  -- borra el pedido entero: si quedara vivo, `getPendingDraft` lo seguiría
  -- ofreciendo para siempre como "tenés un pedido sin completar" y llevaría a
  -- un checkout vacío.
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

comment on function public.actualizar_item_pedido_medicamentos(uuid, integer) is
  'Cambia la cantidad de un medicamento del carrito, o lo saca (cantidad 0), y recalcula subtotal/total en la misma transacción. Sólo sobre pedidos propios todavía sin pagar. Devuelve el id del pedido, o NULL si se sacó el último medicamento y el borrador se eliminó.';

revoke all on function public.actualizar_item_pedido_medicamentos(uuid, integer) from public;
grant execute on function public.actualizar_item_pedido_medicamentos(uuid, integer) to authenticated;

-- ── Cerrar de paso: el paciente podía darse por pagado su propio pedido ─────
-- `medication_orders_patient_update_own_unpaid` (106) deja al paciente editar
-- cualquier columna de un pedido no pagado, y su WITH CHECK no menciona
-- `payment_status` — o sea que un PATCH directo a PostgREST con
-- `payment_status: 'pagado'` se llevaba los medicamentos sin pasar por Mercado
-- Pago. Mismo patrón que la 136 sobre consultations: la policy amplia sigue
-- siendo la única forma de que el paciente edite su dirección de entrega, y un
-- trigger angosta sólo esta columna.
--
-- Quién escribe 'pagado' de verdad: `mp-webhook`, con la service key.
create or replace function public.proteger_payment_status_pedidos_medicamentos()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.role() = 'service_role' or public.get_my_role() in ('admin', 'super_admin') then
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

drop trigger if exists medication_orders_payment_status_insert on public.medication_orders;
create trigger medication_orders_payment_status_insert
  before insert on public.medication_orders
  for each row
  execute function public.proteger_payment_status_pedidos_medicamentos();

drop trigger if exists medication_orders_payment_status_update on public.medication_orders;
create trigger medication_orders_payment_status_update
  before update on public.medication_orders
  for each row
  execute function public.proteger_payment_status_pedidos_medicamentos();
