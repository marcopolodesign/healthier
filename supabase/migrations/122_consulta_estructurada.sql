-- "Consulta Estructurada" reemplaza el viejo `GuiaClinicaConsulta` (Mateo,
-- 2026-08-24): ese componente escribía una `clinical_entries` por cada tap
-- (motivo, cada bandera roja, cada pregunta, cada diferencial) — "miles de
-- entradas por consulta". Ahora todo lo que se documenta durante la consulta
-- (motivo, enfermedad actual, antecedentes, síntomas, vitales, examen físico,
-- diagnóstico) vive en UN borrador y se asienta como UNA sola entrada al
-- guardar o al cerrar la consulta.
--
-- (a) El borrador necesita sobrevivir a un refresh/caída de la llamada — es
-- estado flow-critical (regla de State Resilience de CLAUDE.md) — así que se
-- persiste debounced en la propia fila de `consultations` en vez de vivir
-- sólo en memoria del componente.
alter table public.consultations
  add column if not exists hc_draft jsonb;

comment on column public.consultations.hc_draft is
  'Borrador de la "consulta estructurada" (motivo, enfermedad actual, antecedentes, síntomas, vitales, examen físico, diferenciales) — se persiste debounced mientras el profesional documenta y se asienta como una entrada `clinical_entries` de tipo consultation al guardar o al cerrar la consulta. Ver src/lib/consultaDraft.js.';

-- (b) La entrada unificada se guarda con `entry_type = 'consultation'`, que
-- todavía no está permitido por el CHECK constraint. Mismo patrón que la
-- migración 121 (que sumó 'order'): se recrea la constraint listando todos
-- los tipos vigentes.
alter table public.clinical_entries
  drop constraint if exists clinical_entries_entry_type_check;

alter table public.clinical_entries
  add constraint clinical_entries_entry_type_check
  check (entry_type = any (array[
    'note'::text,
    'diagnosis'::text,
    'indication'::text,
    'prescription_ref'::text,
    'addendum'::text,
    'order'::text,
    'consultation'::text
  ]));
