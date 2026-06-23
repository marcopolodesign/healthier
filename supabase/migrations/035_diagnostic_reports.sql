-- Diagnostic reports: stores OCR-extracted lab parameters per patient
create table diagnostic_reports (
  id uuid default gen_random_uuid() primary key,
  patient_id uuid references profiles(id) on delete cascade not null,
  report_date date not null,
  document_url text,
  parameters jsonb not null default '[]'::jsonb,
  created_at timestamptz default now() not null
);

alter table diagnostic_reports enable row level security;

create policy "patient_select_own_reports" on diagnostic_reports
  for select using (patient_id = auth.uid());

create policy "patient_insert_own_reports" on diagnostic_reports
  for insert with check (patient_id = auth.uid());

create policy "patient_delete_own_reports" on diagnostic_reports
  for delete using (patient_id = auth.uid());
