-- Estado `closing` — "procesando / cerrando el cierre de la consulta".
--
-- El problema real (Mateo, 2026-08-06): en una videoconsulta, el profesional
-- corta la llamada y pasa a la pantalla de "Cerrar consulta" (carga notas,
-- receta, alergias). Mientras tanto la fila sigue en `in_progress` — el mismo
-- estado que usaba el paciente para saber que podía "Entrar a Sala" — así que
-- el paciente puede volver a entrar a una llamada que ya terminó (el banner
-- de inicio, "Mi Agenda" y la sala de espera lo siguen ofreciendo).
--
-- `closing` es la ventana entre "el profesional cortó" y "el profesional
-- terminó de cargar el cierre". Durante esa ventana el paciente ve "Preparando
-- tu receta" y no puede volver a entrar a la sala (bloqueado también del lado
-- del servidor, en `daily-token`, no sólo ocultando el botón).
--
-- Por qué sólo video/on-demand la usa: en presencial no hay "cortar la
-- llamada" — el profesional entra con el código de la puerta y cierra
-- directo desde `ConsultationDetail`, sin ningún paso intermedio que separar.
-- El estado queda disponible en la máquina para cualquier modalidad (no se
-- restringe por CHECK), pero hoy sólo lo escribe el flujo de videollamada.
--
-- Resiliencia (mismo patrón que `ondemand_wait_until`, migración 093): si el
-- profesional cierra la pestaña a mitad del cierre, la consulta no puede
-- quedar en "Preparando tu receta" para siempre. `closing_started_at` marca
-- cuándo arrancó la espera, y el cron de la migración 089
-- (`cerrar_consultas_colgadas`, cada 15 min) la completa sola a los 10
-- minutos — igual que ya hace con un `in_progress` abandonado, pero con una
-- tolerancia mucho más corta porque acá el paciente está mirando la pantalla
-- en ese momento, no esperando pasivamente un turno futuro.
--
-- SQL idempotente — puede correrse más de una vez sin romper nada.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Columna: desde cuándo está "cerrando"
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.consultations
  add column if not exists closing_started_at timestamptz;

comment on column public.consultations.closing_started_at is
  'Cuándo pasó a status=closing (el profesional cortó la llamada y está cargando el cierre). NULL en cualquier otro estado. El cron de cerrar_consultas_colgadas() la usa para no dejar a un paciente viendo "Preparando tu receta" para siempre si el profesional abandona el cierre.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Estado `closing` en el constraint
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.consultations drop constraint if exists consultations_status_check;
alter table public.consultations add constraint consultations_status_check
  check (status in (
    'pending', 'confirmed', 'in_progress', 'closing', 'pending_pro_close',
    'completed', 'cancelled', 'no_show', 'expired'
  ));

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Transiciones nuevas
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
    -- el profesional cortó la llamada y está cargando el cierre (migración 098)
    ('in_progress', 'closing'),
    ('closing',     'completed'),
    -- legado: `pending_pro_close` no lo escribe nadie, pero hay 1 fila viva
    ('pending_pro_close', 'completed'),
    ('pending_pro_close', 'cancelled')
  );
$$;

comment on function public.transicion_consulta_valida is
  'Transiciones legales de consultations.status. completed/cancelled/expired/no_show son terminales.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Cron: completar un `closing` abandonado
-- ─────────────────────────────────────────────────────────────────────────────
-- Reemplaza `cerrar_consultas_colgadas()` (migración 089) agregando el paso
-- (e), entre el cierre de `in_progress` abandonada (c) y la cola de
-- reembolsos (d). Misma firma de retorno — no rompe nada que la llame.
create or replace function public.cerrar_consultas_colgadas()
returns table (expiradas int, ausentes int, completadas int, con_credito_pendiente int)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_corte timestamptz := now() - interval '2 hours';
  -- Tolerancia corta a propósito: acá el paciente está viendo "Preparando tu
  -- receta" en pantalla ahora mismo, no esperando pasivamente un turno futuro
  -- como en el resto de este cron.
  v_corte_closing timestamptz := now() - interval '10 minutes';
  v_expiradas int := 0;
  v_ausentes  int := 0;
  v_completadas int := 0;
  v_cerrando_completadas int := 0;
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

  -- (e) El profesional cortó la llamada (status='closing') y nunca volvió a
  --     terminar el cierre — cerró la pestaña, se le fue la conexión, lo que
  --     sea. El acto médico ya pasó (por eso llegó a `closing` y no se quedó en
  --     `in_progress`), así que se cierra igual que (c): completed y se cobra.
  --     No entra en la cola de reembolso de (d) por la misma razón.
  with cerradas_closing as (
    update public.consultations
       set status = 'completed',
           completed_at = coalesce(completed_at, now()),
           duration_minutes = coalesce(
             duration_minutes,
             greatest(1, (extract(epoch from (now() - coalesce(started_at, closing_started_at, scheduled_at))) / 60)::int)
           ),
           updated_at = now()
     where status = 'closing'
       and coalesce(closing_started_at, updated_at) < v_corte_closing
    returning id
  )
  select count(*) into v_cerrando_completadas from cerradas_closing;
  v_completadas := v_completadas + v_cerrando_completadas;

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
  'Cron: cierra turnos vencidos (expired/no_show), consultas en curso abandonadas y cierres abandonados (completed). Ver docs/estados-consulta.md';
