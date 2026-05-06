-- Add category column to medical_documents for bóveda categorization
alter table public.medical_documents
  add column if not exists category text;

create index if not exists idx_medical_documents_patient_cat
  on public.medical_documents(patient_id, category);
