-- ─────────────────────────────────────────────────────────────────────────────
-- Verticales dinámicas: se dan de alta desde /super-admin/verticales.
--
-- Pedido de Mateo (reunión con Nacho, 2026-10-16): poder crear una vertical
-- nueva (ej. Odontología) sin deployar — nombre, precio on-demand, imagen y
-- color de fondo en la app — y que sea la MISMA lista que el profesional elige
-- en el primer paso del onboarding.
--
-- Hasta acá la identidad visual vivía en código (`src/lib/verticals.js` y
-- `mobile/src/data/verticals.ts`) a propósito — ver el comentario de la 078 —
-- porque el ícono es un componente de Phosphor y no se serializa. Se resuelve
-- guardando una CLAVE de ícono (`icon`) de un set chico que los dos clientes
-- mapean a su componente; un ícono desconocido cae a uno genérico. Así crear
-- una vertical ya no necesita código.
--
-- `tipo` separa las verticales clínicas de la fila 'sos' (migración 087), que
-- reusa esta tabla para el precio del S.O.S. y no es una vertical: los clientes
-- listan sólo `tipo = 'vertical'`.
--
-- La imagen va a un bucket público propio (`verticales`). Las fotos que ya
-- teníamos se suben con `scripts/sembrar-imagenes-verticales.mjs <entorno>`.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.vertical_settings
  add column if not exists nombre     text,
  add column if not exists color      text,
  add column if not exists icon       text,
  add column if not exists image_url  text,
  add column if not exists tipo       text not null default 'vertical',
  add column if not exists created_at timestamptz not null default now();

alter table public.vertical_settings
  drop constraint if exists vertical_settings_color_hex,
  add constraint vertical_settings_color_hex
    check (color is null or color ~ '^#[0-9A-Fa-f]{6}$');

alter table public.vertical_settings
  drop constraint if exists vertical_settings_tipo_valido,
  add constraint vertical_settings_tipo_valido
    check (tipo in ('vertical', 'servicio'));

-- El id es la clave que ya usan consultations.vertical, las rutas
-- (/paciente/ondemand/:vertical) y specialties.vertical_id: tiene que ser un
-- slug simple. Las existentes ya lo cumplen.
alter table public.vertical_settings
  drop constraint if exists vertical_settings_id_slug,
  add constraint vertical_settings_id_slug
    check (id ~ '^[a-z0-9_]+$');

-- Semilla de identidad: la que hoy está en código. Los colores son los del
-- carrusel "Atención inmediata" (spec 2026-09-23) para las cuatro que ya lo
-- tienen, y presets nuevos para el resto — revisados por Felipe (2026-10-16):
-- todos los nuevos dan ≥ 3:1 contra texto blanco. 'Preparador Físico' pasa a
-- 'Preparación física' (es un área, como las demás).
update public.vertical_settings v set
  nombre = s.nombre,
  color  = coalesce(v.color, s.color),
  icon   = coalesce(v.icon, s.icon)
from (values
  ('clinica',     'Clínica',           '#7CB38B', 'stethoscope'),
  ('pediatria',   'Pediatría',         '#D9699C', 'baby'),
  ('nutricion',   'Nutrición',         '#E8927C', 'apple'),
  ('mente',       'Psicología',        '#9B8EC4', 'brain'),
  ('fisico',      'Kinesiología',      '#4F8A9B', 'bone'),
  ('veterinaria', 'Veterinaria',       '#A8803A', 'paw'),
  ('preparador',  'Preparación física', '#3F8A7C', 'barbell')
) as s(id, nombre, color, icon)
where v.id = s.id and v.nombre is null;

update public.vertical_settings
   set tipo = 'servicio', nombre = coalesce(nombre, 'Emergencias S.O.S'), icon = coalesce(icon, 'siren')
 where id = 'sos';

-- Cualquier otra fila que hubiera (no debería) queda con su id como nombre.
update public.vertical_settings set nombre = initcap(id) where nombre is null;

alter table public.vertical_settings alter column nombre set not null;

comment on column public.vertical_settings.nombre is
  'Nombre visible de la vertical (paciente y onboarding del profesional).';
comment on column public.vertical_settings.color is
  'Color de fondo de la vertical en el carrusel del paciente (web y app). Hex #RRGGBB.';
comment on column public.vertical_settings.icon is
  'Clave de ícono (stethoscope, baby, apple, brain, barbell, paw, pulse, tooth, heartbeat, firstaid…). Cada cliente la mapea a su componente Phosphor.';
comment on column public.vertical_settings.image_url is
  'Foto de la tarjeta del carrusel (bucket público `verticales`). NULL = tarjeta del color.';
comment on column public.vertical_settings.tipo is
  '''vertical'' = vertical clínica; ''servicio'' = filas como ''sos'' que reusan la tabla y no se listan como vertical.';
comment on table public.vertical_settings is
  'Verticales (identidad, habilitación y precio on-demand), editables y creables desde /super-admin/verticales. Desde la 199 la identidad visual también vive acá.';

-- Alta de verticales nuevas: sólo super_admin. (La 078 sólo tenía UPDATE.)
drop policy if exists "vertical_settings_insert_super_admin" on public.vertical_settings;
create policy "vertical_settings_insert_super_admin"
  on public.vertical_settings for insert
  with check (public.get_my_role() = 'super_admin');

-- ── Odontología ─────────────────────────────────────────────────────────────
-- Nacho sale a buscar odontólogos y ya hay una registrada que quedó como
-- "Otra" porque la especialidad no existía. Se crea DESHABILITADA para el
-- paciente (no aparece en su inicio hasta que se le ponga precio y se prenda),
-- pero ya se puede elegir en el onboarding. Sin receta por defecto: habilitarla
-- es una decisión aparte (ver specialties.puede_recetar, migración 116).
insert into public.vertical_settings (id, nombre, color, icon, enabled, ondemand_price, sort_order, tipo)
values ('odontologia', 'Odontología', '#5B95C9', 'tooth', false, null, 8, 'vertical')
on conflict (id) do nothing;

insert into public.specialties (slug, label, vertical_id, active, sort_order)
values ('odontologia', 'Odontología', 'odontologia', true, 40)
on conflict (slug) do nothing;

-- ── Bucket de imágenes ──────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('verticales', 'verticales', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "verticales_super_admin_insert" on storage.objects;
create policy "verticales_super_admin_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'verticales' and public.get_my_role() = 'super_admin');

drop policy if exists "verticales_super_admin_update" on storage.objects;
create policy "verticales_super_admin_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'verticales' and public.get_my_role() = 'super_admin')
  with check (bucket_id = 'verticales' and public.get_my_role() = 'super_admin');

drop policy if exists "verticales_super_admin_delete" on storage.objects;
create policy "verticales_super_admin_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'verticales' and public.get_my_role() = 'super_admin');
