-- ─────────────────────────────────────────────────────────────────────────────
-- RPCs del panel de verticales (revisión pre-prod de la 199/200, 2026-10-17).
--
-- 1. `crear_vertical`: el alta de una vertical y su especialidad homónima en UNA
--    transacción. Antes eran dos inserts desde el front: si fallaba el de la
--    especialidad quedaba una vertical huérfana (sin especialidad = no se puede
--    elegir en el onboarding ni tiene pool). Además, si el slug ya era una
--    especialidad de OTRA vertical (ej. crear "Cardiología" con Cardiología
--    colgando de Clínica), el front se la llevaba en silencio y Clínica perdía a
--    sus cardiólogos del pool. Ahora eso es un error claro; una especialidad con
--    ese slug y SIN vertical sí se cuelga de la nueva.
--
-- 2. `mover_vertical(id, ±1)`: reordenar eran dos updates sueltos con el
--    `sort_order` que el panel tenía en caché; con dos clics rápidos o datos
--    viejos quedaban órdenes repetidos. Acá se mueve contra el orden actual de
--    la base, con las filas bloqueadas, y se renumera 1..N.
--
-- Las dos exigen super_admin (`get_my_role()`, mismo criterio que las policies
-- de la 078/101) y son SECURITY DEFINER sólo para poder hacer todo junto.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.crear_vertical(
  p_id                 text,
  p_nombre             text,
  p_color              text,
  p_icon               text,
  p_image_url          text,
  p_ondemand_price     numeric,
  p_enabled            boolean,
  p_sort_order         int,
  p_historia_clinica   boolean default true,
  p_receta             boolean default true
)
returns public.vertical_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fila public.vertical_settings;
  v_esp  public.specialties;
begin
  if coalesce(public.get_my_role(), '') <> 'super_admin' then
    raise exception 'Sólo el super admin puede crear verticales' using errcode = '42501';
  end if;
  if p_id is null or p_id !~ '^[a-z0-9_]+$' then
    raise exception 'El nombre tiene que tener letras o números' using errcode = '22023';
  end if;
  if exists (select 1 from public.vertical_settings where id = p_id) then
    raise exception 'Ya existe una vertical "%"', p_nombre using errcode = '23505';
  end if;

  select * into v_esp from public.specialties where slug = p_id;
  if found and v_esp.vertical_id is not null and v_esp.vertical_id <> p_id then
    raise exception 'La especialidad "%" ya es parte de la vertical "%". Para separarla, cambiale la vertical desde la pestaña Especialidades.',
      v_esp.label,
      coalesce((select nombre from public.vertical_settings where id = v_esp.vertical_id), v_esp.vertical_id)
      using errcode = '23505';
  end if;

  insert into public.vertical_settings
    (id, nombre, color, icon, image_url, ondemand_price, enabled, sort_order, tipo,
     herramienta_historia_clinica, herramienta_receta, updated_by)
  values
    (p_id, btrim(p_nombre), upper(p_color), p_icon, p_image_url, p_ondemand_price,
     -- Sin precio no se puede prender: el paciente la vería y no podría pagarla.
     coalesce(p_enabled, false) and p_ondemand_price is not null and p_ondemand_price > 0,
     coalesce(p_sort_order, 50), 'vertical',
     coalesce(p_historia_clinica, true), coalesce(p_receta, true), auth.uid())
  returning * into v_fila;

  if v_esp.id is not null then
    update public.specialties set vertical_id = p_id, active = true where id = v_esp.id;
  else
    insert into public.specialties (slug, label, vertical_id, active, sort_order)
    values (p_id, btrim(p_nombre), p_id, true, 100);
  end if;

  return v_fila;
end;
$$;

revoke all on function public.crear_vertical(text, text, text, text, text, numeric, boolean, int, boolean, boolean) from public, anon;
grant execute on function public.crear_vertical(text, text, text, text, text, numeric, boolean, int, boolean, boolean) to authenticated;

create or replace function public.mover_vertical(p_id text, p_direccion int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids text[];
  v_pos int;
  v_otro int;
begin
  if coalesce(public.get_my_role(), '') <> 'super_admin' then
    raise exception 'Sólo el super admin puede reordenar verticales' using errcode = '42501';
  end if;
  if p_direccion not in (-1, 1) then
    raise exception 'Dirección inválida' using errcode = '22023';
  end if;

  -- El orden actual de la base (no el del panel), bloqueando las filas.
  perform 1 from public.vertical_settings where tipo = 'vertical' for update;
  select array_agg(id order by sort_order, id collate "C") into v_ids
    from public.vertical_settings where tipo = 'vertical';

  v_pos := array_position(v_ids, p_id);
  if v_pos is null then
    raise exception 'No encontré esa vertical' using errcode = '22023';
  end if;
  v_otro := v_pos + p_direccion;
  if v_otro < 1 or v_otro > array_length(v_ids, 1) then
    return; -- ya está en la punta
  end if;
  v_ids[v_pos] := v_ids[v_otro];
  v_ids[v_otro] := p_id;

  -- Se renumera todo 1..N: así un empate viejo no deja dos verticales en el
  -- mismo lugar. 'sos' (tipo servicio) no se toca.
  update public.vertical_settings v
     set sort_order = o.n, updated_at = now(), updated_by = auth.uid()
    from unnest(v_ids) with ordinality as o(id, n)
   where v.id = o.id and v.sort_order is distinct from o.n;
end;
$$;

revoke all on function public.mover_vertical(text, int) from public, anon;
grant execute on function public.mover_vertical(text, int) to authenticated;
