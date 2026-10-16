-- ─────────────────────────────────────────────────────────────────────────────
-- Herramientas por vertical + Psiquiatría como vertical propia + Entrenamiento
-- Físico en Preparación física. Decisiones de Mateo (2026-10-16, tras la
-- reunión con Nacho):
--
--   1. Cada vertical decide qué herramientas ve su profesional en la consulta:
--      historia clínica y receta electrónica. Odontología, sin ninguna de las
--      dos por ahora.
--   2. Psiquiatría deja de colgar de Clínica: vertical propia, con su precio y
--      su lugar en el carrusel.
--   3. "Entrenamiento Físico" (slug `entrenamiento`) pasa de Kinesiología a
--      Preparación física — la app ya lo trataba así desde el 2026-10-06.
--
-- ── Qué datos mueve ──────────────────────────────────────────────────────────
-- Sólo el CATÁLOGO (`specialties.vertical_id`, `vertical_settings`). No toca
-- ninguna fila de `professional_profiles`: el pool de una vertical se arma por
-- `specialties.vertical_id` (cliente y `ondemand-despacho`), y los
-- profesionales guardan el slug (`psiquiatria`, `entrenamiento`), que no
-- cambia. Al aplicarla, los psiquiatras quedan en el pool de Psiquiatría y salen
-- del de Clínica sin escribir nada sobre ellos. En prod (2026-10-16): 1
-- psiquiatra (sin verificar) y 1 profesional de `entrenamiento` (verificado, con
-- Kinesiología y Preparación física apagadas para el paciente).
--
-- Psiquiatría arranca con el MISMO precio y la misma habilitación que Clínica:
-- los psiquiatras hoy se atienden por Clínica, así el paciente no pierde
-- acceso a ellos el día que se aplica.
--
-- ── Receta ───────────────────────────────────────────────────────────────────
-- La regla de quién receta vive en una sola función, `profesional_puede_recetar`
-- (migración 116), que usan el trigger de `clinical_medications` y la Edge
-- Function `rcta-issue`. Ahora exige las DOS cosas: que la especialidad la
-- tenga (`specialties.puede_recetar`) y que la vertical tenga la herramienta.
-- No hace falta redeployar `rcta-issue`: llama al RPC.
--
-- La historia clínica se apaga en el front (pestaña de la videollamada, links
-- "Ver historia clínica"); la RLS de lectura no cambia.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.vertical_settings
  add column if not exists herramienta_historia_clinica boolean not null default true,
  add column if not exists herramienta_receta           boolean not null default true;

comment on column public.vertical_settings.herramienta_historia_clinica is
  'Si el profesional de esta vertical ve y carga la historia clínica en la consulta (front). Editable desde /super-admin/verticales.';
comment on column public.vertical_settings.herramienta_receta is
  'Si el profesional de esta vertical puede recetar. Se suma a specialties.puede_recetar en profesional_puede_recetar().';

update public.vertical_settings
   set herramienta_historia_clinica = false, herramienta_receta = false
 where id = 'odontologia';

-- La herramienta de receta arranca apagada en las verticales donde hoy
-- ninguna especialidad puede recetar (Nutrición, Psicología, Kinesiología,
-- Veterinaria, Preparación física…): no cambia quién receta (ya era nadie),
-- pero el panel lo dice como es en vez de "prendida y sin especialidades".
update public.vertical_settings v
   set herramienta_receta = false
 where v.tipo = 'vertical'
   and not exists (select 1 from public.specialties s
                    where s.vertical_id = v.id and s.parent_id is null and s.active and s.puede_recetar);

-- ── Psiquiatría ─────────────────────────────────────────────────────────────
insert into public.vertical_settings (id, nombre, color, icon, enabled, ondemand_price, sort_order, tipo)
select 'psiquiatria', 'Psiquiatría', '#7E5A90', 'brain',
       c.enabled, c.ondemand_price,
       coalesce((select sort_order from public.vertical_settings where id = 'mente'), 4),
       'vertical'
  from public.vertical_settings c
 where c.id = 'clinica'
on conflict (id) do nothing;

-- Psiquiatría queda justo después de Psicología: se corre todo lo que viene
-- detrás un lugar (salvo 'sos', que va aparte).
update public.vertical_settings
   set sort_order = sort_order + 1
 where tipo = 'vertical'
   and id <> 'psiquiatria'
   and sort_order >= (select sort_order from public.vertical_settings where id = 'psiquiatria')
   and id <> 'mente';
update public.vertical_settings
   set sort_order = (select sort_order from public.vertical_settings where id = 'mente') + 1
 where id = 'psiquiatria';

update public.specialties set vertical_id = 'psiquiatria' where slug = 'psiquiatria';

-- ── Entrenamiento Físico → Preparación física; Kinesiología con su slug ─────
update public.specialties set vertical_id = 'preparador' where slug = 'entrenamiento';

-- Sin esto Kinesiología se queda sin ninguna especialidad y desaparece del
-- onboarding. La app ya busca este slug (`ProfessionalService`, 2026-10-06).
insert into public.specialties (slug, label, vertical_id, active, sort_order)
values ('kinesiologia', 'Kinesiología', 'fisico', true, 41)
on conflict (slug) do update set vertical_id = 'fisico', active = true;

-- ── Receta: especialidad Y vertical ─────────────────────────────────────────
create or replace function public.profesional_puede_recetar(p_professional_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select s.puede_recetar and coalesce(v.herramienta_receta, true)
       from public.professional_profiles pp
       join public.specialties s on s.slug = pp.specialty
       left join public.vertical_settings v on v.id = s.vertical_id
      where pp.user_id = p_professional_id
      limit 1),
    false
  );
$$;

grant execute on function public.profesional_puede_recetar(uuid) to authenticated;
