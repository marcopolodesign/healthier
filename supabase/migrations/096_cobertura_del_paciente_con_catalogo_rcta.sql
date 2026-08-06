-- ⚠️ Renumerada de 083_cobertura_del_paciente_con_catalogo_rcta.sql a 096_cobertura_del_paciente_con_catalogo_rcta.sql el 2026-08-06.
-- El archivo original se escribió en el worktree `fix-alta-cuenta-y-obra-social`,
-- que nunca se mergeó a main: el SQL sí llegó a producción pero ni el archivo ni
-- el registro en `supabase_migrations` quedaron en el repo. Todo lo de abajo es
-- idempotente y ya está aplicado — esta migración sólo devuelve el historial a
-- un estado reproducible. Ver la regla de huérfanas en CLAUDE.md.

-- ─────────────────────────────────────────────────────────────────────────────
-- La obra social del paciente, codificada — no escrita a mano.
--
-- Mateo (2026-07-31): "paso 4/4 en onboarding — obra social tiene que tomar
-- directo de RCTA también, y que el nro de socio sea opcional y se pueda
-- completar después".
--
-- Hasta ahora el onboarding pedía la obra social como texto libre y la guardaba
-- en `profiles.insurance_name`. Ese dato **no llegaba nunca a una receta**: RCTA
-- no acepta el nombre, necesita el `idFinanciador` de su catálogo, y la cobertura
-- que sí se usa al emitir vive en `consultations` y la carga el profesional a
-- mano en cada consulta. O sea que el paciente escribía "OSDE" en el alta y el
-- médico volvía a preguntárselo en la llamada.
--
-- Es la misma lección que ya nos costó tiempo con el medicamento (`regNo`): un
-- input de texto libre para algo que la API codifica es un bug esperando a la
-- primera receta real. Está escrito en docs/rcta-buenas-practicas.md.
--
-- Estas columnas guardan la cobertura **del paciente**, que es estable, para que
-- la de la consulta salga ya cargada en vez de en blanco.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.profiles
  -- Mismos tres estados que en consultations: null = no se preguntó todavía,
  -- que es distinto de 'particular' = dijo que no tiene. Confundirlos manda a un
  -- afiliado una receta particular y le hace perder la cobertura del remedio.
  add column if not exists coverage_type text
    check (coverage_type in ('financiador', 'particular')),
  -- El id del catálogo de Innovamed (GET /apirecipe/GetFinanciadores). Es LO que
  -- pide la API; el nombre va sólo para mostrarlo sin volver a pedir el catálogo.
  add column if not exists financiador_id integer;

comment on column public.profiles.coverage_type is
  'Cobertura habitual del paciente. NULL = no se preguntó; ''particular'' = dijo explícitamente que no tiene.';
comment on column public.profiles.financiador_id is
  'idFinanciador del catálogo de Innovamed. Es el dato que RCTA exige para emitir con cobertura — el nombre en insurance_name es sólo para mostrar.';
comment on column public.profiles.insurance_name is
  'Nombre comercial de la obra social. Desde 2026-07-31 sale del catálogo de Innovamed junto con financiador_id, no de texto libre.';
comment on column public.profiles.insurance_num is
  'N° de afiliado. Opcional a propósito: se puede completar después, desde el perfil o cuando el profesional lo necesite para una receta.';

-- Coherencia: si es particular no puede quedar un financiador colgado. Igual que
-- la constraint que ya tiene consultations.
alter table public.profiles
  drop constraint if exists profiles_cobertura_coherente;
alter table public.profiles
  add constraint profiles_cobertura_coherente
  check (coverage_type is distinct from 'particular' or financiador_id is null);
