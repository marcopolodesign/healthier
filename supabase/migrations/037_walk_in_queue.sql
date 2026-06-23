-- Walk-in queue: patients can join a virtual queue for immediate care
-- without a prior appointment.

create type walk_in_priority as enum ('low', 'medium', 'high');
create type walk_in_status   as enum ('waiting', 'in_progress', 'completed', 'cancelled');

create table walk_in_queue (
  id               uuid default gen_random_uuid() primary key,
  patient_id       uuid references profiles(id) on delete cascade not null,
  professional_id  uuid references profiles(id),
  status           walk_in_status default 'waiting' not null,
  priority         walk_in_priority default 'medium' not null,
  chief_complaint  text not null,
  consultation_id  uuid references consultations(id),
  created_at       timestamptz default now() not null,
  updated_at       timestamptz default now() not null
);

alter table walk_in_queue enable row level security;

-- Patients manage their own entries
create policy "patient_select_own_queue_entry" on walk_in_queue
  for select using (patient_id = auth.uid());

create policy "patient_insert_own_queue_entry" on walk_in_queue
  for insert with check (patient_id = auth.uid());

create policy "patient_cancel_own_queue_entry" on walk_in_queue
  for update using (patient_id = auth.uid());

-- Professionals can view and claim entries
create policy "professional_select_queue" on walk_in_queue
  for select using (
    exists (select 1 from profiles where id = auth.uid() and role = 'professional')
  );

create policy "professional_claim_queue_entry" on walk_in_queue
  for update using (
    exists (select 1 from profiles where id = auth.uid() and role = 'professional')
  );

-- Enable Realtime on this table so patient + professional get live updates
alter publication supabase_realtime add table walk_in_queue;
