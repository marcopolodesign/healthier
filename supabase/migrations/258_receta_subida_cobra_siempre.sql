-- 258 · Solicitar receta / Ya tengo receta — ronda de revisión pre-producción
--
-- 1. Aprobar una receta subida intenta cobrar SIEMPRE (antes, en un pedido
--    mixto, no se cobraba aunque el médico ya hubiera hecho su receta, y nada
--    lo reintentaba). mp-capture re-valida y contesta 422 si falta algo.
-- 2. `es_medico_healthier(uuid)` deja de estar abierta a cualquier usuario: se
--    podía preguntar por cualquier id y armar la lista de médicos que atienden
--    los pedidos. La usan sólo las RPCs (security definer) y el servidor.

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

  -- Se intenta cobrar SIEMPRE: mp-capture re-valida todo y, si todavía falta la
  -- receta del médico, contesta 422 sin tocar la plata. Así un pedido mixto en
  -- el que el médico ya hizo la receta se cobra apenas la farmacia aprueba. Si
  -- la llamada se pierde o MP falla, el barrido de mp-capture reintenta el
  -- cobro cada 5 minutos (idempotente).
  perform public.llamar_edge_function('mp-capture',
    jsonb_build_object('action', 'capture-pharmacy-order', 'orderId', p_order));

  if v_solic then
    return jsonb_build_object('estado', 'aprobada_esperando_medico');
  end if;
  return jsonb_build_object('estado', 'aprobada_cobrando');
end;
$$;

revoke all on function public.farmacia_resolver_receta_subida(uuid, boolean, text) from public, anon;
grant execute on function public.farmacia_resolver_receta_subida(uuid, boolean, text) to authenticated;

revoke execute on function public.es_medico_healthier(uuid) from public, anon, authenticated;
grant execute on function public.es_medico_healthier(uuid) to service_role;
