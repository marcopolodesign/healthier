-- ─────────────────────────────────────────────────────────────────────────────
-- Reasignar el profesional de una consulta — y la deuda que eso genera.
--
-- Por qué existe (decisión del dueño, 2026-08-06): a veces el profesional que
-- iba a atender una consulta no puede, y atiende otro. El super admin necesita
-- poder cambiar quién la toma. El problema es la plata: Healthier es un
-- marketplace real de Mercado Pago con split payment — el que cobra es el
-- profesional, no Healthier — y la consulta ya puede tener una pre-autorización
-- o un cobro creado y FIRMADO con el `access_token` OAuth del profesional
-- ORIGINAL (mp-payment). Verificado contra la documentación de MP: una vez
-- creado un pago (o una pre-autorización con capture:false), el cobrador queda
-- fijado para siempre a ese token — `PUT /v1/payments/{id}` (mp-capture) sólo
-- acepta `capture` y `transaction_amount`, no un cobrador nuevo. No existe
-- ninguna forma de redirigir la plata de una pre-auth ya creada a la cuenta de
-- otro profesional. Por eso el diseño entero es este:
--
--   1. La consulta se reasigna (`professional_id` pasa a ser quien atiende de
--      verdad). `original_professional_id` guarda quién la tenía antes, fijo
--      para siempre — no se pisa en reasignaciones sucesivas.
--   2. La pre-autorización se sigue capturando contra el ORIGINAL — es el
--      único que puede. mp-capture no se toca.
--   3. Esta migración agrega la tabla de transferencias que pidió el dueño
--      (`consultation_reassignments`): un registro por reasignación con el
--      monto neto en juego, cuánto se le debe al que atendió de verdad y
--      cuánto hay que recuperarle al original.
--   4. El recupero es automático y futuro, no una devolución: la PRÓXIMA
--      consulta que el profesional original cobre directo (no on-demand, ver
--      nota más abajo) se firma con el token de PLATAFORMA de Healthier en vez
--      del suyo — así esa plata nunca le llega a él, y se descuenta de la
--      deuda. Si la consulta vale más que la deuda, el original nunca pierde
--      de más: el excedente queda como crédito a su favor y se le paga en la
--      liquidación mensual manual que ya existe (`manual_settlement_amount`,
--      migración 057). La lógica vive en `mp-payment` (ver el comentario largo
--      ahí) y en las funciones de abajo.
--
-- Lo que se dejó explícitamente afuera de esta migración, con nota en el
-- reporte de la tarea para que lo decida un humano: el recupero automático
-- SÓLO aplica a cobros directos (turnos agendados, capturados en el momento).
-- Las pre-autorizaciones on-demand (`authorizeOnly`) no participan: se
-- capturan más tarde con el MISMO token con el que se autorizaron
-- (mp-capture busca ese token por `payments.professional_id`, no reinterpreta
-- nada), y la consigna de la tarea fue no tocar esa función más de lo
-- estrictamente necesario. Si el profesional original sólo atiende on-demand,
-- su deuda queda pendiente hasta que tenga una consulta agendada directa.
-- ─────────────────────────────────────────────────────────────────────────────

-- ────────────────────────────────────────────────────────────
-- 1. consultations — quién la tiene hoy vs. quién la tenía originalmente
-- ────────────────────────────────────────────────────────────
alter table public.consultations
  add column if not exists original_professional_id uuid references public.profiles(id);

comment on column public.consultations.original_professional_id is
  'Profesional al que se le asignó la consulta la primera vez (y con cuyo token de MP se firmó el pago/pre-auth). NULL = nunca se reasignó, es el mismo que professional_id. Se fija una sola vez, en la primera reasignación — no se pisa si se reasigna de nuevo.';

-- ────────────────────────────────────────────────────────────
-- 2. consultation_reassignments — la tabla de transferencias/deudas
-- ────────────────────────────────────────────────────────────
create table if not exists public.consultation_reassignments (
  id                                     uuid primary key default gen_random_uuid(),
  consultation_id                        uuid not null references public.consultations(id),
  -- El pago (pre-auth o cobro directo) que ya está o va a quedar firmado
  -- contra el profesional original. NULL si al momento de reasignar todavía
  -- no existía ningún pago para esta consulta (ver `status = 'no_payment'`).
  payment_id                             uuid references public.payments(id),
  original_professional_id               uuid not null references public.profiles(id),
  covering_professional_id               uuid not null references public.profiles(id),
  reassigned_by                          uuid references public.profiles(id),
  reason                                 text,
  gross_amount                           numeric not null default 0,
  -- Bruto × (1 − comisión) al momento de reasignar — el mismo cálculo que
  -- `net_to_professional` en `payments`. Es el número que está en juego: lo
  -- que el original va a recibir de MP sin haber atendido, y lo que el que sí
  -- atendió debería haber recibido.
  net_amount                             numeric not null default 0,
  -- Cuánto hay que pagarle al que atendió de verdad. Se salda manual, mismo
  -- mecanismo que `payments.manual_settlement_amount` (liquidación mensual).
  amount_owed_to_covering_professional   numeric not null default 0,
  -- Cuánto hay que recuperarle al original. Lo consume `apply_debt_recovery()`
  -- de a poco, a medida que el original cobra consultas nuevas.
  amount_to_recover_from_original        numeric not null default 0,
  amount_recovered                       numeric not null default 0,
  -- no_payment          = se reasignó antes de que existiera cobro; no hay nada
  --                        que recuperar ni pagar (el cobro nuevo, si llega, ya
  --                        sale a nombre del profesional que quedó asignado).
  -- pending              = deuda viva, todavía no se recuperó nada.
  -- partially_recovered  = se recuperó una parte automáticamente.
  -- recovered            = deuda saldada del todo.
  -- superseded           = esta consulta se volvió a reasignar antes de
  --                        terminar de recuperarse esta deuda — ver el
  --                        comentario largo arriba ("dos reasignaciones
  --                        seguidas"). Sus montos vivos quedan en 0; el
  --                        registro se conserva sólo como auditoría.
  status                                  text not null default 'pending'
                                            check (status in ('no_payment', 'pending', 'partially_recovered', 'recovered', 'superseded')),
  owed_settled_at                        timestamptz,
  owed_settled_by                        uuid references public.profiles(id),
  notes                                   text,
  reassigned_at                          timestamptz not null default now(),
  created_at                             timestamptz not null default now(),
  updated_at                             timestamptz not null default now()
);

comment on table public.consultation_reassignments is
  'Un registro por cada vez que el super admin le cambia el profesional a una consulta que ya tenía (o iba a tener) plata en juego. Conecta consultation_id, payment_id y los dos profesionales — no son ids sueltos. original_professional_id es contra quien se capturó/captura el pago real de MP; covering_professional_id es quien atendió de verdad y a quien hay que pagarle aparte.';
comment on column public.consultation_reassignments.net_amount is
  'gross_amount × (1 − commission_rate) al momento de la reasignación. Es el monto neto en juego: lo que el original cobra de más y lo que el que atendió debería cobrar.';
comment on column public.consultation_reassignments.amount_to_recover_from_original is
  'Lo que todavía hay que descontarle al original en sus próximos cobros directos. apply_debt_recovery() lo va consumiendo; amount_recovered es lo ya recuperado.';
comment on column public.consultation_reassignments.amount_owed_to_covering_professional is
  'Lo que hay que pagarle al que atendió de verdad. Se salda manual (mark_reassignment_owed_paid), igual que manual_settlement_amount en payments.';

create index if not exists idx_reasign_consultation      on public.consultation_reassignments(consultation_id);
create index if not exists idx_reasign_original_pending   on public.consultation_reassignments(original_professional_id) where status in ('pending', 'partially_recovered');
create index if not exists idx_reasign_covering_owed      on public.consultation_reassignments(covering_professional_id) where amount_owed_to_covering_professional > 0 and owed_settled_at is null;
create index if not exists idx_reasign_created_at         on public.consultation_reassignments(created_at);

alter table public.consultation_reassignments enable row level security;

drop policy if exists "consultation_reassignments_select_admin" on public.consultation_reassignments;
create policy "consultation_reassignments_select_admin"
  on public.consultation_reassignments for select
  using (public.get_my_role() in ('admin', 'super_admin'));

-- Los profesionales involucrados pueden ver sus propias filas (que les deben,
-- o que les recuperaron algo) — no hay UI todavía para esto en el dashboard
-- del profesional, pero la policy no lastima que exista de antemano.
drop policy if exists "consultation_reassignments_select_involved" on public.consultation_reassignments;
create policy "consultation_reassignments_select_involved"
  on public.consultation_reassignments for select
  using (original_professional_id = auth.uid() or covering_professional_id = auth.uid());

-- Sin policy de INSERT/UPDATE para authenticated a propósito — igual que
-- `payments`: todas las escrituras pasan por las funciones SECURITY DEFINER
-- de abajo (reassign_consultation, apply_debt_recovery, mark_reassignment_owed_paid).

drop trigger if exists consultation_reassignments_updated_at on public.consultation_reassignments;
create trigger consultation_reassignments_updated_at
  before update on public.consultation_reassignments
  for each row execute function public.set_updated_at();

-- ────────────────────────────────────────────────────────────
-- 3. debt_recoveries — bitácora: qué pago futuro recuperó qué parte de qué deuda
-- ────────────────────────────────────────────────────────────
create table if not exists public.debt_recoveries (
  id               uuid primary key default gen_random_uuid(),
  reassignment_id  uuid not null references public.consultation_reassignments(id),
  -- El pago NUEVO (de una consulta distinta, futura) que se firmó con el
  -- token de plataforma y cuya plata se usó para saldar la deuda.
  payment_id       uuid not null references public.payments(id),
  professional_id  uuid not null references public.profiles(id),
  amount_applied   numeric not null,
  created_at       timestamptz not null default now()
);

comment on table public.debt_recoveries is
  'Bitácora append-only: cada fila es "este payment_id (cobro nuevo, firmado con el token de plataforma) recuperó amount_applied de la deuda de reassignment_id". Existe para poder mostrar de dónde salió cada recupero, no sólo el saldo — mismo criterio que professional_verification_log (097).';

create index if not exists idx_debt_recoveries_reassignment on public.debt_recoveries(reassignment_id);
create index if not exists idx_debt_recoveries_payment       on public.debt_recoveries(payment_id);
create index if not exists idx_debt_recoveries_professional  on public.debt_recoveries(professional_id, created_at desc);

-- Un mismo pago NO puede recuperar la MISMA deuda dos veces. No va sobre
-- `payment_id` solo: un pago puede cubrir varias reasignaciones distintas en
-- una sola corrida de `apply_debt_recovery` (el loop FIFO inserta una fila por
-- reasignación que toca) — eso es válido y tiene que poder pasar. Lo que NO
-- puede pasar es (reassignment_id, payment_id) repetido: eso sólo sucede si la
-- función se ejecutó dos veces para el mismo cobro. Defensa en profundidad
-- junto con el advisory lock + la guarda de idempotencia de la función.
create unique index if not exists idx_debt_recoveries_reassignment_payment
  on public.debt_recoveries(reassignment_id, payment_id);

alter table public.debt_recoveries enable row level security;

drop policy if exists "debt_recoveries_select_admin" on public.debt_recoveries;
create policy "debt_recoveries_select_admin"
  on public.debt_recoveries for select
  using (public.get_my_role() in ('admin', 'super_admin'));

drop policy if exists "debt_recoveries_select_own" on public.debt_recoveries;
create policy "debt_recoveries_select_own"
  on public.debt_recoveries for select
  using (professional_id = auth.uid());

-- ────────────────────────────────────────────────────────────
-- 4. reassign_consultation — la acción del super admin
-- ────────────────────────────────────────────────────────────
create or replace function public.reassign_consultation(
  p_consultation_id     uuid,
  p_new_professional_id uuid,
  p_reason              text default null
)
returns public.consultation_reassignments
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_consultation       public.consultations%rowtype;
  v_original           uuid;
  v_commission_rate    numeric;
  v_net_amount         numeric;
  v_payment            public.payments%rowtype;
  v_already_recovered  numeric := 0;
  v_result             public.consultation_reassignments;
begin
  if public.get_my_role() <> 'super_admin' then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  if p_new_professional_id is null then
    raise exception 'Falta el profesional que va a atender la consulta';
  end if;

  if not exists (select 1 from public.profiles where id = p_new_professional_id and role = 'professional') then
    raise exception 'El profesional destino no existe o no tiene ese rol';
  end if;

  select * into v_consultation
    from public.consultations
    where id = p_consultation_id
    for update;

  if not found then
    raise exception 'Consulta no encontrada';
  end if;

  if v_consultation.professional_id = p_new_professional_id then
    raise exception 'La consulta ya está asignada a ese profesional';
  end if;

  -- El original de verdad: si esta consulta ya se había reasignado antes, no
  -- se pisa — es la persona con cuyo token de MP quedó fijado el pago desde el
  -- principio. Si es la primera reasignación, es quien la tenía hasta ahora.
  v_original := coalesce(v_consultation.original_professional_id, v_consultation.professional_id);

  select coalesce(commission_rate, 0.20) into v_commission_rate
    from public.platform_settings where id = 1;

  v_net_amount := round(coalesce(v_consultation.price_at_booking, 0) * (1 - v_commission_rate), 2);

  -- El pago que importa es el que está (o va a quedar) firmado contra el
  -- ORIGINAL — no contra quien esté asignado hoy.
  select * into v_payment
    from public.payments
    where consultation_id = p_consultation_id
      and professional_id = v_original
      and status in ('authorized', 'approved')
    order by created_at desc
    limit 1;

  -- Reasignación en cadena (dos reasignaciones seguidas sobre la misma
  -- consulta, antes de que la deuda anterior termine de recuperarse): la
  -- plata real SIEMPRE quedó fijada contra el original, nunca llegó a pasar
  -- por el profesional intermedio — así que ese intermedio no ganó ni perdió
  -- nada de verdad. Su fila de deuda queda "superseded" (auditoría, en 0) y
  -- se resta lo que ya se hubiera recuperado automáticamente, para no
  -- cobrarle al original esa parte dos veces.
  select coalesce(sum(amount_recovered), 0) into v_already_recovered
    from public.consultation_reassignments
    where consultation_id = p_consultation_id
      and status in ('pending', 'partially_recovered');

  update public.consultation_reassignments
    set status = 'superseded',
        amount_owed_to_covering_professional = 0,
        amount_to_recover_from_original = 0,
        notes = coalesce(notes || ' — ', '') || 'Superada por una nueva reasignación el ' || to_char(now(), 'YYYY-MM-DD HH24:MI'),
        updated_at = now()
    where consultation_id = p_consultation_id
      and status in ('pending', 'partially_recovered');

  insert into public.consultation_reassignments (
    consultation_id, payment_id,
    original_professional_id, covering_professional_id,
    reassigned_by, reason,
    gross_amount, net_amount,
    amount_owed_to_covering_professional,
    amount_to_recover_from_original,
    amount_recovered,
    status
  ) values (
    p_consultation_id, v_payment.id,
    v_original, p_new_professional_id,
    auth.uid(), p_reason,
    coalesce(v_consultation.price_at_booking, 0), v_net_amount,
    case when v_payment.id is null then 0 else v_net_amount end,
    case when v_payment.id is null then 0 else greatest(v_net_amount - v_already_recovered, 0) end,
    0,
    case when v_payment.id is null then 'no_payment' else 'pending' end
  )
  returning * into v_result;

  update public.consultations
    set professional_id = p_new_professional_id,
        original_professional_id = v_original
    where id = p_consultation_id;

  return v_result;
end;
$$;

comment on function public.reassign_consultation(uuid, uuid, text) is
  'Único camino para cambiarle el profesional a una consulta con plata en juego. super_admin only. Deja consultations.professional_id = quien atiende ahora, consultations.original_professional_id = con quien se firmó el pago, e inserta la fila de deuda/transferencia correspondiente.';

grant execute on function public.reassign_consultation(uuid, uuid, text) to authenticated;

-- ────────────────────────────────────────────────────────────
-- 5. get_professional_pending_debt — cuánto le queda por devolver
-- ────────────────────────────────────────────────────────────
create or replace function public.get_professional_pending_debt(p_professional uuid)
returns numeric
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_debt numeric;
begin
  if auth.uid() is not null
     and auth.uid() <> p_professional
     and public.get_my_role() not in ('admin', 'super_admin') then
    raise exception 'No autorizado';
  end if;

  select coalesce(sum(amount_to_recover_from_original - amount_recovered), 0)
    into v_debt
    from public.consultation_reassignments
    where original_professional_id = p_professional
      and status in ('pending', 'partially_recovered');

  return greatest(v_debt, 0);
end;
$$;

comment on function public.get_professional_pending_debt(uuid) is
  'Saldo pendiente de recuperar de un profesional (suma de amount_to_recover_from_original − amount_recovered en sus filas pending/partially_recovered). Lo consulta mp-payment antes de firmar cada cobro directo.';

grant execute on function public.get_professional_pending_debt(uuid) to authenticated;

-- ────────────────────────────────────────────────────────────
-- 6. apply_debt_recovery — descuenta un cobro nuevo de la deuda (FIFO)
-- ────────────────────────────────────────────────────────────
-- Sólo el service role la puede llamar (auth.uid() IS NULL en ese contexto —
-- mismo criterio que get_credit_balance/056). Ni siquiera el super_admin
-- desde el browser puede tocar esto directo: la plata sólo se mueve cuando
-- MP confirma un cobro real, nunca por una edición manual de saldo.
--
-- Idempotencia por p_payment_id — POR QUÉ HACE FALTA:
-- `mp-payment` firma cada cobro con un `X-Idempotency-Key` derivado de
-- `consultationId:cardToken`. Eso evita que MP cobre dos veces por un
-- reintento de red o un doble click — el segundo intento vuelve con el MISMO
-- pago, ya `approved`. Pero sin guarda acá, el código de `mp-payment` seguía
-- de largo y volvía a llamar a esta función con el mismo `p_payment_id`:
-- **la deuda se descontaba dos veces por un solo cobro real**, perdonándole al
-- profesional plata que nunca se recuperó. Se arregla en la base (acá) y no
-- en la Edge Function porque cualquier otro llamador futuro repetiría el bug
-- si la garantía sólo viviera del lado de afuera.
--
-- El advisory lock (`pg_advisory_xact_lock`, keyed por payment_id) serializa
-- dos corridas concurrentes para el MISMO pago — sin él, dos llamadas que
-- entran a la vez podrían pasar el chequeo "¿ya existe una fila con este
-- payment_id?" ANTES de que la primera confirme su insert (carrera clásica
-- lectura-antes-de-escritura). Es transaccional: se libera solo al terminar
-- la función, no hace falta soltarlo a mano. El índice único
-- `idx_debt_recoveries_reassignment_payment` es la segunda barrera, por si
-- algún día algo inserta en `debt_recoveries` sin pasar por acá.
create or replace function public.apply_debt_recovery(
  p_professional uuid,
  p_amount       numeric,
  p_payment_id   uuid
)
returns numeric
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_remaining  numeric := coalesce(p_amount, 0);
  v_row        public.consultation_reassignments%rowtype;
  v_take       numeric;
  v_applied    numeric := 0;
begin
  if auth.uid() is not null then
    raise exception 'No autorizado';
  end if;

  if v_remaining <= 0 or p_payment_id is null then
    return 0;
  end if;

  perform pg_advisory_xact_lock(hashtext(p_payment_id::text));

  if exists (select 1 from public.debt_recoveries where payment_id = p_payment_id) then
    -- Este pago ya recuperó deuda en una corrida anterior — reintento de
    -- mp-payment sobre un cobro que MP ya había aprobado. No hacer nada.
    return 0;
  end if;

  for v_row in
    select * from public.consultation_reassignments
    where original_professional_id = p_professional
      and status in ('pending', 'partially_recovered')
    order by created_at asc
    for update
  loop
    exit when v_remaining <= 0;

    v_take := least(v_remaining, v_row.amount_to_recover_from_original - v_row.amount_recovered);
    if v_take <= 0 then
      continue;
    end if;

    update public.consultation_reassignments
      set amount_recovered = amount_recovered + v_take,
          status = case
            when amount_recovered + v_take >= amount_to_recover_from_original then 'recovered'
            else 'partially_recovered'
          end,
          updated_at = now()
      where id = v_row.id;

    insert into public.debt_recoveries (reassignment_id, payment_id, professional_id, amount_applied)
      values (v_row.id, p_payment_id, p_professional, v_take);

    v_remaining := v_remaining - v_take;
    v_applied := v_applied + v_take;
  end loop;

  return v_applied;
end;
$$;

comment on function public.apply_debt_recovery(uuid, numeric, uuid) is
  'Descuenta p_amount de la deuda de p_professional, FIFO por consultation_reassignments más antigua primero, y deja constancia en debt_recoveries. La llama mp-payment después de un cobro directo aprobado con el token de plataforma. Sólo service_role — nunca desde el browser.';

revoke all on function public.apply_debt_recovery(uuid, numeric, uuid) from public;
grant execute on function public.apply_debt_recovery(uuid, numeric, uuid) to service_role;

-- ────────────────────────────────────────────────────────────
-- 7. mark_reassignment_owed_paid — liquidar manualmente al que atendió
-- ────────────────────────────────────────────────────────────
create or replace function public.mark_reassignment_owed_paid(p_reassignment_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if public.get_my_role() <> 'super_admin' then
    raise exception 'No autorizado';
  end if;

  update public.consultation_reassignments
    set owed_settled_at = now(),
        owed_settled_by = auth.uid()
    where id = p_reassignment_id
      and amount_owed_to_covering_professional > 0
      and owed_settled_at is null;

  if not found then
    raise exception 'Transferencia no encontrada o ya liquidada';
  end if;
end;
$$;

comment on function public.mark_reassignment_owed_paid(uuid) is
  'super_admin marca como pagada (transferencia manual, fuera de MP) la parte que se le debe al profesional que atendió de verdad. Mismo patrón que mark_settlement_paid (057).';

grant execute on function public.mark_reassignment_owed_paid(uuid) to authenticated;
