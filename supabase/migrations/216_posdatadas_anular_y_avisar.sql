-- ============================================================
-- 216 — Recetas posdatadas: anular en cadena y avisar el día que se habilitan
-- ============================================================
-- Decisión de Mateo (2026-10-22, "se anulan y sí avisamos"):
--
--   1. Si el médico anula la receta de hoy (la original), se anulan también sus
--      posdatadas que todavía no empezaron. Las ya empezadas quedan como están.
--      La anulación la hace la Edge Function `rcta-anular`: llama al servicio de
--      recetas (DELETE /apirecipe/Receta/{hash}) y marca las filas acá. Si el
--      servicio no confirma, en nuestra base quedan anuladas igual (la farmacia
--      no las vende y el paciente deja de verlas) y queda el error para
--      reintentar.
--   2. El día que empieza cada posdatada, push + mail al paciente ("Ya podés
--      comprar tu …"), una sola vez por posdatada, disparado desde la base con
--      un cron (pg_net → send-push-notification / send-email).
--
-- Qué hay acá:
--   · `rcta_hash`: el identificador con el que el servicio de recetas anula
--     (el campo `id` de la respuesta, NO el `idReceta`: probado contra
--     homologación el 2026-10-22, con el idReceta contesta "No se pudo
--     recuperar la receta"). Se rellena desde `rcta_issue_log` para lo ya
--     emitido.
--   · `rcta_status = 'anulada'` y el resultado del lado del servicio.
--   · Una receta emitida sólo se anula por `rcta-anular`: el cliente ya no
--     puede cambiarle el estado (si no, la farmacia dejaba de venderla pero la
--     receta seguía válida en cualquier farmacia de la calle).
--   · `farmacia_recetas_de`: una posdatada que ya empezó sigue valiendo aunque
--     se haya anulado la original (antes caía con ella).
--   · El aviso diario y su cron.
-- ============================================================

-- ── 1. Columnas ─────────────────────────────────────────────────────────────
alter table public.clinical_medications
  add column if not exists rcta_hash               text,
  add column if not exists rcta_anulacion_estado   text,
  add column if not exists rcta_anulacion_detalle  text,
  add column if not exists aviso_habilitada_at     timestamptz;

alter table public.clinical_medications
  drop constraint if exists clinical_medications_rcta_anulacion_estado_check,
  add constraint clinical_medications_rcta_anulacion_estado_check
    check (rcta_anulacion_estado in ('confirmada', 'no_hacia_falta', 'error'));

comment on column public.clinical_medications.rcta_hash is
  'Identificador de la receta en el servicio de recetas para anularla o pedir su PDF (campo `id` de la respuesta de la emisión; no es el idReceta). Lo escribe sólo rcta-issue.';
comment on column public.clinical_medications.rcta_anulacion_estado is
  'Resultado de anular en el servicio de recetas: confirmada | no_hacia_falta (ya vencida allá) | error (se reintenta desde el panel). NULL = no se anuló.';
comment on column public.clinical_medications.rcta_anulacion_detalle is
  'Mensaje del servicio de recetas al anular (el error, si lo hubo).';
comment on column public.clinical_medications.aviso_habilitada_at is
  'Cuándo se le avisó al paciente (push + mail) que esta receta posdatada se habilitó. NULL = todavía no. Una sola vez por posdatada.';

-- `anulada`: el médico la anuló en Healthier. Si el servicio de recetas lo
-- confirmó está en rcta_anulacion_estado.
alter table public.clinical_medications
  drop constraint if exists clinical_medications_rcta_status_check,
  add constraint clinical_medications_rcta_status_check
    check (rcta_status in ('pending', 'issued', 'error', 'anulada'));

create index if not exists clinical_medications_aviso_posdatada_idx
  on public.clinical_medications (vigencia_desde)
  where posdatada_de is not null and aviso_habilitada_at is null and rcta_status = 'issued';

-- El log de recetas también registra las anulaciones (super admin → Auditoría).
alter table public.rcta_issue_log
  drop constraint if exists rcta_issue_log_outcome_check,
  add constraint rcta_issue_log_outcome_check
    check (outcome in ('issued', 'validation_error', 'api_error', 'network_error', 'persist_error',
                       'anulada', 'anulacion_error'));

-- ── 2. El hash de lo ya emitido, desde el log de la emisión ─────────────────
-- El log guarda la respuesta entera (092): cada receta trae `id` (el hash) e
-- `idReceta`. Sin esto, las recetas emitidas antes de hoy no se podrían anular
-- del lado del servicio.
update public.clinical_medications cm
   set rcta_hash = x.hash
  from (
    select distinct on (r->>'idReceta') r->>'idReceta' as id_receta, r->>'id' as hash
      from public.rcta_issue_log l,
           jsonb_array_elements(case when jsonb_typeof(l.response->'recetas') = 'array'
                                     then l.response->'recetas' else '[]'::jsonb end) r
     where l.outcome = 'issued'
       and r->>'idReceta' is not null and r->>'id' is not null
     order by r->>'idReceta', l.created_at desc
  ) x
 where cm.rcta_hash is null
   and cm.rcta_prescription_id = x.id_receta;

-- ── 3. Una receta emitida sólo la anula el servicio de recetas ──────────────
create or replace function public.proteger_emision_de_receta()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- service role (rcta-issue, rcta-anular, seeds) y conexiones directas de la base.
  if auth.role() = 'service_role' or auth.uid() is null then
    return new;
  end if;

  -- Lo que escriben la emisión y la anulación: nunca el cliente, en ningún
  -- estado. Desde cuándo vale una posdatada, de cuál es, su hash, el resultado
  -- de anularla y la marca del aviso.
  if tg_op = 'UPDATE' and (new.vigencia_desde         is distinct from old.vigencia_desde
                           or new.posdatada_de           is distinct from old.posdatada_de
                           or new.rcta_hash              is distinct from old.rcta_hash
                           or new.rcta_anulacion_estado  is distinct from old.rcta_anulacion_estado
                           or new.rcta_anulacion_detalle is distinct from old.rcta_anulacion_detalle
                           or new.aviso_habilitada_at    is distinct from old.aviso_habilitada_at) then
    raise exception 'Los datos de la receta electrónica los escribe sólo el servicio de recetas.'
      using errcode = '42501';
  end if;

  -- Una receta emitida (o anulada) no cambia de estado desde el cliente: se
  -- anula con "Anular receta", que también la anula en el servicio de recetas
  -- y arrastra las posdatadas. Si no, la farmacia de Healthier dejaba de
  -- venderla pero seguía valiendo en cualquier farmacia.
  if tg_op = 'UPDATE' and old.rcta_status in ('issued', 'anulada') and (
       new.status        is distinct from old.status
    or new.stopped_at    is distinct from old.stopped_at
    or new.stopped_by    is distinct from old.stopped_by
    or new.stop_reason   is distinct from old.stop_reason) then
    raise exception 'Una receta emitida se anula desde "Anular receta".'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if new.rcta_status is distinct from 'issued' and new.rcta_status is distinct from 'anulada'
       and new.vigencia_desde is null and new.posdatada_de is null
       and new.rcta_prescription_id is null and new.rcta_issued_at is null
       and new.rcta_pdf_url is null and new.rcta_verificador is null
       and new.rcta_transaction_id is null and new.rcta_hash is null
       and new.rcta_anulacion_estado is null and new.rcta_anulacion_detalle is null
       and new.aviso_habilitada_at is null then
      return new;
    end if;
  elsif old.rcta_status in ('pending', 'issued', 'anulada') and (
         new.patient_id        is distinct from old.patient_id
      or new.professional_id   is distinct from old.professional_id
      or new.medication_name   is distinct from old.medication_name
      or new.nombre_droga      is distinct from old.nombre_droga
      or new.presentacion      is distinct from old.presentacion
      or new.presentation      is distinct from old.presentation
      or new.concentration     is distinct from old.concentration
      or new.quantity          is distinct from old.quantity
      or new.reg_no            is distinct from old.reg_no
      or new.is_chronic        is distinct from old.is_chronic
      or new.created_at        is distinct from old.created_at) then
    -- Una receta emitida —o en emisión, o anulada— no se reescribe: la
    -- farmacia vende contra lo que dice, y tiene que ser lo mismo que se mandó
    -- a emitir.
    null;
  elsif new.rcta_status          is not distinct from old.rcta_status
     or (coalesce(old.rcta_status, 'x') not in ('issued', 'anulada')
         and coalesce(new.rcta_status, 'x') not in ('issued', 'anulada')) then
    -- El estado de la emisión puede moverse entre "sin emitir", pending y
    -- error (lo hace rcta-issue, pero no daña), nunca a/desde emitida o anulada.
    if new.rcta_prescription_id is not distinct from old.rcta_prescription_id
       and new.rcta_issued_at       is not distinct from old.rcta_issued_at
       and new.rcta_pdf_url         is not distinct from old.rcta_pdf_url
       and new.rcta_verificador     is not distinct from old.rcta_verificador
       and new.rcta_transaction_id  is not distinct from old.rcta_transaction_id then
      return new;
    end if;
  end if;

  raise exception 'Los datos de la receta electrónica los escribe sólo el servicio de recetas.'
    using errcode = '42501';
end;
$$;

-- ── 4. Una posdatada que ya empezó no cae con la original ───────────────────
-- Igual que la 214, salvo la condición de las posdatadas: antes una posdatada
-- valía sólo mientras su original siguiera activa, así que anular la de hoy
-- también se llevaba la del mes que ya estaba vigente. Ahora también vale la
-- que ya había empezado el día que se anuló la original. Las que no habían
-- empezado las anula `rcta-anular` en el mismo acto; esta condición es la red
-- por si quedara alguna activa: nunca se habilita después de la anulación.
create or replace function public.farmacia_recetas_de(p_patient uuid, p_excluir_pedido uuid default null)
returns table (
  clinical_medication_id uuid,
  medication_name        text,
  presentacion           text,
  rcta_prescription_id   text,
  emitida_at             timestamptz,
  profesional            text,
  is_chronic             boolean,
  controlada             boolean,
  estado                 text,
  vence_at               timestamptz,
  max_envases            integer,
  producto_ids           uuid[]
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with cfg as (
    select least(30, coalesce(max(receta_vigencia_dias), 30)) as vig
      from public.platform_settings where id = 1
  ),
  lineas as (
    select cm.*,
           coalesce((cm.vigencia_desde::timestamp at time zone 'America/Argentina/Buenos_Aires'),
                    cm.rcta_issued_at, cm.created_at) as emitida,
           concat_ws(' ', cm.medication_name, cm.nombre_droga, cm.presentacion, cm.presentation, cm.concentration) as texto
      from public.clinical_medications cm
     where cm.patient_id = p_patient
       and cm.rcta_status = 'issued'
       and cm.status = 'active'
       -- Una posdatada vale mientras su original siga activa, o si ya había
       -- empezado cuando se anuló la original (`stopped_at`, lo escribe
       -- rcta-anular). Una original inactiva sin `stopped_at` no deja ninguna.
       and (cm.posdatada_de is null or exists (
             select 1 from public.clinical_medications o
              where o.id = cm.posdatada_de
                and (o.status = 'active'
                     or (o.stopped_at is not null
                         and cm.vigencia_desde <= (o.stopped_at at time zone 'America/Argentina/Buenos_Aires')::date))))
  ),
  prods as (
    select l.id as cm_id,
           array_agg(p.id order by p.name) as ids,
           bool_or(p.prescription_type = 'receta_archivada') as archivada
      from lineas l
      join public.pharmacy_products p
        on p.medication_match is not null
       and public.farmacia_receta_matchea(l.texto, concat_ws(' ', p.name, p.presentation), p.medication_match)
     group by l.id
  ),
  usadas as (
    select distinct it.clinical_medication_id as cm_id
      from public.medication_order_items it
      join public.medication_orders mo on mo.id = it.order_id
     where mo.patient_id = p_patient
       and mo.payment_status in ('pagado', 'exento')
       and mo.status <> 'cancelado'
       and it.clinical_medication_id is not null
       and (p_excluir_pedido is null or mo.id <> p_excluir_pedido)
  ),
  base as (
    select l.*,
           coalesce(pr.ids, '{}'::uuid[]) as ids,
           (coalesce(pr.archivada, false) or public.farmacia_texto_es_controlado(l.texto)) as es_controlada,
           (u.cm_id is not null) as ya_usada,
           l.emitida + make_interval(days => cfg.vig) as fin_vigencia
      from lineas l
      cross join cfg
      left join prods pr on pr.cm_id = l.id
      left join usadas u on u.cm_id = l.id
  ),
  con_estado as (
    select b.*,
           case
             when b.posdatada_de is not null and b.es_controlada then 'vencida'
             when not b.ya_usada and now() < b.emitida then 'proxima'
             when not b.ya_usada and now() < b.fin_vigencia then 'vigente'
             when b.ya_usada then 'usada'
             else 'vencida'
           end as est
      from base b
  )
  select c.id,
         c.medication_name,
         c.presentacion,
         c.rcta_prescription_id,
         c.emitida,
         pf.full_name,
         c.is_chronic,
         c.es_controlada,
         c.est,
         c.fin_vigencia,
         case
           when c.quantity ~* '^\s*[1-3]\s*(cajas?|envases?|frascos?|blisters?|unidades de venta)?\s*$'
             then substring(c.quantity from '[1-3]')::integer
           else 1
         end,
         c.ids
    from con_estado c
    left join public.profiles pf on pf.id = c.professional_id
   order by c.emitida desc
$$;

revoke all on function public.farmacia_recetas_de(uuid, uuid) from public, anon, authenticated;
grant execute on function public.farmacia_recetas_de(uuid, uuid) to service_role;

-- ── 5. "Ya podés comprar tu …" el día que empieza cada posdatada ────────────
-- Corre todos los días a las 9 de Argentina. Marca y avisa en el mismo UPDATE
-- (`aviso_habilitada_at`), así dos corridas en paralelo no avisan dos veces.
-- Toma las que empiezan hoy o ayer: si un día el cron no corre, el aviso sale
-- al día siguiente en vez de perderse, y una de hace semanas no recibe un
-- "habilitada desde hoy" que ya no es cierto. Usa la misma regla de validez que
-- la farmacia (`farmacia_recetas_de`): no se avisa algo que no se puede comprar.
create or replace function public.avisar_posdatadas_habilitadas()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  r     record;
  v_n   integer := 0;
begin
  for r in
    update public.clinical_medications cm
       set aviso_habilitada_at = now()
     where cm.posdatada_de is not null
       and cm.rcta_status = 'issued'
       and cm.status = 'active'
       and cm.aviso_habilitada_at is null
       and cm.rcta_prescription_id is not null
       and cm.vigencia_desde between v_hoy - 1 and v_hoy
       and exists (
         select 1 from public.clinical_medications o
          where o.id = cm.posdatada_de
            and (o.status = 'active'
                 or (o.stopped_at is not null
                     and cm.vigencia_desde <= (o.stopped_at at time zone 'America/Argentina/Buenos_Aires')::date)))
       and not exists (
         select 1
           from public.medication_order_items it
           join public.medication_orders mo on mo.id = it.order_id
          where it.clinical_medication_id = cm.id
            and mo.payment_status in ('pagado', 'exento')
            and mo.status <> 'cancelado')
    returning cm.patient_id, cm.rcta_prescription_id
  loop
    -- Una posdatada es de un solo medicamento (rcta-issue lo exige): una fila
    -- = una receta = un aviso.
    perform public.enviar_push_tipo(
      r.patient_id, 'receta-habilitada',
      jsonb_build_object('prescriptionId', r.rcta_prescription_id)
    );
    perform public.enviar_mail(jsonb_build_object(
      'tipo', 'receta-habilitada', 'prescriptionId', r.rcta_prescription_id
    ));
    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$$;

revoke all on function public.avisar_posdatadas_habilitadas() from public, anon, authenticated;
grant execute on function public.avisar_posdatadas_habilitadas() to service_role;

comment on function public.avisar_posdatadas_habilitadas() is
  'Migración 216. Push + mail al paciente el día que empieza cada receta posdatada ("Ya podés comprar tu …"), una sola vez (aviso_habilitada_at). La corre el cron avisar-posdatadas-habilitadas a las 9 de Argentina.';

-- Las posdatadas que ya empezaron antes de esta migración no se avisan tarde.
update public.clinical_medications
   set aviso_habilitada_at = now()
 where posdatada_de is not null
   and aviso_habilitada_at is null
   and vigencia_desde < (now() at time zone 'America/Argentina/Buenos_Aires')::date;

do $$
begin
  perform cron.unschedule('avisar-posdatadas-habilitadas')
   where exists (select 1 from cron.job where jobname = 'avisar-posdatadas-habilitadas');
  -- 12:00 UTC = 09:00 en Argentina.
  perform cron.schedule('avisar-posdatadas-habilitadas', '0 12 * * *', 'select public.avisar_posdatadas_habilitadas()');
end $$;
