-- ============================================================
-- 238 — Certificado libre: título y texto los escribe el profesional
-- ============================================================
-- Pedido de Mateo (2026-11-13): además de constancia, reposo y escolar, un
-- modelo donde el profesional escribe el certificado entero. Se emite igual
-- que los otros (Otras Prescripciones, Edge Function rcta-certificado).
-- Probado contra homologación: 1500 caracteres entran en una hoja; el límite
-- es 1000 para el texto y 80 para el título.
-- ============================================================

alter table public.clinical_certificates
  drop constraint if exists clinical_certificates_tipo_check;
alter table public.clinical_certificates
  add constraint clinical_certificates_tipo_check
    check (tipo in ('constancia', 'reposo', 'escolar', 'libre'));

alter table public.clinical_certificates
  add column if not exists titulo text check (char_length(titulo) <= 80),
  add column if not exists cuerpo text check (char_length(cuerpo) <= 1000);

alter table public.clinical_certificates
  drop constraint if exists clinical_certificates_libre_completo;
alter table public.clinical_certificates
  add constraint clinical_certificates_libre_completo
    check (tipo <> 'libre' or (titulo is not null and cuerpo is not null));

comment on column public.clinical_certificates.titulo is 'Migración 238. Sólo el certificado libre: el título que escribió el profesional.';
comment on column public.clinical_certificates.cuerpo is 'Migración 238. Sólo el certificado libre: el texto que escribió el profesional (va al PDF como observaciones).';
