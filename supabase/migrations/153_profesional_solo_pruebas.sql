-- Un profesional que existe para probar, no para que lo encuentre un paciente.
--
-- Caso que lo motiva (2026-09-10): `profesional@healthier.app` pasa a clínico
-- con una matrícula real para poder emitir recetas de verdad, pero no puede
-- aparecerle a nadie más que a la cuenta que hace la prueba. Hasta hoy la única
-- forma de sacar a alguien de la vista era desverificarlo o desactivarlo — y
-- las dos cosas le rompen justamente lo que se quiere probar (sin verificar no
-- receta, sin activo no cobra).
--
-- Por eso una marca aparte del estado de verificación: sigue verificado, activo
-- y en el pool para él mismo y para el super admin; simplemente no entra en la
-- búsqueda, el mapa ni el pool de consulta inmediata de un paciente cualquiera.
--
-- Quién sí lo ve se decide en el cliente (`lib/featureFlags.js` y su espejo de
-- mobile), igual que la allowlist de farmacia: es una lista de mails de prueba
-- que cambia seguido y no justifica una migración cada vez.
alter table public.professional_profiles
  add column if not exists solo_pruebas boolean not null default false;

comment on column public.professional_profiles.solo_pruebas is
  'Profesional de prueba: verificado y activo, pero oculto en búsqueda, mapa y pool on-demand salvo para las cuentas de la allowlist de pruebas (website/src/lib/featureFlags.js).';

-- El filtro se aplica en todas las listas de cara al paciente, así que conviene
-- que el planner no tenga que mirar la tabla entera para descartarlos.
create index if not exists professional_profiles_solo_pruebas_idx
  on public.professional_profiles (solo_pruebas)
  where solo_pruebas = true;
