-- ─────────────────────────────────────────────────────────────────────────────
-- Catálogo de especialidades — unifica dos vocabularios hardcodeados y
-- desincronizados en uno solo, editable desde /super-admin/verticales sin
-- tocar código ni deployar.
--
-- ── Por qué existe este catálogo ─────────────────────────────────────────────
-- El pedido original era "especialidad con dropdown para autocompletar, ver si
-- lo tiene RCTA" (la API de recetas electrónicas, Innovamed QBI2). Se investigó
-- contra el swagger real de homologación (200 OK, 18 endpoints) y **RCTA no
-- tiene catálogo de especialidades** — no existe `GetEspecialidades`, ni
-- matrículas, ni profesiones; sus únicos catálogos son diagnósticos,
-- financiadores, medicamentos, prácticas y promociones. La API además acepta el
-- campo `especialidad` vacío sin ningún código de error asociado (ver
-- `src/lib/datosReceta.js`), así que nunca hubo que bloquear una receta por
-- esto. El catálogo que sigue es enteramente nuestro, no un espejo de RCTA.
--
-- Lo que sí había, y era el problema real: dos listas hardcodeadas en el
-- frontend que nunca se reconciliaron —
--   • `src/lib/verticals.js` → `SPECIALTY_LABELS`, 9 slugs
--     (medicina_general, pediatria, nutricion, psicologia, entrenamiento,
--     cardiologia, dermatologia, veterinaria, otra). La usa el onboarding
--     profesional y es lo que persiste `professional_profiles.specialty`.
--   • `src/lib/specialties.js` → `SPECIALTIES`, 11 nombres para mostrar
--     ('Medicina Clínica', 'Cardiología', …) + `SPECIALTY_COLORS`. Vocabulario
--     con el que se pensó `clinical_notes.specialty` (migraciones 017/033),
--     aunque en producción esa columna terminó con una mezcla de las dos
--     convenciones (ver semilla más abajo).
-- Y encima `professional_profiles.sub_specialty` seguía siendo texto libre.
--
-- ── Diseño: una sola tabla con auto-referencia para sub-especialidades ───────
-- Se evaluó una tabla aparte para sub-especialidades y se descartó: hoy no hay
-- ningún atributo que las distinga estructuralmente de una especialidad de
-- primer nivel (mismo slug estable, mismo nombre para mostrar, mismo
-- activo/orden) — la única diferencia es que cuelgan de un padre. Una
-- auto-referencia (`parent_id`) modela exactamente eso sin duplicar columnas
-- ni requerir una segunda pantalla de administración: la misma fila de
-- /super-admin/verticales sirve para ambos niveles.
--
-- El `slug` es la clave estable: es literalmente lo que ya está guardado hoy en
-- `professional_profiles.specialty/sub_specialty` y en `clinical_notes.specialty`
-- (vía `clinical_encounters.specialty`, que se llena desde el primero). Cambiar
-- el label nunca puede romper una fila existente porque el label no es la
-- clave.
--
-- ── Semilla: por qué hay slugs que se ven "duplicados" ───────────────────────
-- El producto es pre-lanzamiento y los datos de producción son de prueba (se
-- limpian la semana del 2026-08-03), pero esta migración NO reescribe filas
-- existentes — sólo siembra el catálogo para que ninguna fila actual quede
-- apuntando a un slug que no existe. Por eso se cargan TODOS los valores que ya
-- aparecían en los dos vocabularios hardcodeados, más los valores "huérfanos"
-- encontrados en producción que no pertenecían a ninguno de los dos (p. ej.
-- 'Clínica médica', guardado tal cual en un `professional_profiles.specialty`
-- real). Quedan duplicados semánticos a propósito — 'medicina_general' /
-- 'Medicina Clínica' / 'Clínica médica' son la misma especialidad real bajo
-- tres claves distintas — y se dejan así para que un humano los unifique a mano
-- desde /super-admin/verticales (editar label, reasignar profesionales,
-- desactivar el sobrante) en vez de que esta migración adivine cuál es "la
-- buena" y pierda el dato de alguien.
--
-- Las sub-especialidades se siembran igual: se leen los valores de texto libre
-- que ya existen en `professional_profiles.sub_specialty` y se cuelgan del
-- `specialties.id` cuya slug coincide con el `specialty` de esa misma fila —
-- es una LECTURA de professional_profiles para poblar el catálogo nuevo, no un
-- backfill que le escribe nada a professional_profiles.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.specialties (
  id           uuid primary key default gen_random_uuid(),
  -- Clave estable — es lo que ya está guardado en professional_profiles.specialty,
  -- professional_profiles.sub_specialty y clinical_encounters.specialty. Nunca
  -- se reescribe: cambiar cómo se ve una especialidad es editar `label`, no `slug`.
  slug         text not null unique,
  label        text not null,
  -- A qué vertical del paciente pertenece (vertical_settings.id, migración 078).
  -- Nullable: hay especialidades sin vertical propia hoy (cardiologia,
  -- dermatologia, otra, y todo lo que vino del vocabulario de clinical_notes).
  vertical_id  text references public.vertical_settings(id) on delete set null,
  -- Auto-referencia: NULL = especialidad de primer nivel, no NULL = sub-especialidad
  -- de la especialidad `parent_id`. Ver el comentario de arriba para el porqué.
  parent_id    uuid references public.specialties(id) on delete set null,
  active       boolean not null default true,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_specialties_parent   on public.specialties(parent_id);
create index if not exists idx_specialties_vertical  on public.specialties(vertical_id);
create index if not exists idx_specialties_active    on public.specialties(active);

comment on table public.specialties is
  'Catálogo único de especialidades y sub-especialidades, editable desde /super-admin/verticales. Reemplaza SPECIALTY_LABELS y SPECIALTIES (src/lib/verticals.js y src/lib/specialties.js, removidos). No tiene relación con la API de recetas (RCTA/Innovamed) — esa API no expone catálogo de especialidades.';
comment on column public.specialties.slug is
  'Clave estable ya persistida en professional_profiles.specialty/sub_specialty y clinical_encounters.specialty. No reescribir filas existentes para "limpiar" un slug: desactivar el duplicado y reasignar desde el admin en su lugar.';

alter table public.specialties enable row level security;

-- Lectura pública: el paciente necesita ver labels de especialidad en toda la
-- app (tarjetas de profesional, buscador, historia clínica compartida) sin
-- estar autenticado como super_admin. Mismo criterio que vertical_settings.
drop policy if exists "specialties_select_all" on public.specialties;
create policy "specialties_select_all"
  on public.specialties for select
  using (true);

-- Escritura sólo super_admin — mismo patrón que vertical_settings: get_my_role()
-- (SECURITY DEFINER) y no una consulta a profiles, por la invariante de RLS del
-- proyecto (consultar profiles desde una policy en profiles causa 42P17; acá no
-- aplica directo, pero se mantiene el mismo helper por consistencia y porque ya
-- está auditado).
drop policy if exists "specialties_write_super_admin" on public.specialties;
create policy "specialties_write_super_admin"
  on public.specialties for insert
  with check (public.get_my_role() = 'super_admin');

drop policy if exists "specialties_update_super_admin" on public.specialties;
create policy "specialties_update_super_admin"
  on public.specialties for update
  using (public.get_my_role() = 'super_admin')
  with check (public.get_my_role() = 'super_admin');

drop policy if exists "specialties_delete_super_admin" on public.specialties;
create policy "specialties_delete_super_admin"
  on public.specialties for delete
  using (public.get_my_role() = 'super_admin');

drop trigger if exists specialties_updated_at on public.specialties;
create trigger specialties_updated_at
  before update on public.specialties
  for each row execute function public.set_updated_at();

-- ── Semilla: vocabulario de src/lib/verticals.js (SPECIALTY_LABELS) ──────────
-- vertical_id sale de VERTICAL_SPECIALTIES (verticals.js): clinica→medicina_general,
-- pediatria→pediatria, nutricion→nutricion, mente→psicologia, fisico→entrenamiento,
-- veterinaria→veterinaria. cardiologia/dermatologia/otra no mapeaban a ninguna
-- vertical — se siembran con vertical_id NULL, igual que hoy.
insert into public.specialties (slug, label, vertical_id, active, sort_order) values
  ('medicina_general', 'Medicina General',      'clinica',     true, 1),
  ('pediatria',        'Pediatría',              'pediatria',   true, 2),
  ('nutricion',        'Nutrición',              'nutricion',   true, 3),
  ('psicologia',       'Psicología',             'mente',       true, 4),
  ('entrenamiento',    'Entrenamiento Físico',   'fisico',      true, 5),
  ('cardiologia',      'Cardiología',            null,          true, 6),
  ('dermatologia',     'Dermatología',           null,          true, 7),
  ('veterinaria',      'Veterinaria',            'veterinaria', true, 8),
  ('otra',             'Otra',                   null,          true, 9)
on conflict (slug) do nothing;

-- ── Semilla: vocabulario de src/lib/specialties.js (SPECIALTIES) ─────────────
-- Nunca tuvo mapeo a vertical (era el vocabulario de clinical_notes, no del
-- dashboard del paciente) — vertical_id NULL para las 11.
--
-- Se siembran INACTIVAS a propósito, a diferencia del bloque anterior. Este
-- vocabulario no tenía NINGÚN consumidor en el código (`SPECIALTIES` y
-- `SPECIALTY_COLORS` de specialties.js no los importaba ningún archivo — se
-- confirmó con grep antes de escribir esta migración) y varias de estas 11
-- entradas son el mismo concepto real que ya cubre el bloque de arriba con otro
-- nombre ('Medicina Clínica' ~ medicina_general, 'Pediatría' ~ pediatria,
-- 'Nutrición' ~ nutricion, 'Psicología' ~ psicologia, 'Cardiología' ~
-- cardiologia, 'Dermatología' ~ dermatologia, 'Otra' ~ otra). Activarlas de
-- entrada haría que el buscador del paciente y el cascade de onboarding
-- muestren duplicados semánticos apenas se despliega esto. Quedan cargadas
-- (así `clinical_notes.specialty` sigue resolviendo label para las filas que ya
-- las usan) pero un super_admin las activa a mano desde
-- /super-admin/verticales sólo si decide que hace falta esa distinción fina.
insert into public.specialties (slug, label, vertical_id, active, sort_order) values
  ('Medicina Clínica', 'Medicina Clínica', null, false, 10),
  ('Nutrición',        'Nutrición',        null, false, 11),
  ('Kinesiología',     'Kinesiología',     null, false, 12),
  ('Psicología',       'Psicología',       null, false, 13),
  ('Cardiología',      'Cardiología',      null, false, 14),
  ('Dermatología',     'Dermatología',     null, false, 15),
  ('Traumatología',    'Traumatología',    null, false, 16),
  ('Pediatría',        'Pediatría',        null, false, 17),
  ('Ginecología',      'Ginecología',      null, false, 18),
  ('Neurología',       'Neurología',       null, false, 19),
  ('Otra',             'Otra',             null, false, 20)
on conflict (slug) do nothing;

-- ── Semilla: valor huérfano encontrado en producción ─────────────────────────
-- 'Clínica médica' está guardado tal cual (estilo nombre, no slug) en al menos
-- una fila real de professional_profiles.specialty — no pertenecía a ninguno de
-- los dos vocabularios hardcodeados. Sin esta fila esa pantalla mostraría vacío
-- para ese profesional. Inactiva por el mismo motivo que el bloque anterior —
-- es casi seguro el mismo concepto que 'medicina_general' bajo un tercer
-- nombre — pero SEGUIRÁ resolviendo el label de ese profesional puntual porque
-- los selects del admin/onboarding siempre incluyen el valor ya guardado del
-- form aunque esté inactivo (ver `especialidadesService`/pantallas de
-- especialidad en el frontend).
insert into public.specialties (slug, label, vertical_id, active, sort_order) values
  ('Clínica médica', 'Clínica médica', null, false, 21)
on conflict (slug) do nothing;

-- ── Semilla: sub-especialidades a partir de los valores reales ya cargados ───
-- Lee (no reescribe) professional_profiles.sub_specialty y cuelga cada valor
-- distinto del specialties.id cuyo slug coincide con el specialty de esa misma
-- fila. Es texto libre real de profesionales de prueba: cardiología, medicina
-- interna, clínica médica, traumatología, nutrición clínica, kinesiología y
-- rehabilitación, clínica general veterinaria, terapia cognitivo-conductual.
insert into public.specialties (slug, label, parent_id, active, sort_order)
select distinct on (pp.sub_specialty)
  pp.sub_specialty,
  pp.sub_specialty,
  s.id,
  true,
  0
from public.professional_profiles pp
join public.specialties s on s.slug = pp.specialty
where pp.sub_specialty is not null
  and trim(pp.sub_specialty) <> ''
order by pp.sub_specialty
on conflict (slug) do nothing;
