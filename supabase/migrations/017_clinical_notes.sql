-- ─────────────────────────────────────────────────────────
-- Historia Clínica Interdisciplinaria
-- ─────────────────────────────────────────────────────────

create table if not exists public.clinical_notes (
  id              uuid primary key default gen_random_uuid(),
  patient_id      uuid not null references public.profiles(id) on delete cascade,
  professional_id uuid not null references public.profiles(id) on delete cascade,
  consultation_id uuid references public.consultations(id) on delete set null,
  specialty       text not null,
  note_type       text not null default 'internal'
                  check (note_type in ('internal', 'external')),
  title           text,
  content         text not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.clinical_notes enable row level security;

-- Professionals: full CRUD on their own notes
create policy "clinical_notes_own"
  on public.clinical_notes for all
  using (professional_id = auth.uid())
  with check (professional_id = auth.uid());

-- Professionals: read other pros' notes for patients they share a consultation with
create policy "clinical_notes_shared_patient"
  on public.clinical_notes for select
  using (
    exists (
      select 1 from public.consultations c
      where c.patient_id = clinical_notes.patient_id
        and c.professional_id = auth.uid()
    )
  );

-- Patients: read their own external notes
create policy "clinical_notes_patient_external"
  on public.clinical_notes for select
  using (patient_id = auth.uid() and note_type = 'external');

-- Admins / super_admins: read all
create policy "clinical_notes_admins"
  on public.clinical_notes for select
  using (get_my_role() in ('admin', 'super_admin'));

create trigger clinical_notes_updated_at
  before update on public.clinical_notes
  for each row execute function public.set_updated_at();
