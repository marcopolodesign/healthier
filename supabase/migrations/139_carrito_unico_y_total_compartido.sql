-- ============================================================
-- 139 — Un solo carrito abierto por paciente, y un solo lugar donde se
--       calcula el total
-- ============================================================
-- Dos cosas que salieron de revisar la 138:
--
-- 1. **Nada impedía que un paciente tuviera dos carritos.**
--    `agregar_item_pedido_medicamentos` busca el borrador abierto con un
--    SELECT y, si no hay, inserta uno. Entre esas dos operaciones no había
--    lock ni constraint. La cola de promesas del front (`PharmacyCartContext`)
--    serializa los toques **de una pestaña**, no del paciente: y el carrito
--    persistente se construyó justamente para que cruce de dispositivo, así
--    que el caso es el que la feature invita a hacer — agregar algo desde el
--    teléfono y desde la computadora casi a la vez deja dos
--    `medication_orders` en `no_pagado`, cada uno con parte de la compra.
--    `getPendingDraft` devuelve el más nuevo, así que el otro queda invisible
--    para el paciente: paga uno y el resto de los medicamentos desaparece sin
--    que nadie se entere.
--
--    Se cierra con un índice único parcial. La función pasa a reintentar
--    cuando pierde la carrera, en vez de insertar un segundo borrador.
--
-- 2. **El recálculo de subtotal/total estaba copiado en las dos funciones**
--    (137 y 138), carácter por carácter, junto con la regla de "si quedó sin
--    medicamentos, el pedido se borra". La próxima regla sobre el total
--    (descuento, envío) habría que escribirla dos veces, y el día que se
--    actualice una sola, el mismo pedido vale distinto según qué botón tocó
--    el paciente.
-- ============================================================

-- ── 1. Un solo lugar donde se calcula el total ─────────────────────────────
create or replace function public.recalcular_total_pedido_medicamentos(p_order_id uuid)
returns uuid                  -- el id del pedido, o NULL si quedó vacío y se borró
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_restantes integer;
begin
  select count(*) into v_restantes
    from public.medication_order_items where order_id = p_order_id;

  -- Un borrador sin medicamentos no es un pedido. Si queda vacío se borra: si
  -- sobreviviera, `getPendingDraft` lo seguiría ofreciendo para siempre como
  -- "tenés un pedido sin completar" y llevaría a un checkout vacío.
  if v_restantes = 0 then
    delete from public.medication_orders where id = p_order_id;
    return null;
  end if;

  update public.medication_orders mo
     set subtotal = s.importe,
         total    = s.importe
    from (
      select coalesce(sum(unit_price * quantity), 0) as importe
        from public.medication_order_items
       where order_id = p_order_id
    ) s
   where mo.id = p_order_id;

  return p_order_id;
end;
$$;

comment on function public.recalcular_total_pedido_medicamentos(uuid) is
  'Recalcula subtotal/total de un pedido de medicamentos a partir de sus items, y lo borra si quedó sin ninguno. Único lugar donde se decide cuánto vale un pedido — la llaman actualizar_item_pedido_medicamentos (137) y agregar_item_pedido_medicamentos (138).';

revoke all on function public.recalcular_total_pedido_medicamentos(uuid) from public;

-- ── 2. Un solo carrito abierto por paciente ───────────────────────────────
-- Antes del índice hay que dejar uno solo. Los que se borran son borradores
-- sin pagar que el front YA no mostraba: `getPendingDraft` devuelve sólo el
-- más nuevo, así que ninguno de estos era alcanzable desde la app.
with sobrantes as (
  select id,
         row_number() over (partition by patient_id order by created_at desc) as puesto
    from public.medication_orders
   where payment_status = 'no_pagado' and status = 'pendiente'
)
delete from public.medication_orders
 where id in (select id from sobrantes where puesto > 1);

create unique index if not exists medication_orders_un_carrito_por_paciente
  on public.medication_orders (patient_id)
  where payment_status = 'no_pagado' and status = 'pendiente';

comment on index public.medication_orders_un_carrito_por_paciente is
  'El carrito de farmacia es único por paciente: sin esto, agregar desde dos dispositivos a la vez parte la compra en dos pedidos y el paciente sólo ve (y paga) uno.';

-- ── 3. Las dos funciones, apoyadas en el recálculo compartido ──────────────
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
  v_order_id uuid;
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

  return public.recalcular_total_pedido_medicamentos(v_order_id);
end;
$$;

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

  -- Buscar el carrito o crearlo. El índice único garantiza que hay a lo sumo
  -- uno; si otra sesión lo crea entre el select y el insert, el insert falla y
  -- se vuelve a buscar en vez de partir la compra en dos pedidos.
  loop
    select mo.id into v_order_id
      from public.medication_orders mo
     where mo.patient_id = v_patient_id
       and mo.payment_status = 'no_pagado'
       and mo.status = 'pendiente';

    exit when v_order_id is not null;

    -- Restar sobre un carrito que no existe no crea uno vacío.
    if p_delta <= 0 then
      return null;
    end if;

    begin
      insert into public.medication_orders (patient_id, pharmacy_id, delivery_address, subtotal, total)
      select v_patient_id,
             coalesce(v_product.pharmacy_id, '10000000-0000-0000-0000-000000000001'::uuid),
             pr.address,
             0, 0
        from public.profiles pr
       where pr.id = v_patient_id
      returning id into v_order_id;
      exit;
    exception when unique_violation then
      -- Perdimos la carrera: el borrador ya existe, se lo busca de nuevo.
      null;
    end;
  end loop;

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
      -- borró a propósito cuando `prescription_type` la reemplazó. De ahí se
      -- deriva, que es la fuente de verdad desde la 129.
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

  return public.recalcular_total_pedido_medicamentos(v_order_id);
end;
$$;

revoke all on function public.actualizar_item_pedido_medicamentos(uuid, integer) from public;
grant execute on function public.actualizar_item_pedido_medicamentos(uuid, integer) to authenticated;
revoke all on function public.agregar_item_pedido_medicamentos(uuid, integer) from public;
grant execute on function public.agregar_item_pedido_medicamentos(uuid, integer) to authenticated;
