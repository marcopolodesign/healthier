-- ============================================================
-- 214 — Farmacia por niveles: la receta la exige la base
-- ============================================================
-- Pedido de Mateo (reunión con Nacho, 2026-10-22): la farmacia se ordena en
-- dos niveles —arriba venta libre, abajo lo que necesita receta— y un producto
-- con receta sólo se puede comprar si el paciente tiene una receta que lo
-- cubra. Si no la tiene, la app lo manda a la videoconsulta con un clínico.
--
-- 🔴 Hasta hoy NADA en el servidor miraba la receta: `prescription_type`
-- (129) era sólo una chapita. Cualquier paciente atendido podía agregar al
-- carrito y pagar un producto "con receta". Esta migración pone la regla
-- donde no se la puede saltear:
--
--   1. `medication_order_items` — un trigger valida cada item con receta al
--      agregarlo o al subirle la cantidad, y lo ata a la línea de receta que
--      lo cubre (`clinical_medication_id`). Corre también dentro de
--      `agregar_item_pedido_medicamentos` (SECURITY DEFINER), así que no
--      depende de qué cliente llame.
--   2. `medication_orders` — al pasar a 'pagado' o 'exento' se vuelve a
--      validar el pedido entero (la receta pudo vencer entre que la agregó y
--      que paga). `mp-payment` hace el mismo chequeo ANTES de cobrar, con
--      `farmacia_items_sin_receta`, para no cobrar algo que después se rechaza.
--   3. `pharmacy_products` — un piso legal: las drogas de
--      `farmacia_drogas_bajo_receta` nunca quedan como venta libre aunque el
--      Excel de la farmacia diga otra cosa. En producción el catálogo entero
--      estaba como venta libre, alprazolam incluido.
--
-- Cuándo cubre una receta (`farmacia_recetas_de`):
--   · Tiene que estar emitida (`rcta_status = 'issued'`) y la indicación activa.
--   · El producto tiene que ser la MISMA droga, la MISMA concentración y, si
--     la receta dice cuántas unidades trae el envase, el mismo envase. El
--     match por palabra clave que usaba la pantalla traía cualquier dosis
--     ("alprazolam" cubría el de 2 mg con una receta de 0,5 mg).
--   · Cada receta sirve para UNA compra, dentro de `receta_vigencia_dias`
--     desde que se emitió. También la de tratamiento prolongado: el Decreto
--     98/2023 (reglamentario de la Ley 27.553, Anexo art. 1 A) dice que la
--     receta electrónica vale 30 días corridos y "es válida para una única
--     dispensa". Para un crónico, lo legal es que la receta traiga la
--     cantidad de hasta 3 meses (Res. MSAL 27/2022) o que el médico emita
--     recetas posdatadas — no reusar la misma.
--   · Tratamiento prolongado (Mateo, 2026-10-22): el médico puede emitir hasta
--     3 recetas en el mismo acto, cada una con fecha de inicio 30 días después
--     de la anterior (recetas posdatadas, `recetasPostadatas` de la API). Cada
--     posdatada es una receta propia: habilita UNA compra desde su fecha de
--     inicio y vence a los 30 días de esa fecha. Nunca para controlados.
--   · Controlados (psicotrópicos Ley 19.303, antimicrobianos Ley 27.680):
--     receta archivada, una dispensa, receta nueva cada vez.
--   · Cada compra, como mucho los envases que dice la receta: 1, salvo que la
--     cantidad diga explícitamente 2 o 3 envases (ver max_envases).
-- ============================================================

-- ── 1. Configuración (super admin → Configuración) ────────────────────────
alter table public.platform_settings
  add column if not exists receta_vigencia_dias integer not null default 30;

alter table public.platform_settings
  drop constraint if exists platform_settings_receta_vigencia_dias_check,
  add constraint platform_settings_receta_vigencia_dias_check
    check (receta_vigencia_dias between 1 and 30);

comment on column public.platform_settings.receta_vigencia_dias is
  'Días desde la emisión en que una receta sirve para UNA compra en la farmacia. Tope 30: la vigencia legal de la receta electrónica (Decreto 98/2023). Se puede acortar, nunca alargar.';

-- ── 2. El piso legal del catálogo ─────────────────────────────────────────
create table if not exists public.farmacia_drogas_bajo_receta (
  droga      text primary key check (droga = lower(btrim(droga)) and droga <> ''),
  tipo       text not null check (tipo in ('receta', 'receta_archivada')),
  motivo     text not null,
  created_at timestamptz not null default now()
);

comment on table public.farmacia_drogas_bajo_receta is
  'Drogas que nunca pueden venderse como venta libre. Si el nombre o el medication_match de un producto contiene una, su prescription_type sube a este tipo aunque la farmacia lo cargue distinto. Lo edita el super admin.';

alter table public.farmacia_drogas_bajo_receta enable row level security;

drop policy if exists "farmacia_drogas_bajo_receta_select" on public.farmacia_drogas_bajo_receta;
create policy "farmacia_drogas_bajo_receta_select"
  on public.farmacia_drogas_bajo_receta for select
  to authenticated using (true);

drop policy if exists "farmacia_drogas_bajo_receta_super_admin" on public.farmacia_drogas_bajo_receta;
create policy "farmacia_drogas_bajo_receta_super_admin"
  on public.farmacia_drogas_bajo_receta for all
  using (public.get_my_role() = 'super_admin')
  with check (public.get_my_role() = 'super_admin');

-- Benzodiacepinas e hipnóticos: psicotrópicos de la Ley 19.303 (listas III y
-- IV: receta archivada, "se despachará una única vez", art. 14). Antimicrobianos
-- sistémicos: venta bajo receta archivada (Ley 27.680, art. 9). La lista es un
-- piso, no el catálogo: el super admin la amplía.
insert into public.farmacia_drogas_bajo_receta (droga, tipo, motivo) values
  ('alprazolam',   'receta_archivada', 'Psicotrópico (Ley 19.303)'),
  ('clonazepam',   'receta_archivada', 'Psicotrópico (Ley 19.303)'),
  ('lorazepam',    'receta_archivada', 'Psicotrópico (Ley 19.303)'),
  ('diazepam',     'receta_archivada', 'Psicotrópico (Ley 19.303)'),
  ('bromazepam',   'receta_archivada', 'Psicotrópico (Ley 19.303)'),
  ('clobazam',     'receta_archivada', 'Psicotrópico (Ley 19.303)'),
  ('clorazepato',  'receta_archivada', 'Psicotrópico (Ley 19.303)'),
  ('midazolam',    'receta_archivada', 'Psicotrópico (Ley 19.303)'),
  ('flunitrazepam','receta_archivada', 'Psicotrópico (Ley 19.303)'),
  ('zolpidem',     'receta_archivada', 'Psicotrópico (Ley 19.303)'),
  ('zopiclona',    'receta_archivada', 'Psicotrópico (Ley 19.303)'),
  ('metilfenidato','receta_archivada', 'Psicotrópico (Ley 19.303)'),
  -- Marcas comerciales frecuentes: el piso mira el nombre del producto, y un
  -- "Rivotril" sin medication_match no dice "clonazepam" en ningún lado.
  ('rivotril',     'receta_archivada', 'Psicotrópico (Ley 19.303) — clonazepam'),
  ('alplax',       'receta_archivada', 'Psicotrópico (Ley 19.303) — alprazolam'),
  ('tranquinal',   'receta_archivada', 'Psicotrópico (Ley 19.303) — alprazolam'),
  ('valium',       'receta_archivada', 'Psicotrópico (Ley 19.303) — diazepam'),
  ('lexotanil',    'receta_archivada', 'Psicotrópico (Ley 19.303) — bromazepam'),
  ('trapax',       'receta_archivada', 'Psicotrópico (Ley 19.303) — lorazepam'),
  ('stilnox',      'receta_archivada', 'Psicotrópico (Ley 19.303) — zolpidem'),
  ('ritalina',     'receta_archivada', 'Psicotrópico (Ley 19.303) — metilfenidato'),
  ('amoxicilina', 'receta_archivada', 'Antimicrobiano (Ley 27.680)'),
  ('azitromicina', 'receta_archivada', 'Antimicrobiano (Ley 27.680)'),
  ('cefalexina', 'receta_archivada', 'Antimicrobiano (Ley 27.680)'),
  ('ciprofloxacina', 'receta_archivada', 'Antimicrobiano (Ley 27.680)'),
  ('claritromicina', 'receta_archivada', 'Antimicrobiano (Ley 27.680)'),
  ('eritromicina', 'receta_archivada', 'Antimicrobiano (Ley 27.680)'),
  ('ampicilina', 'receta_archivada', 'Antimicrobiano (Ley 27.680)'),
  ('penicilina', 'receta_archivada', 'Antimicrobiano (Ley 27.680)'),
  ('cefadroxilo', 'receta_archivada', 'Antimicrobiano (Ley 27.680)'),
  ('cefuroxima', 'receta_archivada', 'Antimicrobiano (Ley 27.680)'),
  ('cefixima', 'receta_archivada', 'Antimicrobiano (Ley 27.680)'),
  ('ceftriaxona', 'receta_archivada', 'Antimicrobiano (Ley 27.680)'),
  ('levofloxacina', 'receta_archivada', 'Antimicrobiano (Ley 27.680)'),
  ('moxifloxacina', 'receta_archivada', 'Antimicrobiano (Ley 27.680)'),
  ('norfloxacina', 'receta_archivada', 'Antimicrobiano (Ley 27.680)'),
  ('doxiciclina', 'receta_archivada', 'Antimicrobiano (Ley 27.680)'),
  ('minociclina', 'receta_archivada', 'Antimicrobiano (Ley 27.680)'),
  ('sulfametoxazol', 'receta_archivada', 'Antimicrobiano (Ley 27.680)'),
  ('trimetoprima', 'receta_archivada', 'Antimicrobiano (Ley 27.680)'),
  ('nitrofurantoina', 'receta_archivada', 'Antimicrobiano (Ley 27.680)'),
  ('metronidazol', 'receta_archivada', 'Antimicrobiano (Ley 27.680)'),
  ('clindamicina', 'receta_archivada', 'Antimicrobiano (Ley 27.680)'),
  ('fosfomicina', 'receta_archivada', 'Antimicrobiano (Ley 27.680)')
on conflict (droga) do nothing;

create or replace function public.farmacia_rango_venta(p_tipo text)
returns integer
language sql
immutable
as $$
  select case p_tipo when 'receta_archivada' then 2 when 'receta' then 1 else 0 end
$$;

create or replace function public.farmacia_aplicar_piso_de_receta()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_piso text;
begin
  select d.tipo into v_piso
    from public.farmacia_drogas_bajo_receta d
   where position(d.droga in lower(coalesce(new.name, '') || ' ' || coalesce(new.medication_match, ''))) > 0
   order by public.farmacia_rango_venta(d.tipo) desc
   limit 1;

  if v_piso is not null
     and public.farmacia_rango_venta(v_piso) > public.farmacia_rango_venta(new.prescription_type) then
    new.prescription_type := v_piso;
  end if;
  return new;
end;
$$;

drop trigger if exists pharmacy_products_piso_de_receta on public.pharmacy_products;
create trigger pharmacy_products_piso_de_receta
  before insert or update of name, medication_match, prescription_type on public.pharmacy_products
  for each row execute function public.farmacia_aplicar_piso_de_receta();

-- Si el super admin agrega o cambia una droga, el catálogo se reclasifica solo.
create or replace function public.farmacia_reaplicar_piso()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  update public.pharmacy_products p
     set prescription_type = p.prescription_type
   where position(new.droga in lower(coalesce(p.name, '') || ' ' || coalesce(p.medication_match, ''))) > 0;
  return null;
end;
$$;

drop trigger if exists farmacia_drogas_bajo_receta_reaplicar on public.farmacia_drogas_bajo_receta;
create trigger farmacia_drogas_bajo_receta_reaplicar
  after insert or update on public.farmacia_drogas_bajo_receta
  for each row execute function public.farmacia_reaplicar_piso();

-- Un solo "¿es un controlado?" para la emisión (rcta-issue no deja posdatarlo)
-- y para la farmacia (una posdatada de un controlado no habilita nada): la
-- droga está en el piso, o algún producto del catálogo con receta archivada la
-- nombra en su medication_match.
create or replace function public.farmacia_texto_es_controlado(p_texto text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
           select 1 from public.farmacia_drogas_bajo_receta d
            where d.tipo = 'receta_archivada' and position(d.droga in lower(coalesce(p_texto, ''))) > 0)
      or exists (
           select 1 from public.pharmacy_products p, unnest(string_to_array(lower(coalesce(p.medication_match, '')), ',')) kw
            where p.prescription_type = 'receta_archivada'
              and btrim(kw) <> '' and position(btrim(kw) in lower(coalesce(p_texto, ''))) > 0)
$$;

revoke all on function public.farmacia_texto_es_controlado(text) from public, anon;
grant execute on function public.farmacia_texto_es_controlado(text) to authenticated, service_role;

-- Reclasificar lo que ya hay (el trigger de arriba hace el trabajo).
update public.pharmacy_products set prescription_type = prescription_type;

comment on column public.pharmacy_products.prescription_type is
  'venta_libre: compra directa. receta: necesita una receta vigente del paciente, una compra por receta. receta_archivada: controlado (psicotrópicos, antimicrobianos): ídem, y la farmacia archiva la receta. Nunca baja del piso de farmacia_drogas_bajo_receta.';

-- ── 3. Qué producto cubre una receta ──────────────────────────────────────
-- Concentraciones normalizadas: "Micr.0.5Mg" → 0.5mg, "100 mg/5 ml" → {100mg,5ml}.
create or replace function public.farmacia_concentraciones(p_texto text)
returns text[]
language sql
immutable
as $$
  select coalesce(array_agg(distinct
           regexp_replace(regexp_replace(replace(m[1], ',', '.'), '(\.\d*[1-9])0+$', '\1'), '\.0*$', '')
           || case lower(m[2]) when 'µg' then 'mcg' when 'ug' then 'mcg' when 'gr' then 'g' else lower(m[2]) end
         ), '{}'::text[])
    from regexp_matches(coalesce(p_texto, ''), '(\d+(?:[.,]\d+)?)\s*(mg|mcg|µg|ug|gr|g|ml|ui|%)(?![a-z])', 'gi') as m
$$;

-- Unidades por envase: "Compx30" / "comp.x 21" / "Alplax 2 x 30" → 30 / 21 / 30.
-- NULL si no lo dice. La "x" tiene que estar suelta o pegada a una forma
-- farmacéutica abreviada: la de "Alplax" no es un "por".
create or replace function public.farmacia_unidades_envase(p_texto text)
returns integer
language sql
immutable
as $$
  select (regexp_match(coalesce(p_texto, ''),
            '(?:^|[^a-z]|comp|comps|caps|tab|tabs|grag)x\s*(\d{1,4})(?!\d|\s*(?:mg|mcg|ml|g|ui|%)|[.,]\d)', 'i'))[1]::integer
$$;

create or replace function public.farmacia_receta_matchea(
  p_receta_texto   text,   -- nombre + droga + presentación + concentración de la receta
  p_producto_texto text,   -- nombre + presentación del producto
  p_producto_match text    -- medication_match del producto (palabras clave de la droga)
)
returns boolean
language sql
immutable
as $$
  with rx as (
    select lower(coalesce(p_receta_texto, '')) as texto,
           public.farmacia_concentraciones(p_receta_texto) as conc,
           public.farmacia_unidades_envase(p_receta_texto) as envase
  ), pr as (
    select public.farmacia_concentraciones(p_producto_texto) as conc,
           public.farmacia_unidades_envase(p_producto_texto) as envase
  )
  select
    -- misma droga
    exists (
      select 1 from unnest(string_to_array(lower(coalesce(p_producto_match, '')), ',')) kw
       where btrim(kw) <> '' and position(btrim(kw) in rx.texto) > 0
    )
    -- misma concentración: la receta tiene que decirla, y el producto tenerla
    and cardinality(rx.conc) > 0
    and rx.conc <@ pr.conc
    -- mismo envase, si la receta lo dice
    and (rx.envase is null or pr.envase is null or rx.envase = pr.envase)
  from rx, pr
$$;

-- ── 3b. Recetas posdatadas ─────────────────────────────────────────────────
-- Cada posdatada es una fila más de `clinical_medications` (la escribe
-- `rcta-issue` con la service key): misma medicación, su propio idReceta, PDF
-- y verificador, y la fecha desde la que vale. `posdatada_de` apunta a la fila
-- original, para que la historia clínica no muestre el medicamento tres veces.
alter table public.clinical_medications
  add column if not exists vigencia_desde date,
  add column if not exists posdatada_de   uuid references public.clinical_medications(id);

comment on column public.clinical_medications.vigencia_desde is
  'Fecha de inicio de vigencia de una receta posdatada (hora argentina). NULL = vale desde que se emitió.';
comment on column public.clinical_medications.posdatada_de is
  'Si esta fila es una receta posdatada, la fila original del mismo medicamento. NULL en la original.';

create index if not exists clinical_medications_posdatada_de_idx
  on public.clinical_medications (posdatada_de) where posdatada_de is not null;

-- ── 4. El estado de cada receta del paciente ──────────────────────────────
alter table public.medication_order_items
  add column if not exists clinical_medication_id uuid references public.clinical_medications(id);

comment on column public.medication_order_items.clinical_medication_id is
  'La línea de receta que cubre este item (sólo productos con receta). La escribe el trigger farmacia_item_exige_receta, nunca el cliente.';

create index if not exists medication_order_items_receta_idx
  on public.medication_order_items (clinical_medication_id)
  where clinical_medication_id is not null;

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
  estado                 text,          -- vigente | proxima (posdatada que no empezó) | usada | vencida
  vence_at               timestamptz,   -- hasta cuándo sirve para comprar
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
           -- Desde cuándo vale: la fecha de inicio de la posdatada (a la medianoche
           -- argentina), o la emisión.
           coalesce((cm.vigencia_desde::timestamp at time zone 'America/Argentina/Buenos_Aires'),
                    cm.rcta_issued_at, cm.created_at) as emitida,
           concat_ws(' ', cm.medication_name, cm.nombre_droga, cm.presentacion, cm.presentation, cm.concentration) as texto
      from public.clinical_medications cm
     where cm.patient_id = p_patient
       and cm.rcta_status = 'issued'
       and cm.status = 'active'
       -- Una posdatada vale mientras su original siga activo: si el médico
       -- suspendió la medicación, las que faltan tampoco se venden.
       and (cm.posdatada_de is null or exists (
             select 1 from public.clinical_medications o
              where o.id = cm.posdatada_de and o.status = 'active'))
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
             -- Un controlado nunca va posdatado (rcta-issue no lo emite); si
             -- igual hubiera una fila así, no habilita nada.
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
         -- `quantity` es texto libre del recetario ("Cantidad total — Ej: 30
         -- comp., 1 frasco"): puede ser envases o comprimidos, y "30" solo es
         -- ambiguo. Sólo cuenta como envases si es 1, 2 o 3 (solo o seguido de
         -- caja/envase/frasco/blister): hasta 3 meses de tratamiento crónico
         -- en una receta (Res. MSAL 27/2022). Cualquier otra cosa es UN envase.
         -- Antes "30 comprimidos" habilitaba 30 cajas de un controlado.
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

comment on function public.farmacia_recetas_de(uuid, uuid) is
  'Las recetas emitidas de un paciente con su estado para la farmacia (vigente / proxima / usada / vencida; emitida_at es desde cuándo vale), hasta cuándo sirven, cuántos envases cubren y qué productos del catálogo son exactamente lo recetado. Única definición de "esta receta cubre este producto": la usan los triggers, mp-payment y la pantalla (vía farmacia_mis_recetas).';

-- Recibe el paciente por parámetro: sólo para triggers y para mp-payment.
revoke all on function public.farmacia_recetas_de(uuid, uuid) from public, anon, authenticated;
grant execute on function public.farmacia_recetas_de(uuid, uuid) to service_role;

-- Lo que ve la pantalla: siempre las del que está logueado.
drop function if exists public.farmacia_mis_recetas();
create or replace function public.farmacia_mis_recetas()
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
  select * from public.farmacia_recetas_de(auth.uid(), null)
$$;

revoke all on function public.farmacia_mis_recetas() from public, anon;
grant execute on function public.farmacia_mis_recetas() to authenticated;

-- ── 5. Cada item con receta, validado al agregarlo ────────────────────────
create or replace function public.farmacia_item_exige_receta()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_tipo    text;
  v_patient uuid;
  v_linea   record;
  v_otros   integer;
begin
  -- Escrituras del servidor (service role: seeds, scripts) no pasan por acá.
  if auth.uid() is null then
    return new;
  end if;

  -- Bajar la cantidad nunca necesita receta: si venció, el paciente igual
  -- tiene que poder achicar o sacar lo que ya tenía en el carrito.
  if tg_op = 'UPDATE'
     and new.pharmacy_product_id is not distinct from old.pharmacy_product_id
     and new.quantity <= old.quantity then
    return new;
  end if;

  select p.prescription_type into v_tipo
    from public.pharmacy_products p where p.id = new.pharmacy_product_id;

  if new.pharmacy_product_id is null and new.requires_prescription then
    raise exception 'Necesitás una receta vigente para comprar este medicamento.'
      using errcode = 'HR001', hint = 'receta_requerida';
  end if;

  if v_tipo is null or v_tipo = 'venta_libre' then
    new.clinical_medication_id := null;
    return new;
  end if;

  select mo.patient_id into v_patient from public.medication_orders mo where mo.id = new.order_id;

  select r.* into v_linea
    from public.farmacia_recetas_de(v_patient, new.order_id) r
   where r.estado = 'vigente'
     and new.pharmacy_product_id = any (r.producto_ids)
   order by (r.clinical_medication_id = new.clinical_medication_id) desc nulls last, r.emitida_at desc
   limit 1;

  if not found then
    raise exception 'Necesitás una receta vigente para comprar este medicamento.'
      using errcode = 'HR001', hint = 'receta_requerida';
  end if;

  select coalesce(sum(it.quantity), 0) into v_otros
    from public.medication_order_items it
   where it.order_id = new.order_id
     and it.clinical_medication_id = v_linea.clinical_medication_id
     and it.id is distinct from new.id;

  if v_otros + new.quantity > v_linea.max_envases then
    raise exception 'Tu receta cubre % envase%.', v_linea.max_envases,
                    case when v_linea.max_envases = 1 then '' else 's' end
      using errcode = 'HR003', hint = 'receta_excedida';
  end if;

  new.clinical_medication_id := v_linea.clinical_medication_id;
  new.requires_prescription  := true;
  return new;
end;
$$;

drop trigger if exists medication_order_items_exige_receta on public.medication_order_items;
create trigger medication_order_items_exige_receta
  before insert or update of quantity, pharmacy_product_id on public.medication_order_items
  for each row execute function public.farmacia_item_exige_receta();

-- Los items los escriben sólo las funciones del carrito (137/138/139): la
-- policy de INSERT directo de la 106 no la usa ningún cliente y dejaba armar
-- un item a mano, con cualquier precio.
drop policy if exists "medication_order_items_patient_insert_own" on public.medication_order_items;

-- ── 6. El pedido entero, validado al pagarlo ──────────────────────────────
create or replace function public.farmacia_items_sin_receta(p_order uuid)
returns table (item_id uuid, medication_name text, motivo text)
language sql
stable
security definer
set search_path to 'public'
as $$
  with o as (
    select patient_id from public.medication_orders where id = p_order
  ),
  r as (
    select * from public.farmacia_recetas_de((select patient_id from o), p_order)
     where estado = 'vigente'
  ),
  it as (
    select i.*, coalesce(p.prescription_type,
                         case when i.requires_prescription then 'receta' else 'venta_libre' end) as tipo
      from public.medication_order_items i
      left join public.pharmacy_products p on p.id = i.pharmacy_product_id
     where i.order_id = p_order
  )
  -- Cada item con receta tiene que estar atado a SU línea de receta (lo ata
  -- el trigger al agregarlo) y esa línea tiene que seguir vigente. Un item sin
  -- atar (carrito de antes de esta migración) no pasa: el paciente lo saca y
  -- lo vuelve a agregar, y ahí se ata —y cuenta para el tope y como usada—.
  select it.id, it.medication_name, 'sin_receta'
    from it
   where it.tipo <> 'venta_libre'
     and not exists (
       select 1 from r
        where r.clinical_medication_id = it.clinical_medication_id
          and it.pharmacy_product_id = any (r.producto_ids)
     )
  union all
  select null::uuid, r.medication_name, 'excede_envases'
    from r
    join (select clinical_medication_id, sum(quantity) as q from it
           where clinical_medication_id is not null group by 1) s
      on s.clinical_medication_id = r.clinical_medication_id
   where s.q > r.max_envases
$$;

comment on function public.farmacia_items_sin_receta(uuid) is
  'Items de un pedido que hoy no cubre ninguna receta vigente (o que exceden los envases recetados). Vacío = se puede cobrar. La llama mp-payment antes de cobrar y el trigger de medication_orders al pasar a pagado/exento.';

revoke all on function public.farmacia_items_sin_receta(uuid) from public, anon, authenticated;
grant execute on function public.farmacia_items_sin_receta(uuid) to service_role;

create or replace function public.farmacia_pedido_exige_receta()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- El 'pagado' lo escriben mp-payment y mp-webhook con la service key, y
  -- mp-payment ya validó las recetas ANTES de cobrar. Frenarlo acá, con la
  -- tarjeta ya cobrada, dejaría un cobro sin pedido.
  if auth.role() = 'service_role' then
    return new;
  end if;

  if new.payment_status in ('pagado', 'exento')
     and old.payment_status = 'no_pagado'
     and exists (select 1 from public.farmacia_items_sin_receta(new.id)) then
    raise exception 'Hay medicamentos en tu pedido que necesitan una receta vigente.'
      using errcode = 'HR002', hint = 'receta_requerida';
  end if;
  return new;
end;
$$;

drop trigger if exists medication_orders_exige_receta on public.medication_orders;
create trigger medication_orders_exige_receta
  before update of payment_status on public.medication_orders
  for each row execute function public.farmacia_pedido_exige_receta();

-- ── 7. La receta de cada item, para la farmacia que dispensa ──────────────
create or replace function public.farmacia_recetas_del_pedido(p_order uuid)
returns table (
  item_id         uuid,
  medicamento     text,
  profesional     text,
  emitida_at      timestamptz,
  verificador     text,
  pdf_url         text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if public.get_my_role() not in ('pharmacy_admin', 'pharmacy_operator', 'pharmacy_readonly', 'admin', 'super_admin') then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;

  return query
    select it.id,
           cm.medication_name,
           pf.full_name,
           -- Una posdatada se fecha desde cuando vale, no desde cuando se emitió.
           coalesce((cm.vigencia_desde::timestamp at time zone 'America/Argentina/Buenos_Aires'), cm.rcta_issued_at, cm.created_at),
           cm.rcta_verificador,
           cm.rcta_pdf_url
      from public.medication_order_items it
      join public.medication_orders mo on mo.id = it.order_id
      join public.clinical_medications cm on cm.id = it.clinical_medication_id
      left join public.profiles pf on pf.id = cm.professional_id
     where it.order_id = p_order
       and mo.payment_status in ('pagado', 'exento');
end;
$$;

comment on function public.farmacia_recetas_del_pedido(uuid) is
  'Para el panel de la farmacia: la receta que cubre cada item con receta de un pedido ya pagado (médico, fecha, código verificador, PDF). La farmacia no lee clinical_medications: ve sólo esto, y sólo de pedidos cobrados.';

revoke all on function public.farmacia_recetas_del_pedido(uuid) from public, anon;
grant execute on function public.farmacia_recetas_del_pedido(uuid) to authenticated;

-- ── 8. Una receta "emitida" sólo la marca el servicio de recetas ──────────
-- Todo lo de arriba confía en `rcta_status = 'issued'`. Hasta acá cualquier
-- profesional —incluido uno recién registrado y sin verificar— podía escribir
-- esa columna en sus propias filas (policy `cm_professional_all`, 033) sin
-- haber emitido nada: con eso se fabricaba una receta "vigente" y la farmacia
-- vendía alprazolam. Los datos de la emisión los escribe sólo `rcta-issue`,
-- que corre con la service key; el front nunca los toca (sólo la simulación,
-- que no escribe en la base).
create or replace function public.proteger_emision_de_receta()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- service role (rcta-issue, seeds) y conexiones directas de la base.
  if auth.role() = 'service_role' or auth.uid() is null then
    return new;
  end if;

  -- Desde cuándo vale una receta y de cuál es posdatada lo decide sólo la
  -- emisión, en cualquier estado: si no, se podía correr la fecha de un
  -- borrador antes de emitirlo y la farmacia lo vendía fuera de los 30 días.
  if tg_op = 'UPDATE' and (new.vigencia_desde is distinct from old.vigencia_desde
                           or new.posdatada_de is distinct from old.posdatada_de) then
    raise exception 'Los datos de la receta electrónica los escribe sólo el servicio de recetas.'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if new.rcta_status is distinct from 'issued'
       and new.vigencia_desde is null and new.posdatada_de is null
       and new.rcta_prescription_id is null and new.rcta_issued_at is null
       and new.rcta_pdf_url is null and new.rcta_verificador is null
       and new.rcta_transaction_id is null then
      return new;
    end if;
  elsif old.rcta_status in ('pending', 'issued') and (
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
      or new.created_at        is distinct from old.created_at
      or new.vigencia_desde    is distinct from old.vigencia_desde
      or new.posdatada_de      is distinct from old.posdatada_de) then
    -- Una receta emitida —o en emisión— no se reescribe: la farmacia vende
    -- contra lo que dice, y tiene que ser lo mismo que se mandó a emitir.
    null;
  elsif (new.rcta_status = 'issued') is not distinct from (old.rcta_status = 'issued')
     and new.rcta_prescription_id is not distinct from old.rcta_prescription_id
     and new.rcta_issued_at       is not distinct from old.rcta_issued_at
     and new.rcta_pdf_url         is not distinct from old.rcta_pdf_url
     and new.rcta_verificador     is not distinct from old.rcta_verificador
     and new.rcta_transaction_id  is not distinct from old.rcta_transaction_id then
    return new;
  end if;

  raise exception 'Los datos de la receta electrónica los escribe sólo el servicio de recetas.'
    using errcode = '42501';
end;
$$;

drop trigger if exists clinical_medications_proteger_emision on public.clinical_medications;
create trigger clinical_medications_proteger_emision
  before insert or update on public.clinical_medications
  for each row execute function public.proteger_emision_de_receta();

-- ── 9. La venta libre no pide consulta previa (Mateo, 2026-10-22) ─────────
-- Hasta acá TODA la farmacia exigía haberse atendido alguna vez (129/130).
-- Con la receta exigida producto por producto (arriba), ese bloqueo general
-- ya no protege nada que la receta no proteja, y le escondía al paciente nuevo
-- justamente la venta libre y el camino a la videoconsulta. Lo que necesita
-- receta sigue necesitándola: una receta implica una consulta.
drop policy if exists "medication_orders_patient_insert_own" on public.medication_orders;
create policy "medication_orders_patient_insert_own"
  on public.medication_orders for insert
  with check (patient_id = auth.uid());

create or replace function public.agregar_item_pedido_medicamentos(
  p_product_id uuid,
  p_delta      integer default 1   -- negativo resta; si llega a 0 saca el medicamento
)
returns uuid                       -- id del pedido, o NULL si quedó vacío y se borró
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_patient_id uuid := auth.uid();
  v_product    public.pharmacy_products%rowtype;
  v_order_id   uuid;
  v_item_id    uuid;
  v_qty        integer;
begin
  if v_patient_id is null then
    raise exception 'Sesión no válida.' using errcode = '42501';
  end if;

  -- Sin el "primero atendete" de la 138/139: la receta la exige el trigger de
  -- medication_order_items (sección 5), producto por producto.

  select * into v_product from public.pharmacy_products where id = p_product_id;
  if not found then
    raise exception 'El producto ya no está en el catálogo.' using errcode = 'P0002';
  end if;

  -- Buscar el carrito o crearlo. El índice único garantiza que hay a lo sumo
  -- uno; si otra sesión lo crea entre el select y el insert, el insert falla y
  -- se vuelve a buscar en vez de partir la compra en dos pedidos.
  loop
    select mo.id into v_order_id
      from public.medication_orders mo
     where mo.patient_id = v_patient_id
       and mo.payment_status = 'no_pagado'
       and mo.status = 'pendiente';

    exit when v_order_id is not null;

    -- Restar sobre un carrito que no existe no crea uno vacío.
    if p_delta <= 0 then
      return null;
    end if;

    begin
      insert into public.medication_orders (patient_id, pharmacy_id, delivery_address, subtotal, total)
      select v_patient_id,
             coalesce(v_product.pharmacy_id, '10000000-0000-0000-0000-000000000001'::uuid),
             pr.address,
             0, 0
        from public.profiles pr
       where pr.id = v_patient_id
      returning id into v_order_id;
      exit;
    exception when unique_violation then
      null;
    end;
  end loop;

  select it.id, it.quantity into v_item_id, v_qty
    from public.medication_order_items it
   where it.order_id = v_order_id
     and it.pharmacy_product_id = p_product_id
   limit 1;

  v_qty := coalesce(v_qty, 0) + p_delta;

  if v_qty <= 0 then
    if v_item_id is not null then
      delete from public.medication_order_items where id = v_item_id;
    end if;
  elsif v_item_id is null then
    insert into public.medication_order_items (
      order_id, pharmacy_product_id, medication_name, presentation,
      quantity, unit_price, requires_prescription
    ) values (
      v_order_id, p_product_id, v_product.name, v_product.presentation,
      v_qty, v_product.price, v_product.prescription_type is distinct from 'venta_libre'
    );
  else
    -- El precio se refresca al tocar la cantidad: el total que ve es el que se
    -- le va a cobrar.
    update public.medication_order_items
       set quantity = v_qty,
           unit_price = v_product.price
     where id = v_item_id;
  end if;

  return public.recalcular_total_pedido_medicamentos(v_order_id);
end;
$$;

revoke all on function public.agregar_item_pedido_medicamentos(uuid, integer) from public;
grant execute on function public.agregar_item_pedido_medicamentos(uuid, integer) to authenticated;
