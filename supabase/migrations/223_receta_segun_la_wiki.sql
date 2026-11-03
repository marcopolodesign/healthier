-- ============================================================
-- 223 · Receta electrónica según la wiki de Innovamed (2026-11-02)
--
-- Fuente: website/docs/innovamed-wiki-2026-11-02/2086174790.txt (Generar Receta).
--
-- 1. `professional_profiles.license_province` — la provincia de una matrícula
--    provincial. La wiki la exige para MP (QBI65 "PARA EL TIPO MP DEBE
--    INGRESAR LA PROVINCIA DE LA MATRICULA") y nunca se mandaba. Los valores
--    son EXACTOS los de la lista "Provincias" de la wiki (sin tildes,
--    "Ciudad Autonoma de Bs As", "La rioja"), menos "Nacional" y "Sin
--    especificar". Espejo: src/lib/provinciasMatricula.js y
--    supabase/functions/_shared/rcta/provincias.ts.
--    NO es obligatoria en la base a propósito: los MP que ya existen la tienen
--    vacía, y un NOT NULL o un check les rompería cualquier guardado del
--    perfil. Se pide sin bloquear (Mateo, 2026-11-02): si falta, `rcta-issue` no
--    la manda y traduce el rechazo del servicio (QBI62) a un mensaje claro.
--    Tampoco está en `columnas_sensibles_del_profesional()` (132): cargarla por
--    primera vez no puede devolver a revisión a un profesional verificado.
--
-- 2. Lote con errores parciales (wiki, "split de prescripciones"): una receta
--    del lote que falla no frena las demás; el servicio contesta 200 con
--    `recetas` y `errores`. `clinical_medications` gana:
--      · `rcta_recetas`       todas las recetas que contienen la medicación
--                             (cada una anulable por su `id`).
--      · `rcta_autorizacion`  'ok' | 'pendiente' — `response[].status` puede
--                             ser "Pendiente de autorización".
--      · `rcta_error_detalle` por qué no salió esa medicación del lote.
--    Las tres las escribe sólo el servicio (trigger de la 214/216, ampliado).
--
-- 3. La farmacia de Healthier no vende una pendiente: `farmacia_recetas_de`
--    le da estado 'pendiente' (no 'vigente'), y el aviso de posdatada
--    habilitada la saltea.
--
-- 4. `rcta_issue_log.outcome` acepta 'issued_partial'.
--
-- 5. "Pendiente de autorización" la autoriza la farmacia de Healthier (Mateo,
--    2026-11-02): la API publicada no tiene cómo volver a consultar el estado
--    ("Get Receta" sólo se nombra en la wiki). `farmacia_autorizar_receta()`
--    —farmacia admin/operador o super admin— la pasa a 'ok', guarda quién y
--    cuándo (`rcta_autorizada_por/_at`) y deja el asiento en `admin_action_log`
--    (acción `autorizacion_de_receta`). El paciente y el profesional no pueden:
--    la función verifica el rol y el trigger sólo deja pasar ese cambio puntual
--    cuando viene de ella. `farmacia_recetas_por_autorizar()` es la lista para
--    el panel de la farmacia y el super admin.
--
-- Las tres funciones se recrean desde la definición VIVA de staging (idéntica
-- a la de producción, md5 comparado el 2026-11-02), con sólo los cambios de
-- arriba.
-- ============================================================

-- ── 1 · Provincia de la matrícula ─────────────────────────────────────────────
alter table public.professional_profiles
  add column if not exists license_province text;

alter table public.professional_profiles
  drop constraint if exists professional_profiles_license_province_check;
alter table public.professional_profiles
  add constraint professional_profiles_license_province_check check (license_province is null or license_province in (
    'Buenos Aires',
    'Catamarca',
    'Chaco',
    'Chubut',
    'Ciudad Autonoma de Bs As',
    'Cordoba',
    'Corrientes',
    'Entre Rios',
    'Formosa',
    'Jujuy',
    'La Pampa',
    'La rioja',
    'Mendoza',
    'Misiones',
    'Neuquen',
    'Rio Negro',
    'Salta',
    'San Juan',
    'San Luis',
    'Santa Cruz',
    'Santa Fe',
    'Santiago del Estero',
    'Tierra del Fuego',
    'Tucuman'
  ));

comment on column public.professional_profiles.license_province is
  'Migración 223. Provincia de una matrícula MP, con el valor exacto de la lista de provincias del servicio de recetas (wiki Generar Receta). Obligatoria para emitir con MP (QBI65).';

-- ── 2 · Lote: recetas, autorización y motivo del error ───────────────────────
alter table public.clinical_medications
  add column if not exists rcta_recetas        jsonb,
  add column if not exists rcta_autorizacion   text,
  add column if not exists rcta_error_detalle  text,
  add column if not exists rcta_autorizada_por uuid,
  add column if not exists rcta_autorizada_at  timestamptz;

alter table public.clinical_medications
  drop constraint if exists clinical_medications_rcta_autorizacion_check;
alter table public.clinical_medications
  add constraint clinical_medications_rcta_autorizacion_check
    check (rcta_autorizacion is null or rcta_autorizacion in ('ok', 'pendiente'));

comment on column public.clinical_medications.rcta_recetas is
  'Migración 223. Las recetas del servicio que contienen esta medicación: [{id (hash para anular), idReceta, fecha, s3Link, verificador, autorizacion}]. Normalmente una.';
comment on column public.clinical_medications.rcta_autorizacion is
  'Migración 223. ok | pendiente ("Pendiente de autorización" del validador). Una pendiente no se vende en la farmacia de Healthier. NULL = el servicio no informó.';
-- UNA sola definición de "a revisar" (revisión pre-prod, ronda 3): quedó en
-- error pero con recetas del lote emitidas, sin poder confirmar cuál es suya.
-- No se re-emite; se revisa o se anula. La leen rcta-issue, rcta-anular y el
-- recetario.
alter table public.clinical_medications
  add column if not exists rcta_a_revisar boolean
    generated always as (coalesce(rcta_status = 'error'
                                  and coalesce(jsonb_array_length(rcta_recetas), 0) > 0, false)) stored;
comment on column public.clinical_medications.rcta_a_revisar is
  'Migración 223 (generada). Error con recetas del lote guardadas: no se re-emite, se revisa o se anula.';

comment on column public.clinical_medications.rcta_autorizada_por is
  'Migración 223. Quién de la farmacia (o super admin) pasó la receta de pendiente a ok. Sin FK: el dato sobrevive al perfil (el asiento completo está en admin_action_log).';
comment on column public.clinical_medications.rcta_autorizada_at is
  'Migración 223. Cuándo se autorizó la receta pendiente.';
comment on column public.clinical_medications.rcta_error_detalle is
  'Migración 223. Por qué no se emitió esta medicación (lote con errores parciales).';

-- ── 3 · Sólo el servicio escribe esos datos ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.proteger_emision_de_receta()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- service role (rcta-issue, rcta-anular, seeds) y conexiones directas de la base.
  if auth.role() = 'service_role' or auth.uid() is null then
    return new;
  end if;

  -- 223: la farmacia autoriza una pendiente. Sólo desde
  -- farmacia_autorizar_receta() (que verifica el rol y marca la transacción) y
  -- sólo ese cambio: el estado de autorización (pendiente → ok, o sigue
  -- pendiente si a la fila le queda otra receta sin autorizar), quién, cuándo
  -- y el estado dentro de rcta_recetas. Cualquier otra columna distinta y sigue de largo al resto.
  if tg_op = 'UPDATE'
     and current_setting('healthier.autorizar_receta', true) = '1'
     and old.rcta_autorizacion = 'pendiente' and new.rcta_autorizacion in ('ok', 'pendiente')
     and (to_jsonb(new) - array['rcta_autorizacion','rcta_autorizada_por','rcta_autorizada_at','rcta_recetas','rcta_a_revisar'])
       = (to_jsonb(old) - array['rcta_autorizacion','rcta_autorizada_por','rcta_autorizada_at','rcta_recetas','rcta_a_revisar']) then
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
                           or new.aviso_habilitada_at    is distinct from old.aviso_habilitada_at
                           -- 223: las recetas del lote, si quedó pendiente de
                           -- autorización y el motivo de un error parcial.
                           or new.rcta_recetas           is distinct from old.rcta_recetas
                           or new.rcta_autorizacion      is distinct from old.rcta_autorizacion
                           or new.rcta_error_detalle     is distinct from old.rcta_error_detalle
                           or new.rcta_autorizada_por    is distinct from old.rcta_autorizada_por
                           or new.rcta_autorizada_at     is distinct from old.rcta_autorizada_at) then
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
       and new.aviso_habilitada_at is null
       and new.rcta_recetas is null and new.rcta_autorizacion is null and new.rcta_error_detalle is null
       and new.rcta_autorizada_por is null and new.rcta_autorizada_at is null then
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
$function$;

-- ── 4 · La farmacia no vende una pendiente ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.farmacia_recetas_de(p_patient uuid, p_excluir_pedido uuid DEFAULT NULL::uuid)
 RETURNS TABLE(clinical_medication_id uuid, medication_name text, presentacion text, rcta_prescription_id text, emitida_at timestamp with time zone, profesional text, is_chronic boolean, controlada boolean, estado text, vence_at timestamp with time zone, max_envases integer, producto_ids uuid[])
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
             -- 223: emitida pero el validador todavía no la autorizó: existe,
             -- pero no se vende hasta que la autorice.
             when b.rcta_autorizacion = 'pendiente' and not b.ya_usada then 'pendiente'
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
$function$;

revoke all on function public.farmacia_recetas_de(uuid, uuid) from public, anon, authenticated;
grant execute on function public.farmacia_recetas_de(uuid, uuid) to service_role;

CREATE OR REPLACE FUNCTION public.avisar_posdatadas_habilitadas()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
       -- 223: una pendiente de autorización todavía no se puede comprar.
       and cm.rcta_autorizacion is distinct from 'pendiente'
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
$function$;

-- ── 5 · El log acepta un lote parcial ────────────────────────────────────────
alter table public.rcta_issue_log drop constraint if exists rcta_issue_log_outcome_check;
alter table public.rcta_issue_log add constraint rcta_issue_log_outcome_check
  check (outcome in ('issued', 'issued_partial', 'validation_error', 'api_error', 'network_error',
                     'persist_error', 'anulada', 'anulacion_error'));

-- ── 6 · La farmacia autoriza una receta pendiente ────────────────────────────
-- Autoriza RECETAS, no filas (revisión, ronda 2): las recetas pendientes de la
-- fila elegida (o su receta principal si no tiene detalle). Esas recetas pasan
-- a ok en TODAS las filas activas del paciente que las contienen, y cada fila
-- queda ok sólo si no le queda otra receta pendiente. Al paciente le llega un
-- push sólo por lo que quedó comprable. Devuelve cuántas filas cambiaron.
create or replace function public.farmacia_autorizar_receta(p_medication_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol     text := public.get_my_role();
  v_fila    record;
  v_recetas text[];
  v_n       integer;
  v_id      text;
  v_ok      uuid[];
  v_avisar  text[];
begin
  if auth.uid() is null or v_rol is null or v_rol not in ('pharmacy_admin', 'pharmacy_operator', 'super_admin') then
    raise exception 'Sólo la farmacia puede autorizar una receta.' using errcode = '42501';
  end if;

  select id, patient_id, rcta_prescription_id, rcta_status, status, rcta_autorizacion, rcta_recetas
    into v_fila
    from public.clinical_medications
   where id = p_medication_id
   for update;
  if not found then
    raise exception 'La receta no existe.' using errcode = 'P0002';
  end if;
  if v_fila.rcta_status is distinct from 'issued' or v_fila.status is distinct from 'active'
     or v_fila.rcta_autorizacion is distinct from 'pendiente' or v_fila.rcta_prescription_id is null then
    raise exception 'Esta receta no está pendiente de autorización.' using errcode = '22023';
  end if;

  select coalesce(array_agg(e->>'idReceta'), '{}')
    into v_recetas
    from jsonb_array_elements(coalesce(v_fila.rcta_recetas, '[]'::jsonb)) e
   where e->>'autorizacion' = 'pendiente' and e->>'idReceta' is not null;
  if cardinality(v_recetas) = 0 then
    v_recetas := array[v_fila.rcta_prescription_id];
  end if;

  perform set_config('healthier.autorizar_receta', '1', true);
  with nuevas as (
    select cm.id,
           case when cm.rcta_recetas is null then null else (
             select coalesce(jsonb_agg(case when e->>'idReceta' = any (v_recetas)
                                            then e || '{"autorizacion":"ok"}'::jsonb else e end), '[]'::jsonb)
               from jsonb_array_elements(cm.rcta_recetas) e) end as rr
      from public.clinical_medications cm
     where cm.patient_id = v_fila.patient_id
       and cm.rcta_status = 'issued'
       and cm.status = 'active'
       and cm.rcta_autorizacion = 'pendiente'
       and (cm.rcta_prescription_id = any (v_recetas)
            or exists (select 1 from jsonb_array_elements(coalesce(cm.rcta_recetas, '[]'::jsonb)) e
                        where e->>'idReceta' = any (v_recetas)))
  ), final as (
    select n.id, n.rr,
           (n.rr is null or not exists (select 1 from jsonb_array_elements(n.rr) e
                                         where e->>'autorizacion' = 'pendiente')) as queda_ok
      from nuevas n
  ), upd as (
    update public.clinical_medications cm
       set rcta_recetas        = f.rr,
           rcta_autorizacion   = case when f.queda_ok then 'ok' else 'pendiente' end,
           rcta_autorizada_por = case when f.queda_ok then auth.uid() else cm.rcta_autorizada_por end,
           rcta_autorizada_at  = case when f.queda_ok then now() else cm.rcta_autorizada_at end
      from final f
     where f.id = cm.id
    returning cm.id, f.queda_ok
  )
  select count(*), coalesce(array_agg(id) filter (where queda_ok), '{}')
    into v_n, v_ok
    from upd;
  perform set_config('healthier.autorizar_receta', '', true);

  -- "Ya podés comprar" sólo para lo que quedó comprable DE VERDAD (revisión,
  -- ronda 3): la misma regla que la farmacia (`farmacia_recetas_de` en
  -- 'vigente'). Una fila que sigue pendiente por otra receta, o una posdatada
  -- que no empezó ('proxima'), no avisa ahora: la posdatada avisa el día que
  -- empieza (`avisar_posdatadas_habilitadas`).
  select coalesce(array_agg(distinct r.rcta_prescription_id), '{}')
    into v_avisar
    from public.farmacia_recetas_de(v_fila.patient_id) r
   where r.clinical_medication_id = any (v_ok)
     and r.estado = 'vigente';

  perform public._aal_escribir(
    null, 'autorizacion_de_receta', 'clinical_medications', p_medication_id::text, v_fila.patient_id,
    jsonb_build_object('recetas', to_jsonb(v_recetas), 'filas', v_n,
                       'filas_ok', cardinality(v_ok), 'filas_siguen_pendientes', v_n - cardinality(v_ok),
                       'antes', 'pendiente'));

  foreach v_id in array v_avisar loop
    perform public.enviar_push_tipo(v_fila.patient_id, 'receta-autorizada',
                                    jsonb_build_object('prescriptionId', v_id));
  end loop;
  return v_n;
end;
$$;

revoke all on function public.farmacia_autorizar_receta(uuid) from public, anon;
grant execute on function public.farmacia_autorizar_receta(uuid) to authenticated;

comment on function public.farmacia_autorizar_receta(uuid) is
  'Migración 223. La farmacia (admin/operador) o el super admin autoriza las recetas "Pendiente de autorización" de una medicación, en todas las filas que las contienen. Guarda quién y cuándo, deja el asiento en admin_action_log y le avisa al paciente.';

-- Las pendientes (y, si se pide, las autorizadas de los últimos 90 días) para
-- el panel de la farmacia y el del super admin. Nada para otros roles.
-- Se dropea antes porque cambió la forma de la tabla que devuelve (en staging
-- existió una versión previa de esta misma migración).
drop function if exists public.farmacia_recetas_por_autorizar(boolean);
create or replace function public.farmacia_recetas_por_autorizar(p_incluir_autorizadas boolean default false)
returns table (
  clinical_medication_id uuid,
  rcta_prescription_id   text,
  medication_name        text,
  presentacion           text,
  paciente               text,
  paciente_dni           text,
  profesional            text,
  emitida_at             timestamptz,
  pdf_url                text,
  recetas_pendientes     text,
  autorizacion           text,
  autorizada_por         text,
  autorizada_at          timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select cm.id, cm.rcta_prescription_id, cm.medication_name,
         coalesce(cm.presentacion, concat_ws(' ', cm.presentation, cm.concentration)),
         pa.full_name, pa.dni, pr.full_name,
         coalesce(cm.rcta_issued_at, cm.created_at), cm.rcta_pdf_url,
         (select string_agg(e->>'idReceta', ', ') from jsonb_array_elements(coalesce(cm.rcta_recetas, '[]'::jsonb)) e
           where e->>'autorizacion' = 'pendiente'),
         cm.rcta_autorizacion, coalesce(nullif(au.full_name, ''), au.email), cm.rcta_autorizada_at
    from public.clinical_medications cm
    left join public.profiles pa on pa.id = cm.patient_id
    left join public.profiles pr on pr.id = cm.professional_id
    left join public.profiles au on au.id = cm.rcta_autorizada_por
   where public.get_my_role() in ('pharmacy_admin', 'pharmacy_operator', 'pharmacy_readonly', 'super_admin', 'admin')
     and cm.rcta_status = 'issued'
     and cm.status = 'active'
     and (cm.rcta_autorizacion = 'pendiente'
          or (p_incluir_autorizadas and cm.rcta_autorizada_at > now() - interval '90 days'))
   order by (cm.rcta_autorizacion = 'pendiente') desc,
            coalesce(cm.rcta_autorizada_at, cm.rcta_issued_at, cm.created_at) desc
   limit 200
$$;

revoke all on function public.farmacia_recetas_por_autorizar(boolean) from public, anon;
grant execute on function public.farmacia_recetas_por_autorizar(boolean) to authenticated;
