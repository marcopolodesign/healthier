-- ═══════════════════════════════════════════════════════════════════════════
-- 170 · Lo que manda Apple Health (o Google Health) del paciente
-- ═══════════════════════════════════════════════════════════════════════════
-- Nacho (2026-09-23): "Apple Health no me deja sincronizarlo. Una vez
-- sincronizado debe tirar esa información en la historia clínica". Mateo: que
-- llene el apartado que ya existe en la consulta — la sección "Vitales" de la
-- consulta estructurada, que ya precargaba peso y talla del perfil.
--
-- Van en `profiles` y no en `clinical_observations` a propósito: una
-- observación clínica exige profesional y matrícula (es registro legal). Esto
-- lo trae el teléfono del paciente; el profesional lo ve precargado y decide
-- si lo asienta. Peso y talla ya vivían acá (`weight_kg`, `height_cm`).

alter table public.profiles
  add column if not exists fc_lpm integer,
  add column if not exists saturacion_pct integer,
  add column if not exists salud_sincronizado_at timestamptz;

comment on column public.profiles.fc_lpm is
  'Última frecuencia cardíaca que mandó Apple Health / Google Health (lpm).';
comment on column public.profiles.saturacion_pct is
  'Última saturación de O2 que mandó Apple Health / Google Health (%).';
comment on column public.profiles.salud_sincronizado_at is
  'Cuándo sincronizó por última vez con Apple Health / Google Health.';
