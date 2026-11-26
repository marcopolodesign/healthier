-- ============================================================
-- 256 — Pedidos de receta (254): los avisos y lo que el front necesita leer
-- ============================================================
-- Pedido de Mateo (2026-11-26), sobre el celular del médico: "Push y que se vea
-- en el inicio". Y al paciente: aviso cuando su pedido se toma, se cobra o se
-- cancela.
--
--   1. `avisar_pedido_al_paciente` (152) distingue los pedidos retenidos:
--        · un médico de Healthier lo tomó     → 'pedido-receta-tomado'
--        · se cobró la retención              → 'pedido-receta-lista'
--        · se liberó la retención (cancelado) → 'pedido-receta-liberado'
--      El 'pedido-cancelado' genérico decía "si ya lo pagaste, la devolución
--      sale automáticamente": a quien nunca se le cobró, eso lo asusta.
--   2. Al mail de cancelado (146) se le avisa que fue una liberación, por lo
--      mismo.
--   3. A los médicos de Healthier, cuando entra un pedido nuevo de receta
--      (pasa a 'autorizado' con algún item "solicitar") → 'pedido-receta-nuevo'.
--   4. `medico_pedidos_de_receta_hoy()`: lo que el médico resolvió hoy (la
--      columna "Hoy" del tablero). La lista principal (254) sólo trae lo vivo.
-- El texto de cada aviso vive en `_shared/push/textos.ts`, como todos.
-- ============================================================

-- ── 1 · Al paciente ─────────────────────────────────────────────────────────
create or replace function public.avisar_pedido_al_paciente()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- Pedidos de receta (254): un médico lo tomó.
  if new.receta_estado = 'en_curso' and old.receta_estado is distinct from 'en_curso' then
    perform public.enviar_push_tipo(
      new.patient_id, 'pedido-receta-tomado',
      jsonb_build_object('orderId', new.id)
    );
    return new;
  end if;

  if new.payment_status = 'pagado'
     and old.payment_status is distinct from 'pagado' then
    perform public.enviar_push_tipo(
      new.patient_id,
      case when old.payment_status = 'autorizado' then 'pedido-receta-lista' else 'pedido-confirmado' end,
      jsonb_build_object('orderId', new.id)
    );
    return new;
  end if;

  if new.status is distinct from old.status
     and new.status in ('enviado', 'entregado', 'cancelado') then
    perform public.enviar_push_tipo(
      new.patient_id,
      case when new.status = 'cancelado' and old.payment_status = 'autorizado'
           then 'pedido-receta-liberado' else 'pedido-' || new.status end,
      jsonb_build_object('orderId', new.id)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists medication_orders_avisar_paciente on public.medication_orders;
create trigger medication_orders_avisar_paciente
  after update of payment_status, status, receta_estado on public.medication_orders
  for each row execute function public.avisar_pedido_al_paciente();

-- ── 2 · El mail de cancelado, cuando fue una retención liberada ─────────────
create or replace function public.avisar_pedido_de_farmacia_por_mail()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.payment_status = 'pagado'
     and old.payment_status is distinct from 'pagado'
     and new.mail_confirmado_enviado_at is null then
    perform public.enviar_mail(jsonb_build_object('tipo', 'pedido-confirmado', 'orderId', new.id));
    update public.medication_orders
       set mail_confirmado_enviado_at = now(), mail_estado_enviado = new.status
     where id = new.id;
    return new;
  end if;

  if new.status is distinct from old.status
     and new.status in ('enviado', 'entregado', 'cancelado')
     and new.mail_estado_enviado is distinct from new.status then
    perform public.enviar_mail(jsonb_build_object(
      'tipo',     'pedido-estado',
      'orderId',  new.id,
      'estado',   new.status,
      'motivo',   new.cancellation_reason,
      'liberado', (new.status = 'cancelado' and old.payment_status = 'autorizado')
    ));
    update public.medication_orders set mail_estado_enviado = new.status where id = new.id;
  end if;

  return new;
end;
$$;

-- ── 3 · A los médicos de Healthier: entró un pedido de receta ───────────────
create or replace function public.avisar_medicos_pedido_de_receta()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_medico uuid;
begin
  if not exists (select 1 from public.medication_order_items i
                  where i.order_id = new.id and i.receta_via = 'solicitar') then
    return new;
  end if;

  for v_medico in
    select pp.user_id from public.professional_profiles pp
     where pp.medico_healthier = true and pp.is_verified = true
  loop
    perform public.enviar_push_tipo(
      v_medico, 'pedido-receta-nuevo', jsonb_build_object('orderId', new.id)
    );
  end loop;
  return new;
end;
$$;

drop trigger if exists medication_orders_avisar_medicos_receta on public.medication_orders;
create trigger medication_orders_avisar_medicos_receta
  after update of payment_status on public.medication_orders
  for each row
  when (new.payment_status = 'autorizado' and old.payment_status is distinct from 'autorizado'
        and new.receta_estado = 'pendiente')
  execute function public.avisar_medicos_pedido_de_receta();

-- ── 4 · Lo que el médico resolvió hoy ───────────────────────────────────────
create or replace function public.medico_pedidos_de_receta_hoy()
returns table (
  order_id          uuid,
  receta_estado     text,
  resuelto_at       timestamptz,
  paciente_nombre   text,
  paciente_telefono text,
  items             jsonb,
  total             numeric,
  motivo            text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_desde timestamptz := date_trunc('day', now() at time zone 'America/Argentina/Buenos_Aires')
                         at time zone 'America/Argentina/Buenos_Aires';
begin
  if auth.uid() is null or not public.es_medico_healthier(auth.uid()) then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;

  return query
    select mo.id,
           mo.receta_estado,
           coalesce(mo.receta_resuelta_at, mo.updated_at),
           pf.full_name,
           pf.phone,
           (select coalesce(jsonb_agg(jsonb_build_object(
                     'nombre', i.medication_name,
                     'presentacion', i.presentation,
                     'cantidad', i.quantity,
                     'via', i.receta_via) order by i.created_at), '[]'::jsonb)
              from public.medication_order_items i where i.order_id = mo.id),
           mo.total,
           mo.receta_motivo_rechazo
      from public.medication_orders mo
      join public.profiles pf on pf.id = mo.patient_id
     where mo.receta_medico_id = auth.uid()
       and mo.receta_estado in ('resuelta', 'rechazada')
       and coalesce(mo.receta_resuelta_at, mo.updated_at) >= v_desde
     order by 3 desc;
end;
$$;

revoke all on function public.medico_pedidos_de_receta_hoy() from public, anon;
grant execute on function public.medico_pedidos_de_receta_hoy() to authenticated;
