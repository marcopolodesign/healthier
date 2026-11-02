-- ============================================================
-- 224 — Certificados: tercer modelo "escolar" (Mateo, 2026-11-02)
-- ============================================================
-- El certificado para presentar en el colegio: días de inasistencia
-- justificados desde una fecha, igual que el reposo (`dias` + `desde`), y el
-- día de reintegro se calcula al armar el texto. Ver rcta-certificado/armado.ts.
alter table public.clinical_certificates
  drop constraint if exists clinical_certificates_tipo_check,
  add constraint clinical_certificates_tipo_check
    check (tipo in ('constancia', 'reposo', 'escolar'));

alter table public.clinical_certificates
  drop constraint if exists clinical_certificates_reposo_completo,
  add constraint clinical_certificates_dias_completos
    check (tipo not in ('reposo', 'escolar') or (dias is not null and desde is not null));
