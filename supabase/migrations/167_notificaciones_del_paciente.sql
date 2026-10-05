-- ═══════════════════════════════════════════════════════════════════════════
-- 167 · Las notificaciones del paciente (la campanita del inicio)
-- ═══════════════════════════════════════════════════════════════════════════
-- Pedido de Mateo (2026-09-23): un ícono de notificaciones arriba a la derecha
-- del inicio, con los avisos del paciente — turno confirmado, receta enviada,
-- pedido de farmacia, devoluciones —, contador de no leídas y que al tocar uno
-- lleve al detalle.
--
-- De dónde sale cada fila: NO de un trigger nuevo por evento. Todo aviso al
-- paciente ya pasa por `send-push-notification`, que arma el texto desde el
-- catálogo (`_shared/push/textos.ts`). La función guarda ahí mismo la fila, con
-- el mismo título, cuerpo y link que el push. Así la campanita y el push no
-- pueden decir cosas distintas, y agregar un aviso al catálogo lo suma solo a
-- la campanita.
--
-- Consecuencia buscada: la fila se escribe aunque la persona no tenga el push
-- activado (ningún token). La campanita es justamente para el que no lo tiene.

create table if not exists public.notificaciones (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  -- La clave del catálogo (`turno-confirmado`, `receta-emitida`, …) o
  -- `libre` cuando vino por la forma vieja con título y cuerpo sueltos.
  tipo            text not null,
  titulo          text not null,
  cuerpo          text,
  -- Ruta del website, la misma que lleva el push. La app la traduce a una
  -- pantalla con el mismo mapeo que usa al tocar un push.
  url             text,
  consultation_id uuid references public.consultations(id) on delete set null,
  order_id        uuid references public.medication_orders(id) on delete set null,
  prescription_id text,
  leida_at        timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists idx_notificaciones_user_fecha
  on public.notificaciones(user_id, created_at desc);
create index if not exists idx_notificaciones_no_leidas
  on public.notificaciones(user_id) where leida_at is null;

alter table public.notificaciones enable row level security;

-- Cada uno lee las suyas. No hay policy de insert ni de delete: escribe sólo
-- la edge function con service role.
drop policy if exists notificaciones_leer_propias on public.notificaciones;
create policy notificaciones_leer_propias on public.notificaciones
  for select using (user_id = auth.uid());

-- Marcar como leídas va por RPC y no por una policy de update: con una policy
-- el cliente podría reescribir el título o el link de su propia notificación.
create or replace function public.marcar_notificaciones_leidas(p_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_n integer;
begin
  update public.notificaciones
     set leida_at = now()
   where user_id = auth.uid()
     and leida_at is null
     and (p_ids is null or id = any(p_ids));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.marcar_notificaciones_leidas(uuid[]) from public;
grant execute on function public.marcar_notificaciones_leidas(uuid[]) to authenticated;

-- El contador tiene que moverse solo cuando llega un aviso con la app abierta.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notificaciones'
  ) then
    alter publication supabase_realtime add table public.notificaciones;
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Receta emitida: el aviso no salía NUNCA
-- ═══════════════════════════════════════════════════════════════════════════
-- Las condiciones de 146 (mail) y 152 (push) estaban invertidas:
--   `if new.rcta_status is not distinct from 'issued' ... then return`
-- corta justo cuando la receta queda emitida. `rcta-issue` pasa la fila de
-- `draft` a `issued` con un update, así que ni el mail ni el push de "tu receta
-- ya está disponible" salieron jamás: en producción había 6 recetas emitidas y
-- 0 mails de receta en `email_log` (2026-09-23). Sin esto la campanita tampoco
-- tendría el aviso que Mateo puso de ejemplo.

create or replace function public.avisar_receta_emitida_por_mail()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_ya timestamptz;
begin
  if new.rcta_status is distinct from 'issued'
     or old.rcta_status is not distinct from new.rcta_status
     or new.rcta_prescription_id is null then
    return new;
  end if;

  select max(mail_receta_enviado_at) into v_ya
    from public.clinical_medications
   where rcta_prescription_id = new.rcta_prescription_id;
  if v_ya is not null then return new; end if;

  perform public.enviar_mail(jsonb_build_object(
    'tipo', 'receta', 'prescriptionId', new.rcta_prescription_id
  ));

  update public.clinical_medications
     set mail_receta_enviado_at = now()
   where rcta_prescription_id = new.rcta_prescription_id;

  return new;
end;
$$;

-- El push se apoyaba en la marca del mail para no repetirse por fila, pero los
-- dos triggers corren en la misma sentencia y en orden alfabético: el del mail
-- (`clinical_medications_mail_receta`) va DESPUÉS del push
-- (`clinical_medications_avisar_receta`), así que el push ve la marca vacía la
-- primera vez y la ve puesta en las filas siguientes. Queda uno por receta.
create or replace function public.avisar_receta_al_paciente()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_ya timestamptz;
begin
  if new.rcta_status is distinct from 'issued'
     or old.rcta_status is not distinct from new.rcta_status
     or new.rcta_prescription_id is null then
    return new;
  end if;

  select max(mail_receta_enviado_at) into v_ya
    from public.clinical_medications
   where rcta_prescription_id = new.rcta_prescription_id;
  if v_ya is not null then return new; end if;

  perform public.enviar_push_tipo(
    new.patient_id, 'receta-emitida',
    jsonb_build_object('prescriptionId', new.rcta_prescription_id)
  );
  return new;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Pagos: devoluciones
-- ═══════════════════════════════════════════════════════════════════════════
-- El pago aprobado NO lleva aviso propio: el turno confirmado y el pedido
-- confirmado ya lo dicen, y dos avisos por el mismo momento enseñan a
-- ignorarlos. Lo que sí faltaba es la devolución: hoy el paciente se entera
-- mirando el resumen de la tarjeta.
create or replace function public.avisar_devolucion_al_paciente()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.patient_id is null then return new; end if;

  if new.status = 'refunded' and old.status is distinct from 'refunded' then
    perform public.enviar_push_tipo(
      new.patient_id, 'devolucion-hecha',
      jsonb_build_object(
        'paymentId', new.id,
        'consultationId', new.consultation_id,
        'orderId', new.order_id,
        'monto', coalesce(new.charged_amount, new.gross_amount),
        'aCreditos', new.refund_type = 'credit'
      )
    );
  elsif new.refund_request_status = 'rejected'
        and old.refund_request_status is distinct from 'rejected' then
    perform public.enviar_push_tipo(
      new.patient_id, 'devolucion-rechazada',
      jsonb_build_object(
        'paymentId', new.id,
        'consultationId', new.consultation_id,
        'motivo', new.refund_reject_reason
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists payments_avisar_devolucion on public.payments;
create trigger payments_avisar_devolucion
  after update of status, refund_request_status on public.payments
  for each row execute function public.avisar_devolucion_al_paciente();
