-- Pre-consulta answers (motivo principal / síntomas / medicación actual) collected
-- from the patient before joining a video consultation. PreconsultaForm.jsx has been
-- writing to this column since its introduction, but it was never created — writes were
-- silently swallowed by the try/catch in handleSubmit.
alter table consultations
  add column if not exists preconsulta_data jsonb;
