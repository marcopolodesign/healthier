alter table public.professional_profiles
  add column if not exists malpractice_insurance_document_url  text,
  add column if not exists specialist_certificate_document_url text,
  add column if not exists cuit_document_url                   text,
  add column if not exists cuit_number                         text;
