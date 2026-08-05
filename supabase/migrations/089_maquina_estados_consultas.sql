-- Máquina de estados de consultas — reglas confirmadas por Mateo el 2026-08-05.
-- Referencia completa (auditoría + por qué de cada regla): docs/estados-consulta.md
--
-- Tres piezas:
--   1. Estado nuevo `expired`, distinto de `no_show`.
--   2. Un trigger que valida CADA cambio de estado. Va en la base y no en el
--      service layer a propósito: hoy todo pasa por un `update({status})` sin
--      guarda, y con la RLS actual un paciente puede escribir `completed` por
--      PostgREST. Cualquier camino nuevo (app, web, script, agente) queda
--      cubierto sin tener que acordarse de nada.
--   3. Un cron en SQL puro que cierra lo que quedó colgado. SQL y no una Edge
--      Function porque así el job entra en esta migración: no necesita secretos
--      ni HTTP, y por lo tanto es reproducible desde el repo (los 3 jobs que hay
--      hoy se registraron a mano en prod y no existen en ningún archivo).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Estado `expired`
-- ─────────────────────────────────────────────────────────────────────────────
-- `no_show` significa "uno estuvo y el otro no vino" y penaliza a alguien.
-- Un turno que nadie usó nunca no es eso: es `expired`.
alter table public.consultations drop constraint if exists consultations_status_check;
alter table public.consultations add constraint consultations_status_check
  check (status in (
    'pending', 'confirmed', 'in_progress', 'pending_pro_close',
    'completed', 'cancelled', 'no_show', 'expired'
  ));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Transiciones válidas + trigger
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.transicion_consulta_valida(p_desde text, p_hasta text)
returns boolean
language sql
immutable
as $$
  select (p_desde, p_hasta) in (
    -- alta y confirmación
    ('pending',     'confirmed'),
    ('pending',     'cancelled'),
    ('pending',     'expired'),
    ('pending',     'in_progress'),   -- `daily-token` abre sala sobre pending
    -- turno confirmado
    ('confirmed',   'in_progress'),
    ('confirmed',   'cancelled'),
    ('confirmed',   'expired'),
    ('confirmed',   'no_show'),
    -- Cierre directo de una presencial: `finalize_consultation` (rol
    -- profesional, modality='presencial') pasa a completed sin exigir que
    -- alguien haya cargado el código en la puerta. Es un flujo vivo.
    ('confirmed',   'completed'),
    -- consulta en curso
    ('in_progress', 'completed'),
    ('in_progress', 'cancelled'),     -- mp-capture libera la retención vencida
    ('in_progress', 'no_show'),
    -- legado: `pending_pro_close` no lo escribe nadie, pero hay 1 fila viva
    ('pending_pro_close', 'completed'),
    ('pending_pro_close', 'cancelled')
  );
$$;

comment on function public.transicion_consulta_valida is
  'Transiciones legales de consultations.status. completed/cancelled/expired/no_show son terminales.';

create or replace function public.validar_transicion_consulta()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- Sin cambio de estado, no hay nada que validar.
  if new.status is not distinct from old.status then
    return new;
  end if;

  -- Vía de escape (decisión de Mateo): nuestros crons y Edge Functions
  -- (service_role, sin auth.uid()) y los super admins pueden mover cualquier
  -- estado a mano para destrabar casos raros sin tocar la base por afuera.
  if auth.uid() is null or public.get_my_role() = 'super_admin' then
    return new;
  end if;

  if not public.transicion_consulta_valida(old.status, new.status) then
    raise exception
      'Transición de estado inválida: % → % (consulta %)', old.status, new.status, old.id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists consultations_validar_transicion on public.consultations;
create trigger consultations_validar_transicion
  before update of status on public.consultations
  for each row execute function public.validar_transicion_consulta();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Cierre de lo que quedó colgado
-- ─────────────────────────────────────────────────────────────────────────────
-- Tolerancia: 2 h después de `scheduled_at`.
--
-- La plata NO se devuelve sola: se crea un pedido pendiente y lo aprueba un
-- super admin (regla de producto del 2026-07-24, extendida acá a vencimientos y
-- cancelaciones del profesional, que hasta hoy no hacían nada con la plata).
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
  v_tocadas uuid[];
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
  select count(*), coalesce(array_agg(id), '{}') into v_expiradas, v_tocadas from cerradas;

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
  select count(*), v_tocadas || coalesce(array_agg(id), '{}') into v_ausentes, v_tocadas from ausentes;

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
  --     revisión del super admin. `refund_pending` es la marca que ya existía;
  --     el pedido concreto vive en payments.refund_request_status, que es lo
  --     que mira mp-refund para aprobar y emitir los Healthy Credits.
  update public.consultations
     set refund_pending = true, updated_at = now()
   where id = any(v_tocadas)
     and payment_status = 'paid'
     and refund_pending = false;
  get diagnostics v_credito = row_count;

  update public.payments
     set refund_request_status = 'pending',
         -- La cola de /super-admin/pagos ordena y muestra por esta fecha: sin
         -- ella la solicitud aparece sin "solicitado el".
         refund_requested_at = coalesce(refund_requested_at, now())
   where consultation_id = any(v_tocadas)
     and status in ('approved', 'authorized')
     and refund_request_status is null;

  return query select v_expiradas, v_ausentes, v_completadas, v_credito;
end;
$$;

comment on function public.cerrar_consultas_colgadas is
  'Cron: cierra turnos vencidos (expired/no_show) y consultas en curso abandonadas (completed). Ver docs/estados-consulta.md';

revoke all on function public.cerrar_consultas_colgadas() from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. El job, en la migración
-- ─────────────────────────────────────────────────────────────────────────────
-- Cada 15 minutos. No hace falta secreto ni HTTP: corre SQL sobre la misma base.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('cerrar-consultas-colgadas')
      where exists (select 1 from cron.job where jobname = 'cerrar-consultas-colgadas');
    perform cron.schedule(
      'cerrar-consultas-colgadas',
      '*/15 * * * *',
      $cron$select public.cerrar_consultas_colgadas()$cron$
    );
  end if;
end;
$$;
