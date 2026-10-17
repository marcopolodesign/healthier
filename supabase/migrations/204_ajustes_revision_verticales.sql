-- ─────────────────────────────────────────────────────────────────────────────
-- Ajustes de la revisión pre-prod sobre la 200 y la 202 (2026-10-17). Van acá y
-- no editando esas dos: ya estaban aplicadas en staging y un archivo aplicado
-- no se reescribe.
--
-- 1. Herramienta de receta apagada en las verticales donde hoy ninguna
--    especialidad puede recetar (Nutrición, Psicología, Kinesiología,
--    Veterinaria, Preparación física…). No cambia quién receta —ya era nadie,
--    `profesional_puede_recetar` pide especialidad Y vertical— pero el panel lo
--    dice como es en vez de "prendida y sin especialidades". En staging esta
--    sentencia ya se había corrido a mano el 2026-10-16.
--
-- 2. `mover_vertical` ordena por `sort_order, id collate "C"`: con un empate,
--    el panel (que compara ids como texto plano) y la base tienen que elegir
--    la misma fila. Con la intercalación por defecto un '_' podía ordenar
--    distinto que en el front.
-- ─────────────────────────────────────────────────────────────────────────────

update public.vertical_settings v
   set herramienta_receta = false
 where v.tipo = 'vertical'
   and v.herramienta_receta
   and not exists (select 1 from public.specialties s
                    where s.vertical_id = v.id and s.parent_id is null and s.active and s.puede_recetar);

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
