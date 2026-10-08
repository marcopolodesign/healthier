-- ============================================================
-- Migración 191 — Teleclínica por despacho: pagar → "buscando" → el primero que acepta
-- ============================================================
-- Pedido de Mateo (2026-10-07). Prende el despacho que la 067 dejó a medio
-- construir y que el CLAUDE.md del monorepo describe en "Cuándo va a hacer falta
-- el despacho". Hasta hoy el paciente elegía de un pool rotado y la consulta
-- nacía asignada; ahora:
--
--   1. El paciente PAGA primero: elige tarjeta, pone el CVV y toca "Pagar". La
--      tarjeta se tokeniza en su dispositivo y el token queda guardado del lado
--      del servidor (tabla `ondemand_request_cobros`, que ningún cliente puede
--      leer). Todavía no se reserva nada en su tarjeta.
--   2. Se crea el pedido SIN médico y les suena a todos los elegibles a la vez.
--   3. El primero que acepta se lo queda (`accept_ondemand_request`, una sola
--      sentencia condicional). Recién ahí la Edge Function `ondemand-despacho`
--      crea la pre-autorización (capture:false) contra la cuenta de Mercado Pago
--      de ESE profesional, con el token guardado.
--   4. Si nadie acepta antes de `expires_at`, el pedido vence y el token se
--      borra: no se cobró ni se reservó nada.
--
-- Qué cambia respecto de la 067:
--   · El pedido es por VERTICAL, con todas sus especialidades (`especialidades`),
--     igual que el pool: un clínico anotado como cardiólogo cuenta para Clínica.
--   · Elegible = verificado, activo, con la consulta inmediata prendida, con
--     Mercado Pago conectado y con un latido de la última hora (el mismo criterio
--     que `search({ onlyLive })`). La 067 no miraba la presencia.
--   · El paciente ya NO inserta ni actualiza filas a mano: la 067 le dejaba
--     hacer UPDATE de la fila entera, o sea marcarse `accepted` solo. Todo pasa
--     por la Edge Function.
--   · La consulta nace `pending` (no `confirmed`): la confirma mp-payment cuando
--     Mercado Pago autoriza, igual que en el modelo del pool.
--   · Grupo familiar: `para_id` es el familiar atendido; `patient_id` sigue
--     siendo quien pide y paga.
--   · Avisos: push a todos los elegibles al crearse, y al paciente al aceptarse.
--   · El super admin ve todos los pedidos.
-- ============================================================

-- ── 1. Columnas nuevas del pedido ─────────────────────────────────────────────
alter table public.ondemand_requests
  add column if not exists para_id       uuid references public.profiles(id) on delete set null,
  add column if not exists especialidades text[],
  -- sin_pago (bonificada) · pendiente (token guardado, falta que alguien acepte)
  -- · autorizado · rechazado (se le pidió otra tarjeta al paciente)
  add column if not exists estado_pago   text not null default 'pendiente'
    check (estado_pago in ('sin_pago', 'pendiente', 'autorizado', 'rechazado')),
  add column if not exists pago_detalle  text,
  add column if not exists cancelled_at  timestamptz,
  add column if not exists avisados      integer;

comment on column public.ondemand_requests.para_id is
  'Familiar atendido (migración 181). NULL = el propio paciente que pide y paga.';
comment on column public.ondemand_requests.especialidades is
  'Slugs de especialidad que cuentan para el pedido (todas las de la vertical al momento de pedir).';
comment on column public.ondemand_requests.estado_pago is
  'Estado de la pre-autorización: sin_pago (bonificada) · pendiente · autorizado · rechazado.';
comment on column public.ondemand_requests.avisados is
  'A cuántos profesionales elegibles se les mandó el aviso al crearse.';

-- ── 2. El token de la tarjeta, fuera del alcance de cualquier cliente ────────
-- Separado de `ondemand_requests` porque esa tabla la leen los profesionales
-- (y va por Realtime): el token no puede viajar ahí. Sin policies + RLS
-- prendida = sólo la service role lo ve. Se borra al usarse, al vencer el
-- pedido y al cancelarse.
create table if not exists public.ondemand_request_cobros (
  request_id        uuid primary key references public.ondemand_requests(id) on delete cascade,
  payer_id          uuid not null references public.profiles(id) on delete cascade,
  card_token        text not null,
  payment_method_id text,
  saved_card_id     uuid references public.payment_methods(id) on delete set null,
  payer_email       text,
  payer_doc_type    text,
  payer_doc_number  text,
  device_id         text,
  created_at        timestamptz not null default now()
);

alter table public.ondemand_request_cobros enable row level security;
revoke all on public.ondemand_request_cobros from anon, authenticated;

comment on table public.ondemand_request_cobros is
  'Token de tarjeta del pedido on-demand, de un solo uso. Sólo service role. Lo consume ondemand-despacho al aceptarse y se borra.';

-- ── 3. Quién puede tomar un pedido ───────────────────────────────────────────
create or replace function public.puede_tomar_ondemand(p_user uuid, p_especialidades text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from professional_profiles pp
     where pp.user_id = p_user
       and pp.specialty = any (p_especialidades)
       and pp.is_on_demand = true
       and pp.is_verified = true
       and pp.is_active = true
       and pp.mp_connected = true
       and pp.on_demand_last_seen_at >= now() - interval '1 hour'
  );
$$;

comment on function public.puede_tomar_ondemand(uuid, text[]) is
  'Elegible para un pedido on-demand: verificado, activo, on-demand prendido, MP conectado y latido de la última hora (ON_DEMAND_PRESENCE_TTL_MS).';

-- Los pedidos viejos (de la 067, nunca hubo filas) no tienen el arreglo.
update public.ondemand_requests set especialidades = array[specialty] where especialidades is null;

-- ── 4. RLS ───────────────────────────────────────────────────────────────────
drop policy if exists "patient_insert_own_request" on public.ondemand_requests;
drop policy if exists "patient_update_own_request" on public.ondemand_requests;
drop policy if exists "professional_select_open_requests" on public.ondemand_requests;
drop policy if exists "admin_select_requests" on public.ondemand_requests;

create policy "professional_select_open_requests" on public.ondemand_requests
  for select using (
    accepted_by = auth.uid()
    or (
      status = 'pending'
      and expires_at > now()
      and patient_id <> auth.uid()
      and public.puede_tomar_ondemand(auth.uid(), especialidades)
    )
  );

create policy "admin_select_requests" on public.ondemand_requests
  for select using (public.get_my_role() in ('admin', 'super_admin'));

-- ── 5. Toma atómica ──────────────────────────────────────────────────────────
create or replace function public.accept_ondemand_request(p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req          ondemand_requests%rowtype;
  v_consultation uuid;
begin
  if auth.uid() is null then
    raise exception 'Necesitás iniciar sesión.' using errcode = 'insufficient_privilege';
  end if;

  -- La toma en UNA sentencia condicional: si otro llegó primero, no matchea
  -- ninguna fila y v_req queda NULL. La elegibilidad va adentro del WHERE para
  -- que no haya ventana entre chequear y tomar.
  update ondemand_requests
     set status = 'accepted', accepted_by = auth.uid(), accepted_at = now()
   where id = p_request_id
     and status = 'pending'
     and expires_at > now()
     and patient_id <> auth.uid()
     and public.puede_tomar_ondemand(auth.uid(), especialidades)
  returning * into v_req;

  if v_req.id is null then
    return null;  -- ya la tomó otro, venció, se canceló o no es elegible
  end if;

  insert into consultations (
    patient_id, solicitado_por, professional_id, vertical, modality, status,
    is_on_demand, price_at_booking, scheduled_at, preconsulta_data,
    payment_status, ondemand_wait_until
  ) values (
    coalesce(v_req.para_id, v_req.patient_id),
    case when v_req.para_id is not null then v_req.patient_id end,
    -- Siempre `pending` / `pending_payment`, también la bonificada: el trigger
    -- de la 136 sólo deja escribir otro valor a la service key, y la que la
    -- marca `exempt` es ondemand-despacho justo después.
    auth.uid(), v_req.vertical, 'video', 'pending',
    true, v_req.price_at_request, now(), v_req.preconsulta_data,
    'pending_payment',
    -- Hasta cuándo se retiene la reserva si la llamada nunca arranca: lo usa el
    -- barrido de mp-capture. 20 min = el techo histórico de espera.
    now() + interval '20 minutes'
  ) returning id into v_consultation;

  update ondemand_requests set consultation_id = v_consultation where id = v_req.id;

  return v_consultation;
end;
$$;

comment on function public.accept_ondemand_request(uuid) is
  'Toma atómica de un pedido on-demand (migración 191). Devuelve la consulta creada, o NULL si otro llegó primero / venció / no es elegible. El cobro lo hace después ondemand-despacho.';

grant execute on function public.accept_ondemand_request(uuid) to authenticated;

-- ── 6. Vencidos: se marcan y se borra el token ───────────────────────────────
create or replace function public.expire_ondemand_requests()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  with done as (
    update ondemand_requests set status = 'expired'
     where status = 'pending' and expires_at <= now()
    returning id
  )
  select count(*)::integer into v_n from done;

  -- El token no sirve para nada fuera de un pedido vivo.
  delete from ondemand_request_cobros c
   using ondemand_requests r
   where r.id = c.request_id and r.status in ('expired', 'cancelled');

  return v_n;
end;
$$;

revoke all on function public.expire_ondemand_requests() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('vencer-pedidos-ondemand')
      where exists (select 1 from cron.job where jobname = 'vencer-pedidos-ondemand');
    perform cron.schedule(
      'vencer-pedidos-ondemand',
      '* * * * *',
      $cron$select public.expire_ondemand_requests()$cron$
    );
  end if;
end;
$$;

-- ── 7. Avisos ────────────────────────────────────────────────────────────────
-- La Edge Function también lo llama (aviso al profesional cuando la tarjeta se
-- rechaza después de aceptar).
grant execute on function public.enviar_push(uuid, text, text, text) to service_role;

-- Al crearse: a todos los elegibles. Con pocos médicos es exactamente "tocarles
-- el timbre a todos".
create or replace function public.avisar_pedido_ondemand()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pro record;
  v_n   integer := 0;
  v_vertical text;
begin
  select coalesce(initcap(new.vertical), 'consulta') into v_vertical;
  for v_pro in
    select pp.user_id from professional_profiles pp
     where pp.user_id <> new.patient_id
       and public.puede_tomar_ondemand(pp.user_id, new.especialidades)
  loop
    perform public.enviar_push(
      v_pro.user_id,
      'Consulta inmediata — ' || v_vertical,
      'Un paciente busca atención ahora. El primero que acepta la toma.',
      '/profesional/dashboard'
    );
    v_n := v_n + 1;
  end loop;

  update ondemand_requests set avisados = v_n where id = new.id;
  return new;
end;
$$;

drop trigger if exists ondemand_requests_avisar on public.ondemand_requests;
create trigger ondemand_requests_avisar
  after insert on public.ondemand_requests
  for each row execute function public.avisar_pedido_ondemand();

-- Al aceptarse: al paciente, por si dejó la app en segundo plano mientras
-- esperaba.
create or replace function public.avisar_pedido_aceptado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nombre text;
begin
  if new.status <> 'accepted' or old.status = 'accepted' then return new; end if;
  select full_name into v_nombre from profiles where id = new.accepted_by;
  perform public.enviar_push(
    new.patient_id,
    'Ya tenés profesional',
    coalesce(v_nombre, 'Un profesional') || ' aceptó tu consulta. Entrá cuando estés listo.',
    '/paciente/ondemand/' || new.vertical
  );
  return new;
end;
$$;

drop trigger if exists ondemand_requests_aceptado on public.ondemand_requests;
create trigger ondemand_requests_aceptado
  after update of status on public.ondemand_requests
  for each row execute function public.avisar_pedido_aceptado();

-- Si la tarjeta se rechazó al aceptar, el paciente reintenta con otra desde su
-- pantalla (mp-payment directo, sobre la consulta ya tomada). Este trigger deja
-- el pedido en sintonía para que el super admin vea el estado real.
create or replace function public.sincronizar_pago_de_pedido()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_on_demand and new.payment_status is distinct from old.payment_status
     and new.payment_status in ('in_process', 'paid') then
    update ondemand_requests set estado_pago = 'autorizado', pago_detalle = null
     where consultation_id = new.id and estado_pago <> 'autorizado';
  end if;
  return new;
end;
$$;

drop trigger if exists consultations_sincronizar_pedido on public.consultations;
create trigger consultations_sincronizar_pedido
  after update of payment_status on public.consultations
  for each row execute function public.sincronizar_pago_de_pedido();

-- El índice viejo era por `specialty`; ahora se filtra por estado y vencimiento.
create index if not exists ondemand_requests_vivos_idx
  on public.ondemand_requests (expires_at)
  where status = 'pending';
