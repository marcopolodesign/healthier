-- Realtime para la pantalla de cierre del paciente ("Gracias por tu consulta").
--
-- Mateo (2026-10-13): cuando el profesional carga una indicación, emite la receta
-- o cierra la consulta, el paciente lo tiene que ver al instante. `consultations`
-- ya estaba publicada (065); las tablas donde se cargan las notas, las recetas y
-- el encuentro NO — la pantalla sólo podía enterarse por sondeo.
--
-- Realtime respeta RLS: cada paciente recibe únicamente las filas que ya puede
-- leer (`patient_id = auth.uid()`: ce_patient_read / cen_patient_read / la de
-- medicaciones). No se abre nada nuevo; sólo se avisa antes.
--
-- Idempotente: agregar una tabla que ya está en la publicación es un error en
-- Postgres, así que se mira primero.
do $$
declare
  t text;
begin
  foreach t in array array['clinical_encounters', 'clinical_entries', 'clinical_medications'] loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
