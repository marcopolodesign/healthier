-- ============================================================
-- 254 — Farmacia: comprar un producto con receta SIN tenerla
--        ("Solicitar receta") o subiendo la que ya tiene ("Ya tengo receta")
-- ============================================================
-- Pedido de Mateo (2026-11-26). Decisiones suyas:
--   · El pago se RETIENE (pre-autorización de Mercado Pago, capture:false) al
--     comprar y se COBRA cuando la receta queda resuelta. Si no se resuelve, se
--     libera la retención y no hay reembolso.
--   · Si el médico decide no recetar, el pedido se cancela entero.
--   · Atiende un "médico de Healthier": un profesional que sólo el super admin
--     marca (`professional_profiles.medico_healthier`).
--   · "Ya tengo receta": el paciente sube foto/PDF y la farmacia aprueba o
--     rechaza.
--
-- 🔴 Plata y reglas de negocio del lado del servidor (regla dura 2026-11-25):
--   nada de esto lo decide el cliente. El estado 'autorizado' y todo
--   `receta_*` lo escriben sólo mp-payment / mp-capture (service role) y las
--   RPC de acá (que marcan `healthier.receta_rpc`); un trigger se los niega a
--   cualquier otro, paciente y farmacia incluidos.
--
-- Qué hace esta migración:
--   1. Items: `receta_via` ('solicitar' | 'subida'), `receta_archivo_path`,
--      `receta_aprobada_at`. El trigger de la 214 deja agregar sin cobertura un
--      item marcado (el piso legal del catálogo sigue: sólo vale en productos
--      que no son de venta libre).
--   2. Pedidos: `payment_status` suma 'autorizado' (retenido) y se agregan
--      `receta_estado`, `receta_medico_id`, `receta_consulta_id`,
--      `receta_motivo_rechazo`, `receta_resuelta_at`, `autorizado_at`.
--   3. `professional_profiles.medico_healthier` (sólo super admin).
--   4. Funciones de validación: `farmacia_items_receta_sin_resolver`,
--      `farmacia_atar_items_solicitados`. `farmacia_items_sin_receta` ya no
--      mira los items marcados (los mira la anterior).
--   5. RPC: medico_pedidos_de_receta, medico_tomar_pedido_de_receta,
--      medico_rechazar_pedido_de_receta, farmacia_resolver_receta_subida,
--      farmacia_recetas_subidas_del_pedido, agregar_item_pedido_medicamentos
--      (ahora con receta_via).
--   6. Bucket privado `recetas-subidas`.
--   7. Triggers: protección de lo que escribe el servidor, liberación
--      automática al rechazar (llama a mp-capture) y los avisos.
-- ============================================================

-- ── 1 · Items ───────────────────────────────────────────────────────────────
alter table public.medication_order_items
  add column if not exists receta_via          text,
  add column if not exists receta_archivo_path text,
  add column if not exists receta_aprobada_at  timestamptz;

alter table public.medication_order_items
  drop constraint if exists medication_order_items_receta_via_check,
  add constraint medication_order_items_receta_via_check
    check (receta_via is null or receta_via in ('solicitar', 'subida'));

comment on column public.medication_order_items.receta_via is
  'Cómo piensa resolver la receta el paciente: solicitar = un médico de Healthier se la hace; subida = sube la que ya tiene y la farmacia la aprueba. NULL = tiene que tener una receta vigente al agregarlo.';
comment on column public.medication_order_items.receta_archivo_path is
  'Bucket recetas-subidas: <patient_id>/<archivo>. Sólo con receta_via = subida.';
comment on column public.medication_order_items.receta_aprobada_at is
  'Cuándo la farmacia aprobó la receta subida. La escribe sólo farmacia_resolver_receta_subida.';

-- ── 2 · Pedidos ─────────────────────────────────────────────────────────────
alter table public.medication_orders
  add column if not exists receta_estado         text,
  add column if not exists receta_medico_id      uuid references public.profiles(id),
  add column if not exists receta_consulta_id    uuid,
  add column if not exists receta_motivo_rechazo text,
  add column if not exists receta_resuelta_at    timestamptz,
  add column if not exists autorizado_at         timestamptz;

alter table public.medication_orders
  drop constraint if exists medication_orders_receta_estado_check,
  add constraint medication_orders_receta_estado_check
    check (receta_estado is null or receta_estado in ('pendiente', 'en_curso', 'resuelta', 'rechazada'));

alter table public.medication_orders
  drop constraint if exists medication_orders_payment_status_check,
  add constraint medication_orders_payment_status_check
    check (payment_status in ('no_pagado', 'autorizado', 'pagado', 'exento'));

comment on column public.medication_orders.payment_status is
  'no_pagado = carrito · autorizado = retenido en la tarjeta (pre-autorización), se cobra cuando la receta queda resuelta · pagado = cobrado · exento = bonificado (profiles.payment_exempt). Sólo el servidor lo mueve.';
comment on column public.medication_orders.receta_estado is
  'Pedidos con items receta_via: pendiente (nadie lo tomó) · en_curso (un médico lo tomó) · resuelta (receta lista y cobrado) · rechazada (no corresponde recetar, o la farmacia rechazó la subida).';

create index if not exists medication_orders_retenidos_idx
  on public.medication_orders (autorizado_at)
  where payment_status = 'autorizado';

alter table public.consultations
  add column if not exists medication_order_id uuid references public.medication_orders(id) on delete set null;

comment on column public.consultations.medication_order_id is
  'Consulta sin costo que abre un médico de Healthier para hacer la receta de un pedido de farmacia (medico_tomar_pedido_de_receta).';

create index if not exists consultations_medication_order_idx
  on public.consultations (medication_order_id) where medication_order_id is not null;

-- ── 3 · Médico de Healthier ─────────────────────────────────────────────────
alter table public.professional_profiles
  add column if not exists medico_healthier boolean not null default false;

comment on column public.professional_profiles.medico_healthier is
  'Atiende los pedidos de receta de la farmacia. Sólo el super admin lo cambia (trigger proteger_medico_healthier); se maneja desde /super-admin/profesionales.';

create or replace function public.proteger_medico_healthier()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.role() = 'service_role' or auth.uid() is null or public.get_my_role() = 'super_admin' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if coalesce(new.medico_healthier, false) = false then return new; end if;
  elsif new.medico_healthier is not distinct from old.medico_healthier then
    return new;
  end if;
  raise exception 'Sólo el super admin marca a un médico de Healthier.' using errcode = '42501';
end;
$$;

drop trigger if exists professional_profiles_proteger_medico_healthier on public.professional_profiles;
create trigger professional_profiles_proteger_medico_healthier
  before insert or update of medico_healthier on public.professional_profiles
  for each row execute function public.proteger_medico_healthier();

create or replace function public.es_medico_healthier(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.professional_profiles pp
     where pp.user_id = p_user and pp.medico_healthier = true and pp.is_verified = true
  )
$$;

revoke all on function public.es_medico_healthier(uuid) from public, anon;
grant execute on function public.es_medico_healthier(uuid) to authenticated, service_role;

-- ── 4 · Lo que sólo escribe el servidor ─────────────────────────────────────
-- service role (mp-payment, mp-capture, mp-webhook) o una RPC de esta migración
-- (que marca `healthier.receta_rpc` en su transacción). La policy de UPDATE del
-- paciente (106) y la de la farmacia (106) no limitan columnas.
create or replace function public.proteger_receta_de_pedidos()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.role() = 'service_role'
     or coalesce(current_setting('healthier.receta_rpc', true), '') = '1' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.receta_estado is null and new.receta_medico_id is null and new.receta_consulta_id is null
       and new.receta_motivo_rechazo is null and new.receta_resuelta_at is null and new.autorizado_at is null then
      return new;
    end if;
  else
    if new.receta_estado         is not distinct from old.receta_estado
       and new.receta_medico_id      is not distinct from old.receta_medico_id
       and new.receta_consulta_id    is not distinct from old.receta_consulta_id
       and new.receta_motivo_rechazo is not distinct from old.receta_motivo_rechazo
       and new.receta_resuelta_at    is not distinct from old.receta_resuelta_at
       and new.autorizado_at         is not distinct from old.autorizado_at
       -- Retenido: nadie lo prepara ni lo cancela a mano. Lo resuelve mp-capture.
       and (old.payment_status <> 'autorizado' or new.status is not distinct from old.status) then
      return new;
    end if;
  end if;

  raise exception 'Ese dato del pedido lo escribe sólo el servidor.' using errcode = '42501';
end;
$$;

drop trigger if exists medication_orders_proteger_receta on public.medication_orders;
create trigger medication_orders_proteger_receta
  before insert or update on public.medication_orders
  for each row execute function public.proteger_receta_de_pedidos();

-- La 137/165 ya impide que paciente y farmacia pongan CUALQUIER payment_status
-- (incluido 'autorizado'): sólo service role y admin/super admin. No cambia.

-- ── 5 · El item con receta_via, validado al agregarlo ───────────────────────
create or replace function public.farmacia_item_exige_receta()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_tipo    text;
  v_patient uuid;
  v_linea   record;
  v_otros   integer;
begin
  -- Escrituras del servidor (service role: seeds, scripts) no pasan por acá.
  if auth.uid() is null then
    return new;
  end if;

  -- Bajar la cantidad nunca necesita receta: si venció, el paciente igual
  -- tiene que poder achicar o sacar lo que ya tenía en el carrito.
  if tg_op = 'UPDATE'
     and new.pharmacy_product_id is not distinct from old.pharmacy_product_id
     and new.receta_via is not distinct from old.receta_via
     and new.receta_archivo_path is not distinct from old.receta_archivo_path
     and new.quantity <= old.quantity then
    return new;
  end if;

  select p.prescription_type into v_tipo
    from public.pharmacy_products p where p.id = new.pharmacy_product_id;

  select mo.patient_id into v_patient from public.medication_orders mo where mo.id = new.order_id;

  -- Quien no es el paciente dueño del pedido no marca recetas (la aprobación de
  -- la farmacia la escribe su RPC, con la marca de servidor).
  if tg_op = 'UPDATE' and new.receta_aprobada_at is distinct from old.receta_aprobada_at
     and coalesce(current_setting('healthier.receta_rpc', true), '') <> '1' then
    raise exception 'La aprobación de la receta la escribe sólo la farmacia.' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' and new.receta_aprobada_at is not null then
    raise exception 'La aprobación de la receta la escribe sólo la farmacia.' using errcode = '42501';
  end if;

  -- 🆕 Camino sin receta en mano: no exige cobertura. El piso legal sigue:
  -- sólo se marca un producto que de verdad pide receta.
  if new.receta_via is not null then
    if v_tipo is null or v_tipo = 'venta_libre' then
      raise exception 'Este producto no necesita receta.'
        using errcode = 'HR004', hint = 'receta_innecesaria';
    end if;

    if new.receta_via = 'subida' then
      if new.receta_archivo_path is null
         or split_part(new.receta_archivo_path, '/', 1) <> v_patient::text
         or not exists (select 1 from storage.objects o
                         where o.bucket_id = 'recetas-subidas' and o.name = new.receta_archivo_path) then
        raise exception 'Subí la foto o el PDF de tu receta.'
          using errcode = 'HR005', hint = 'receta_archivo_requerido';
      end if;
    else
      new.receta_archivo_path := null;
    end if;

    new.clinical_medication_id := null;
    new.requires_prescription  := true;
    return new;
  end if;

  new.receta_archivo_path := null;

  if new.pharmacy_product_id is null and new.requires_prescription then
    raise exception 'Necesitás una receta vigente para comprar este medicamento.'
      using errcode = 'HR001', hint = 'receta_requerida';
  end if;

  if v_tipo is null or v_tipo = 'venta_libre' then
    new.clinical_medication_id := null;
    return new;
  end if;

  select r.* into v_linea
    from public.farmacia_recetas_de(v_patient, new.order_id) r
   where r.estado = 'vigente'
     and new.pharmacy_product_id = any (r.producto_ids)
   order by (r.clinical_medication_id = new.clinical_medication_id) desc nulls last, r.emitida_at desc
   limit 1;

  if not found then
    raise exception 'Necesitás una receta vigente para comprar este medicamento.'
      using errcode = 'HR001', hint = 'receta_requerida';
  end if;

  select coalesce(sum(it.quantity), 0) into v_otros
    from public.medication_order_items it
   where it.order_id = new.order_id
     and it.clinical_medication_id = v_linea.clinical_medication_id
     and it.id is distinct from new.id;

  if v_otros + new.quantity > v_linea.max_envases then
    raise exception 'Tu receta cubre % envase%.', v_linea.max_envases,
                    case when v_linea.max_envases = 1 then '' else 's' end
      using errcode = 'HR003', hint = 'receta_excedida';
  end if;

  new.clinical_medication_id := v_linea.clinical_medication_id;
  new.requires_prescription  := true;
  return new;
end;
$$;

drop trigger if exists medication_order_items_exige_receta on public.medication_order_items;
create trigger medication_order_items_exige_receta
  before insert or update of quantity, pharmacy_product_id, receta_via, receta_archivo_path, receta_aprobada_at
  on public.medication_order_items
  for each row execute function public.farmacia_item_exige_receta();

-- ── 6 · Validación del pedido: los items marcados aparte ────────────────────
-- `farmacia_items_sin_receta` (214) sigue siendo la fuente de verdad para los
-- items SIN marca, pero ya no mira los marcados: para esos manda la función de
-- abajo. mp-payment llama a la primera antes de cobrar o retener.
create or replace function public.farmacia_items_sin_receta(p_order uuid)
returns table (item_id uuid, medication_name text, motivo text)
language sql
stable
security definer
set search_path to 'public'
as $$
  with o as (
    select patient_id from public.medication_orders where id = p_order
  ),
  r as (
    select * from public.farmacia_recetas_de((select patient_id from o), p_order)
     where estado = 'vigente'
  ),
  it as (
    select i.*, coalesce(p.prescription_type,
                         case when i.requires_prescription then 'receta' else 'venta_libre' end) as tipo
      from public.medication_order_items i
      left join public.pharmacy_products p on p.id = i.pharmacy_product_id
     where i.order_id = p_order
       and i.receta_via is null
  )
  select it.id, it.medication_name, 'sin_receta'
    from it
   where it.tipo <> 'venta_libre'
     and not exists (
       select 1 from r
        where r.clinical_medication_id = it.clinical_medication_id
          and it.pharmacy_product_id = any (r.producto_ids)
     )
  union all
  select null::uuid, r.medication_name, 'excede_envases'
    from r
    join (select clinical_medication_id, sum(quantity) as q from it
           where clinical_medication_id is not null group by 1) s
      on s.clinical_medication_id = r.clinical_medication_id
   where s.q > r.max_envases
$$;

-- Ata cada item "solicitar" a la receta vigente que lo cubre, respetando el
-- tope de envases de cada receta. Devuelve cuántos quedaron SIN receta. La usa
-- mp-capture justo antes de cobrar: la receta la hizo el médico (o ya existía).
create or replace function public.farmacia_atar_items_solicitados(p_order uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_patient uuid;
  v_item    record;
  v_cm      uuid;
  v_faltan  integer := 0;
begin
  select patient_id into v_patient from public.medication_orders where id = p_order;
  if v_patient is null then return 0; end if;

  perform set_config('healthier.receta_rpc', '1', true);

  update public.medication_order_items
     set clinical_medication_id = null
   where order_id = p_order and receta_via = 'solicitar';

  for v_item in
    select * from public.medication_order_items
     where order_id = p_order and receta_via = 'solicitar'
     order by created_at, id
  loop
    select r.clinical_medication_id into v_cm
      from public.farmacia_recetas_de(v_patient, p_order) r
     where r.estado = 'vigente'
       and v_item.pharmacy_product_id = any (r.producto_ids)
       and r.max_envases - coalesce((
             select sum(x.quantity) from public.medication_order_items x
              where x.order_id = p_order
                and x.clinical_medication_id = r.clinical_medication_id
                and x.id <> v_item.id), 0) >= v_item.quantity
     order by r.emitida_at desc
     limit 1;

    if v_cm is null then
      v_faltan := v_faltan + 1;
    else
      update public.medication_order_items set clinical_medication_id = v_cm where id = v_item.id;
    end if;
  end loop;

  return v_faltan;
end;
$$;

revoke all on function public.farmacia_atar_items_solicitados(uuid) from public, anon, authenticated;
grant execute on function public.farmacia_atar_items_solicitados(uuid) to service_role;

-- Items marcados que TODAVÍA no se pueden cobrar:
--   subida   → la farmacia no la aprobó.
--   solicitar→ no está atado a una receta emitida y vigente (o se pasa de envases).
-- Vacío = se puede cobrar. mp-capture la llama después de
-- `farmacia_atar_items_solicitados`.
create or replace function public.farmacia_items_receta_sin_resolver(p_order uuid)
returns table (item_id uuid, medication_name text, motivo text)
language sql
stable
security definer
set search_path to 'public'
as $$
  with o as (
    select patient_id from public.medication_orders where id = p_order
  ),
  r as (
    select * from public.farmacia_recetas_de((select patient_id from o), p_order)
     where estado = 'vigente'
  ),
  it as (
    select i.* from public.medication_order_items i
     where i.order_id = p_order and i.receta_via is not null
  )
  select it.id, it.medication_name, 'subida_sin_aprobar'
    from it
   where it.receta_via = 'subida' and it.receta_aprobada_at is null
  union all
  select it.id, it.medication_name, 'sin_receta'
    from it
   where it.receta_via = 'solicitar'
     and not exists (
       select 1 from r
        where r.clinical_medication_id = it.clinical_medication_id
          and it.pharmacy_product_id = any (r.producto_ids)
     )
  union all
  select null::uuid, r.medication_name, 'excede_envases'
    from r
    join (select clinical_medication_id, sum(quantity) as q from it
           where receta_via = 'solicitar' and clinical_medication_id is not null group by 1) s
      on s.clinical_medication_id = r.clinical_medication_id
   where s.q > r.max_envases
$$;

revoke all on function public.farmacia_items_receta_sin_resolver(uuid) from public, anon, authenticated;
grant execute on function public.farmacia_items_receta_sin_resolver(uuid) to service_role;

-- ¿Ya hay una receta vigente que cubra cada item "solicitar"? Sólo lectura, sin
-- atar nada: es lo que mira el médico para saber si ya puede cobrar.
create or replace function public.farmacia_solicitados_cubiertos(p_order uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select not exists (
    select 1
      from public.medication_order_items i
      join public.medication_orders mo on mo.id = i.order_id
     where i.order_id = p_order and i.receta_via = 'solicitar'
       and not exists (
         select 1 from public.farmacia_recetas_de(mo.patient_id, p_order) r
          where r.estado = 'vigente' and i.pharmacy_product_id = any (r.producto_ids)
       )
  )
$$;

revoke all on function public.farmacia_solicitados_cubiertos(uuid) from public, anon, authenticated;
grant execute on function public.farmacia_solicitados_cubiertos(uuid) to service_role;

-- Al pasar a pagado/exento por una vía que no es el servidor (la bonificada),
-- también tienen que estar resueltos los items marcados: sin esto, un paciente
-- exento se llevaba un producto con receta sólo marcando "solicitar".
create or replace function public.farmacia_pedido_exige_receta()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- El 'pagado' lo escriben mp-payment, mp-capture y mp-webhook con la service
  -- key, y ellos ya validaron las recetas ANTES de cobrar. Frenarlo acá, con la
  -- tarjeta ya cobrada, dejaría un cobro sin pedido.
  if auth.role() = 'service_role' then
    return new;
  end if;

  if new.payment_status in ('pagado', 'exento')
     and old.payment_status in ('no_pagado', 'autorizado')
     and (exists (select 1 from public.farmacia_items_sin_receta(new.id))
          or exists (select 1 from public.medication_order_items i
                      where i.order_id = new.id and i.receta_via is not null)) then
    raise exception 'Hay medicamentos en tu pedido que necesitan una receta vigente.'
      using errcode = 'HR002', hint = 'receta_requerida';
  end if;
  return new;
end;
$$;

-- ── 7 · El carrito: agregar con receta_via ──────────────────────────────────
drop function if exists public.agregar_item_pedido_medicamentos(uuid, integer);

create or replace function public.agregar_item_pedido_medicamentos(
  p_product_id          uuid,
  p_delta               integer default 1,   -- negativo resta; si llega a 0 saca el medicamento
  p_receta_via          text    default null, -- 'solicitar' | 'subida' (opcional)
  p_receta_archivo_path text    default null  -- sólo con 'subida'
)
returns uuid                                   -- id del pedido, o NULL si quedó vacío y se borró
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

  if p_receta_via is not null and p_receta_via not in ('solicitar', 'subida') then
    raise exception 'Camino de receta inválido.' using errcode = '22023';
  end if;

  select * into v_product from public.pharmacy_products where id = p_product_id;
  if not found then
    raise exception 'El producto ya no está en el catálogo.' using errcode = 'P0002';
  end if;

  loop
    select mo.id into v_order_id
      from public.medication_orders mo
     where mo.patient_id = v_patient_id
       and mo.payment_status = 'no_pagado'
       and mo.status = 'pendiente';

    exit when v_order_id is not null;

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
      quantity, unit_price, requires_prescription, receta_via, receta_archivo_path
    ) values (
      v_order_id, p_product_id, v_product.name, v_product.presentation,
      v_qty, v_product.price, v_product.prescription_type is distinct from 'venta_libre',
      p_receta_via, p_receta_archivo_path
    );
  else
    -- El precio se refresca al tocar la cantidad: el total que ve es el que se
    -- le va a cobrar. Si manda un camino de receta, lo cambia; si no, queda el
    -- que tenía.
    update public.medication_order_items
       set quantity = v_qty,
           unit_price = v_product.price,
           receta_via = coalesce(p_receta_via, receta_via),
           receta_archivo_path = case when p_receta_via is null then receta_archivo_path
                                      else p_receta_archivo_path end
     where id = v_item_id;
  end if;

  return public.recalcular_total_pedido_medicamentos(v_order_id);
end;
$$;

comment on function public.agregar_item_pedido_medicamentos(uuid, integer, text, text) is
  'Agrega/resta un producto del carrito del paciente (lo crea si no existe). p_receta_via = solicitar | subida deja agregar un producto con receta sin tenerla (ver 254): se cobra recién cuando la receta queda resuelta.';

revoke all on function public.agregar_item_pedido_medicamentos(uuid, integer, text, text) from public, anon;
grant execute on function public.agregar_item_pedido_medicamentos(uuid, integer, text, text) to authenticated, service_role;

-- ── 8 · Bucket privado de las recetas subidas ───────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('recetas-subidas', 'recetas-subidas', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
on conflict (id) do nothing;

drop policy if exists "recetas_subidas_insert_own" on storage.objects;
create policy "recetas_subidas_insert_own"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'recetas-subidas' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "recetas_subidas_select" on storage.objects;
create policy "recetas_subidas_select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'recetas-subidas'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.get_my_role() in ('pharmacy_admin', 'pharmacy_operator', 'pharmacy_readonly', 'admin', 'super_admin')
    )
  );

-- Mientras el pedido no se pagó, el paciente puede reemplazar su archivo; ya
-- subido y usado no se toca (sin policy de update/delete).

-- ── 9 · RPC del médico de Healthier ─────────────────────────────────────────
create or replace function public.medico_pedidos_de_receta()
returns table (
  order_id            uuid,
  autorizado_at       timestamptz,
  receta_estado       text,
  tomado_por_mi       boolean,
  consulta_id         uuid,
  paciente_id         uuid,
  paciente_nombre     text,
  paciente_telefono   text,
  paciente_edad       integer,
  items               jsonb,
  lista_para_cobrar   boolean,
  total               numeric
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null or not public.es_medico_healthier(auth.uid()) then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;

  return query
    select mo.id,
           mo.autorizado_at,
           mo.receta_estado,
           (mo.receta_medico_id = auth.uid()),
           mo.receta_consulta_id,
           mo.patient_id,
           pf.full_name,
           pf.phone,
           case when pf.birth_date is null then null
                else date_part('year', age(pf.birth_date))::integer end,
           (select coalesce(jsonb_agg(jsonb_build_object(
                     'nombre', i.medication_name,
                     'presentacion', i.presentation,
                     'cantidad', i.quantity,
                     'via', i.receta_via) order by i.created_at), '[]'::jsonb)
              from public.medication_order_items i where i.order_id = mo.id),
           (mo.receta_estado = 'en_curso' and mo.receta_medico_id = auth.uid()
              and public.farmacia_solicitados_cubiertos(mo.id)),
           mo.total
      from public.medication_orders mo
      join public.profiles pf on pf.id = mo.patient_id
     where mo.payment_status = 'autorizado'
       and mo.status = 'pendiente'
       and exists (select 1 from public.medication_order_items i
                    where i.order_id = mo.id and i.receta_via = 'solicitar')
       and (mo.receta_estado = 'pendiente'
            or (mo.receta_estado = 'en_curso' and mo.receta_medico_id = auth.uid()))
     order by mo.autorizado_at;
end;
$$;

revoke all on function public.medico_pedidos_de_receta() from public, anon;
grant execute on function public.medico_pedidos_de_receta() to authenticated;

create or replace function public.medico_tomar_pedido_de_receta(p_order uuid)
returns uuid                       -- consultation_id
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_me       uuid := auth.uid();
  v_ord      public.medication_orders%rowtype;
  v_consulta uuid;
begin
  if v_me is null or not public.es_medico_healthier(v_me) then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;

  perform set_config('healthier.receta_rpc', '1', true);

  -- El primero gana: un solo UPDATE condicional. Dos médicos a la vez → uno
  -- recibe la fila y el otro no.
  update public.medication_orders
     set receta_estado = 'en_curso', receta_medico_id = v_me
   where id = p_order
     and payment_status = 'autorizado'
     and status = 'pendiente'
     and receta_estado = 'pendiente'
     and exists (select 1 from public.medication_order_items i
                  where i.order_id = p_order and i.receta_via = 'solicitar')
  returning * into v_ord;

  if not found then
    -- ¿Ya lo tenía yo? Se devuelve la misma consulta (reintento idempotente).
    select * into v_ord from public.medication_orders
     where id = p_order and receta_medico_id = v_me and receta_estado = 'en_curso';
    if found and v_ord.receta_consulta_id is not null then
      return v_ord.receta_consulta_id;
    end if;
    raise exception 'Otro médico ya tomó este pedido, o ya no está disponible.'
      using errcode = 'P0002', hint = 'pedido_no_disponible';
  end if;

  -- La consulta sin costo sobre la que el médico escribe la historia clínica y
  -- emite la receta (misma pantalla de siempre). Sin mails ni avisos de "turno
  -- nuevo": la marca de la reserva ya viene puesta.
  insert into public.consultations (
    patient_id, professional_id, status, scheduled_at, modality,
    payment_status, price_at_booking, is_on_demand, medication_order_id,
    mail_reserva_enviado_at
  ) values (
    v_ord.patient_id, v_me, 'confirmed', now(), 'video',
    'exempt', 0, false, v_ord.id,
    now()
  ) returning id into v_consulta;

  update public.medication_orders set receta_consulta_id = v_consulta where id = v_ord.id;
  return v_consulta;
end;
$$;

revoke all on function public.medico_tomar_pedido_de_receta(uuid) from public, anon;
grant execute on function public.medico_tomar_pedido_de_receta(uuid) to authenticated;

create or replace function public.medico_rechazar_pedido_de_receta(p_order uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_me     uuid := auth.uid();
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  if v_me is null or not public.es_medico_healthier(v_me) then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;
  if v_motivo is null then
    raise exception 'Dejá el motivo por el que no corresponde recetar.' using errcode = '22023';
  end if;

  perform set_config('healthier.receta_rpc', '1', true);

  -- Lo toma él (o ya era suyo) y lo rechaza: el trigger de más abajo libera la
  -- retención. Si lo tiene otro médico, no.
  update public.medication_orders
     set receta_estado = 'rechazada',
         receta_medico_id = coalesce(receta_medico_id, v_me),
         receta_motivo_rechazo = v_motivo
   where id = p_order
     and payment_status = 'autorizado'
     and (receta_estado = 'pendiente' or (receta_estado = 'en_curso' and receta_medico_id = v_me))
     and exists (select 1 from public.medication_order_items i
                  where i.order_id = p_order and i.receta_via = 'solicitar');

  if not found then
    raise exception 'Este pedido no está disponible para rechazar.'
      using errcode = 'P0002', hint = 'pedido_no_disponible';
  end if;
end;
$$;

revoke all on function public.medico_rechazar_pedido_de_receta(uuid, text) from public, anon;
grant execute on function public.medico_rechazar_pedido_de_receta(uuid, text) to authenticated;

-- ── 10 · RPC de la farmacia: la receta subida ───────────────────────────────
create or replace function public.farmacia_recetas_subidas_del_pedido(p_order uuid)
returns table (item_id uuid, medicamento text, archivo_path text, aprobada_at timestamptz)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if public.get_my_role() not in ('pharmacy_admin', 'pharmacy_operator', 'pharmacy_readonly', 'admin', 'super_admin') then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;
  return query
    select i.id, i.medication_name, i.receta_archivo_path, i.receta_aprobada_at
      from public.medication_order_items i
      join public.medication_orders mo on mo.id = i.order_id
     where i.order_id = p_order and i.receta_via = 'subida'
       and mo.payment_status in ('autorizado', 'pagado');
end;
$$;

revoke all on function public.farmacia_recetas_subidas_del_pedido(uuid) from public, anon;
grant execute on function public.farmacia_recetas_subidas_del_pedido(uuid) to authenticated;

create or replace function public.farmacia_resolver_receta_subida(
  p_order   uuid,
  p_aprobar boolean,
  p_motivo  text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_ord     public.medication_orders%rowtype;
  v_motivo  text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_solic   boolean;
begin
  if public.get_my_role() not in ('pharmacy_admin', 'pharmacy_operator', 'admin', 'super_admin') then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;

  select * into v_ord from public.medication_orders where id = p_order for update;
  if not found or v_ord.payment_status <> 'autorizado' or v_ord.status <> 'pendiente'
     or v_ord.receta_estado not in ('pendiente', 'en_curso') then
    raise exception 'Este pedido no está esperando una receta.' using errcode = 'P0002', hint = 'pedido_no_disponible';
  end if;
  if not exists (select 1 from public.medication_order_items i
                  where i.order_id = p_order and i.receta_via = 'subida' and i.receta_aprobada_at is null) then
    raise exception 'Este pedido no tiene recetas subidas para resolver.' using errcode = 'P0002';
  end if;

  perform set_config('healthier.receta_rpc', '1', true);

  if not p_aprobar then
    if v_motivo is null then
      raise exception 'Dejá el motivo del rechazo.' using errcode = '22023';
    end if;
    update public.medication_orders
       set receta_estado = 'rechazada', receta_motivo_rechazo = v_motivo
     where id = p_order;  -- el trigger libera la retención
    return jsonb_build_object('estado', 'rechazada');
  end if;

  update public.medication_order_items
     set receta_aprobada_at = now()
   where order_id = p_order and receta_via = 'subida' and receta_aprobada_at is null;

  v_solic := exists (select 1 from public.medication_order_items i
                      where i.order_id = p_order and i.receta_via = 'solicitar');

  if v_solic then
    -- Falta lo que resuelve el médico: no se cobra todavía.
    return jsonb_build_object('estado', 'aprobada_esperando_medico');
  end if;

  -- Todo resuelto: se cobra solo (mp-capture re-valida). Si la llamada se
  -- pierde, la farmacia o el barrido reintentan: es idempotente.
  perform public.llamar_edge_function('mp-capture',
    jsonb_build_object('action', 'capture-pharmacy-order', 'orderId', p_order));
  return jsonb_build_object('estado', 'aprobada_cobrando');
end;
$$;

revoke all on function public.farmacia_resolver_receta_subida(uuid, boolean, text) from public, anon;
grant execute on function public.farmacia_resolver_receta_subida(uuid, boolean, text) to authenticated;

-- ── 11 · Rechazar libera la retención, sola ─────────────────────────────────
create or replace function public.liberar_retencion_al_rechazar_receta()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform public.llamar_edge_function('mp-capture',
    jsonb_build_object('action', 'cancel-pharmacy-order', 'orderId', new.id,
                       'motivo', coalesce(new.receta_motivo_rechazo, 'No corresponde recetar este medicamento.')));
  return new;
end;
$$;

drop trigger if exists medication_orders_liberar_al_rechazar on public.medication_orders;
create trigger medication_orders_liberar_al_rechazar
  after update of receta_estado on public.medication_orders
  for each row
  when (new.receta_estado = 'rechazada' and old.receta_estado is distinct from 'rechazada'
        and new.payment_status = 'autorizado')
  execute function public.liberar_retencion_al_rechazar_receta();

-- ── 12 · Las consultas "de receta" no avisan como un turno ──────────────────
-- Se abre sin costo en nombre del paciente: el push de "turno agendado por tu
-- profesional" no corresponde (el mail de reserva ya viene marcado como enviado).
create or replace function public.avisar_turno_agendado()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.patient_id is null or new.professional_id is null then return new; end if;
  if new.medication_order_id is not null then return new; end if;
  -- Consulta inmediata: el aviso es "Te encontramos un profesional" (pedido aceptado).
  if coalesce(new.is_on_demand, false) then return new; end if;
  -- Sólo si lo agendó el profesional; si reservó el paciente, ya lo sabe.
  if auth.uid() is distinct from new.professional_id then return new; end if;
  perform public.enviar_push_tipo(
    new.patient_id, 'turno-agendado', jsonb_build_object('consultationId', new.id));
  return new;
end;
$$;

-- La consulta de receta nace 'exempt' sin que el paciente esté bonificado:
-- la abre una RPC de esta migración (marca de servidor), no el cliente.
create or replace function public.proteger_payment_status_consultations()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.role() = 'service_role' or public.get_my_role() = 'super_admin' then
    return new;
  end if;

  if coalesce(current_setting('healthier.receta_rpc', true), '') = '1'
     and new.medication_order_id is not null and new.payment_status = 'exempt' then
    return new;
  end if;

  -- Atención de una emergencia (migración 177).
  if new.emergency_id is not null and new.payment_status = 'exempt' and exists (
    select 1 from public.emergencies e
    where e.id = new.emergency_id and e.professional_id = auth.uid()
  ) then
    return new;
  end if;

  -- La bonificación es de quien paga: para la consulta de un familiar cuenta
  -- la del titular (migración 181).
  if (new.patient_id = auth.uid() or public.es_titular_de(auth.uid(), new.patient_id))
     and new.payment_status = 'exempt' then
    if exists (select 1 from public.profiles where id = auth.uid() and payment_exempt = true) then
      return new;
    end if;
    raise exception 'Esta cuenta no tiene la videollamada bonificada.'
      using errcode = '42501';
  end if;

  if new.payment_status = 'pending_payment'
     and (new.patient_id = auth.uid() or new.professional_id = auth.uid()
          or public.es_titular_de(auth.uid(), new.patient_id)) then
    return new;
  end if;

  raise exception 'No autorizado para modificar el estado de pago de esta consulta.'
    using errcode = '42501';
end;
$$;

-- Un paciente no puede inventarse una consulta "de receta": la columna sólo la
-- escribe la RPC (marca de servidor) o el servidor.
create or replace function public.proteger_medication_order_id_consulta()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.role() = 'service_role' or coalesce(current_setting('healthier.receta_rpc', true), '') = '1' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.medication_order_id is null then return new; end if;
  elsif new.medication_order_id is not distinct from old.medication_order_id then
    return new;
  end if;
  raise exception 'Esa marca de la consulta la escribe sólo el servidor.' using errcode = '42501';
end;
$$;

drop trigger if exists consultations_proteger_pedido_de_receta on public.consultations;
create trigger consultations_proteger_pedido_de_receta
  before insert or update of medication_order_id on public.consultations
  for each row execute function public.proteger_medication_order_id_consulta();
