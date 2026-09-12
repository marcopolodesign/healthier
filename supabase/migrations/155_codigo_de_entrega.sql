-- 155 — El pedido de farmacia se entrega contra un código, no contra el DNI.
--
-- ── Por qué ──────────────────────────────────────────────────────────────────
-- Pedido de Mateo (2026-09-11): "en vez de DNI, código, como el de Rappi". El
-- DNI no prueba nada útil acá —el repartidor ya lo tiene escrito en el remito, y
-- pedírselo al paciente en la puerta es incómodo y no confirma que ESE pedido es
-- de esa persona—. Un código corto que sólo el paciente ve sí lo confirma.
--
-- ── Por qué una tabla aparte y no una columna ────────────────────────────────
-- El código no le puede servir a la farmacia si la farmacia lo ve: sus políticas
-- de `medication_orders` le dan SELECT sobre todos los pedidos. Como RLS es por
-- fila y no por columna, guardarlo en `medication_orders` lo dejaría a la vista
-- del mismo que tiene que pedirlo. Revocar la columna tampoco sirve: rompería el
-- `select *` que usan las pantallas del paciente.
--
-- Entonces vive acá, con una sola policy de lectura —la del paciente dueño— y la
-- farmacia nunca lo lee: lo **verifica** por RPC.

create table if not exists public.medication_order_delivery_codes (
  order_id    uuid primary key references public.medication_orders(id) on delete cascade,
  code        text not null,
  verified_at timestamptz,
  attempts    int not null default 0,
  created_at  timestamptz not null default now()
);

comment on table public.medication_order_delivery_codes is
  'El código que el paciente le dice al repartidor. La farmacia NO puede leerlo — sólo verificarlo con verificar_codigo_entrega().';

alter table public.medication_order_delivery_codes enable row level security;

-- La única lectura: el paciente dueño del pedido. Sin policy para la farmacia
-- ni para el admin a propósito.
create policy "delivery_code_patient_select_own"
  on public.medication_order_delivery_codes for select
  using (exists (
    select 1 from public.medication_orders o
    where o.id = order_id and o.patient_id = auth.uid()
  ));

-- ═════════════════════════════════════════════════════════════════════════════
-- 1 · El código se crea con el pedido
-- ═════════════════════════════════════════════════════════════════════════════
-- 4 dígitos, con ceros a la izquierda: "0427" es un código válido. Es para
-- decirlo en voz alta en una puerta, no una credencial — lo que lo hace seguro
-- es que sólo lo ve el paciente y que se agota a los 5 intentos.
create or replace function public.crear_codigo_de_entrega()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.medication_order_delivery_codes (order_id, code)
  values (new.id, lpad((floor(random() * 10000))::int::text, 4, '0'))
  on conflict (order_id) do nothing;
  return new;
end;
$$;

drop trigger if exists medication_orders_codigo_entrega on public.medication_orders;
create trigger medication_orders_codigo_entrega
  after insert on public.medication_orders
  for each row execute function public.crear_codigo_de_entrega();

-- Los pedidos que ya existían también llevan código, si no quedarían sin forma
-- de entregarse una vez que el trigger de abajo empiece a exigirlo.
insert into public.medication_order_delivery_codes (order_id, code)
select id, lpad((floor(random() * 10000))::int::text, 4, '0')
from public.medication_orders
where status <> 'entregado'
on conflict (order_id) do nothing;

-- ═════════════════════════════════════════════════════════════════════════════
-- 2 · Verificar el código — lo llama la farmacia
-- ═════════════════════════════════════════════════════════════════════════════
-- Devuelve `{ ok, motivo, intentos_restantes }`. Si acierta, marca el pedido
-- como entregado en el mismo movimiento: que verificar y entregar sean dos
-- pasos separados es justo lo que permite entregar sin verificar.
create or replace function public.verificar_codigo_entrega(
  p_order  uuid,
  p_codigo text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_fila  public.medication_order_delivery_codes%rowtype;
  v_orden public.medication_orders%rowtype;
begin
  if public.get_my_role() not in ('pharmacy_admin', 'pharmacy_operator') then
    raise exception 'Sólo la farmacia puede verificar el código de entrega'
      using errcode = '42501';
  end if;

  select * into v_orden from public.medication_orders where id = p_order;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'pedido_inexistente');
  end if;
  if v_orden.status = 'entregado' then
    return jsonb_build_object('ok', true, 'motivo', 'ya_entregado');
  end if;
  if v_orden.status = 'cancelado' then
    return jsonb_build_object('ok', false, 'motivo', 'pedido_cancelado');
  end if;

  select * into v_fila
    from public.medication_order_delivery_codes
   where order_id = p_order
   for update;

  -- Un pedido sin código no puede quedar trabado para siempre: se le crea uno
  -- ahora y esta verificación falla, que es lo correcto (el paciente todavía no
  -- lo vio).
  if not found then
    insert into public.medication_order_delivery_codes (order_id, code)
    values (p_order, lpad((floor(random() * 10000))::int::text, 4, '0'));
    return jsonb_build_object('ok', false, 'motivo', 'sin_codigo');
  end if;

  if v_fila.attempts >= 5 then
    return jsonb_build_object('ok', false, 'motivo', 'demasiados_intentos', 'intentos_restantes', 0);
  end if;

  if v_fila.code is distinct from btrim(coalesce(p_codigo, '')) then
    update public.medication_order_delivery_codes
       set attempts = attempts + 1
     where order_id = p_order;
    return jsonb_build_object(
      'ok', false, 'motivo', 'codigo_incorrecto',
      'intentos_restantes', greatest(0, 4 - v_fila.attempts)
    );
  end if;

  update public.medication_order_delivery_codes
     set verified_at = now()
   where order_id = p_order;

  update public.medication_orders
     set status = 'entregado'
   where id = p_order;

  return jsonb_build_object('ok', true, 'motivo', 'entregado');
end;
$$;

revoke all on function public.verificar_codigo_entrega(uuid, text) from public, anon;
grant execute on function public.verificar_codigo_entrega(uuid, text) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- 3 · Sin código verificado no se entrega
-- ═════════════════════════════════════════════════════════════════════════════
-- Sin esto, la farmacia sigue pudiendo poner `status = 'entregado'` con un
-- UPDATE directo y el código queda siendo decorativo. El super admin sí puede
-- forzarlo: hace falta una salida cuando algo se rompe en la calle.
create or replace function public.exigir_codigo_de_entrega()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_verificado timestamptz;
begin
  if new.status = 'entregado' and old.status is distinct from 'entregado' then
    if public.get_my_role() in ('admin', 'super_admin') then
      return new;
    end if;
    select verified_at into v_verificado
      from public.medication_order_delivery_codes where order_id = new.id;
    if v_verificado is null then
      raise exception 'Para marcar el pedido como entregado hace falta el código que el paciente ve en la app'
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists medication_orders_exigir_codigo on public.medication_orders;
create trigger medication_orders_exigir_codigo
  before update of status on public.medication_orders
  for each row execute function public.exigir_codigo_de_entrega();
