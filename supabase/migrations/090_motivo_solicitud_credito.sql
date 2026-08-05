-- Motivo de la solicitud de crédito.
--
-- En la cola de /super-admin/pagos, una solicitud generada por el cron (turno
-- vencido, falla nuestra) se veía idéntica a una que pide un paciente al
-- cancelar. El criterio para aprobar no es el mismo, así que hay que poder
-- distinguirlas (Mateo, 2026-08-05).

alter table public.payments
  add column if not exists refund_request_reason text;

comment on column public.payments.refund_request_reason is
  'Por qué se pidió el crédito: turno_vencido | ausencia | cancelacion_paciente. Ver docs/estados-consulta.md';

-- Backfill de lo que ya está en cola: lo que el cron marcó tiene la consulta en
-- expired/no_show; el resto salió de una cancelación del paciente.
update public.payments p
   set refund_request_reason = case c.status
         when 'expired' then 'turno_vencido'
         when 'no_show' then 'ausencia'
         else 'cancelacion_paciente'
       end
  from public.consultations c
 where c.id = p.consultation_id
   and p.refund_request_status = 'pending'
   and p.refund_request_reason is null;

-- El cron ahora escribe el motivo. Se separan los ids por bucket: antes iban
-- todos a un mismo array y no se podía saber cuál fue vencimiento y cuál
-- ausencia.
create or replace function public.cerrar_consultas_colgadas()
returns table (expiradas int, ausentes int, completadas int, con_credito_pendiente int)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_corte timestamptz := now() - interval '2 hours';
  v_expiradas int := 0;
  v_ausentes  int := 0;
  v_completadas int := 0;
  v_credito int := 0;
  v_ids_expiradas uuid[];
  v_ids_ausentes  uuid[];
begin
  -- (a) Nadie apareció nunca → expired. Incluye `pending`: un turno que el
  --     profesional nunca confirmó tampoco lo cierra nadie hoy.
  with cerradas as (
    update public.consultations
       set status = 'expired', updated_at = now()
     where status in ('pending', 'confirmed')
       and scheduled_at < v_corte
       and patient_waiting_since is null
       and patient_admitted_at is null
       and started_at is null
    returning id
  )
  select count(*), coalesce(array_agg(id), '{}') into v_expiradas, v_ids_expiradas from cerradas;

  -- (b) Hubo evidencia de espera y el otro no vino → no_show.
  with ausentes as (
    update public.consultations
       set status = 'no_show', updated_at = now()
     where status = 'confirmed'
       and scheduled_at < v_corte
       and (patient_waiting_since is not null
            or patient_admitted_at is not null
            or started_at is not null)
    returning id
  )
  select count(*), coalesce(array_agg(id), '{}') into v_ausentes, v_ids_ausentes from ausentes;

  -- (c) Quedó en curso y nadie cerró → completed, y se cobra: si los dos
  --     entraron a la sala, la consulta pasó. De paso destraba la retención de
  --     la tarjeta, que hoy queda viva para siempre porque el barrido de
  --     mp-capture saltea `in_progress` a propósito.
  with cerradas as (
    update public.consultations
       set status = 'completed',
           completed_at = coalesce(completed_at, now()),
           duration_minutes = coalesce(
             duration_minutes,
             greatest(1, (extract(epoch from (now() - coalesce(started_at, scheduled_at))) / 60)::int)
           ),
           updated_at = now()
     where status = 'in_progress'
       and coalesce(started_at, scheduled_at) < v_corte
    returning id
  )
  select count(*) into v_completadas from cerradas;

  -- (d) Lo que se cerró sin prestarse y estaba pagado entra en la cola de
  --     revisión del super admin, con el motivo para que se pueda decidir.
  update public.consultations
     set refund_pending = true, updated_at = now()
   where id = any(v_ids_expiradas || v_ids_ausentes)
     and payment_status = 'paid'
     and refund_pending = false;
  get diagnostics v_credito = row_count;

  update public.payments
     set refund_request_status = 'pending',
         refund_request_reason = 'turno_vencido',
         -- La cola ordena y muestra por esta fecha.
         refund_requested_at = coalesce(refund_requested_at, now())
   where consultation_id = any(v_ids_expiradas)
     and status in ('approved', 'authorized')
     and refund_request_status is null;

  update public.payments
     set refund_request_status = 'pending',
         refund_request_reason = 'ausencia',
         refund_requested_at = coalesce(refund_requested_at, now())
   where consultation_id = any(v_ids_ausentes)
     and status in ('approved', 'authorized')
     and refund_request_status is null;

  return query select v_expiradas, v_ausentes, v_completadas, v_credito;
end;
$$;

revoke all on function public.cerrar_consultas_colgadas() from public, anon, authenticated;
